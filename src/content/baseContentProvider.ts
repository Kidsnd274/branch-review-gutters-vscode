import * as vscode from 'vscode';
import { git } from '../git/exec';
import { blobSpec } from '../git/args';
import { BASE_SCHEME, baseUriParts, cacheKey, decodeBaseQuery, type BasePayload } from './uri';
import { looksBinary, normalizeForDocument, toLf, type Eol } from './text';
import type { Config } from '../config';
import * as log from '../util/log';

const MAX_ENTRIES = 200;
const MAX_CACHE_BYTES = 50 * 1024 * 1024;

interface CacheEntry {
	/** LF-normalised text; empty when the blob is absent, binary or oversized. */
	text: string;
	bytes: number;
	binary: boolean;
	tooLarge: boolean;
	missing: boolean;
}

export function makeBaseUri(relPath: string, payload: BasePayload): vscode.Uri {
	const parts = baseUriParts(relPath, payload);
	return vscode.Uri.from({ scheme: parts.scheme, path: parts.path, query: parts.query });
}

export class BaseContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
	/** Insertion-ordered, so the first key is the least recently used. */
	private readonly cache = new Map<string, CacheEntry>();
	private cacheBytes = 0;
	private readonly inFlight = new Map<string, Promise<CacheEntry>>();
	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.onDidChangeEmitter.event;
	private readonly disposables: vscode.Disposable[] = [];

	/** Paths skipped for size or binariness, for the status bar tooltip. */
	private readonly skipped = new Set<string>();

	constructor(private readonly getConfig: () => Config) {
		this.disposables.push(
			this.onDidChangeEmitter,
			vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, this),
		);
	}

	get skippedCount(): number {
		return this.skipped.size;
	}

	/**
	 * Whether a base version is worth diffing. False for binary and oversized
	 * blobs, so no markers appear rather than a wall of false ones.
	 */
	async shouldProvide(payload: BasePayload): Promise<boolean> {
		if (payload.base === null) {
			// New file: an empty original makes the whole file read as added.
			return true;
		}
		try {
			const entry = await this.load(payload);
			// `missing` covers files git does not know about in the base and that
			// the change set does not list either - typically ignored files. An
			// empty original would paint the whole file as added.
			return !entry.binary && !entry.tooLarge && !entry.missing;
		} catch (err) {
			log.debug(`shouldProvide(${payload.base}) failed: ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
		let payload: BasePayload;
		try {
			payload = decodeBaseQuery(uri.query);
		} catch (err) {
			log.error(`rejected ${BASE_SCHEME} uri`, err);
			return '';
		}
		if (payload.base === null) {
			return '';
		}
		const entry = await this.load(payload);
		if (token.isCancellationRequested || entry.binary || entry.tooLarge || entry.missing) {
			return '';
		}
		const doc = this.findOpenDocument(payload.repo, uri.path.replace(/^\//, ''));
		const eol: Eol = doc?.eol === vscode.EndOfLine.CRLF ? 'crlf' : 'lf';
		const hasBom = doc ? doc.getText().charCodeAt(0) === 0xfeff : false;
		return normalizeForDocument(entry.text, eol, hasBom);
	}

	/** Clears everything; call when the baseline moves. */
	invalidate(): void {
		const open = new Set(
			vscode.workspace.textDocuments.filter((d) => d.uri.scheme === BASE_SCHEME).map((d) => d.uri.toString()),
		);
		this.cache.clear();
		this.cacheBytes = 0;
		this.skipped.clear();
		for (const uriString of open) {
			this.onDidChangeEmitter.fire(vscode.Uri.parse(uriString));
		}
	}

	// ------------------------------------------------------------------ cache

	private async load(payload: BasePayload): Promise<CacheEntry> {
		const key = cacheKey(payload);
		const cached = this.cache.get(key);
		if (cached) {
			// Refresh LRU position.
			this.cache.delete(key);
			this.cache.set(key, cached);
			return cached;
		}
		const pending = this.inFlight.get(key);
		if (pending) {
			return pending;
		}
		const promise = this.fetchBlob(payload)
			.catch((err): CacheEntry => {
				log.debug(`cat-file failed for ${payload.base}: ${err instanceof Error ? err.message : String(err)}`);
				return { text: '', bytes: 0, binary: false, tooLarge: false, missing: true };
			})
			.then((entry) => {
				this.store(key, entry);
				this.inFlight.delete(key);
				return entry;
			});
		this.inFlight.set(key, promise);
		return promise;
	}

	private async fetchBlob(payload: BasePayload): Promise<CacheEntry> {
		const spec = blobSpec(payload.commit, payload.base as string);
		const cap = Math.max(1, this.getConfig().maxFileSizeKB) * 1024;

		const sizeRes = await git(payload.repo, ['cat-file', '-s', spec], { allowNonZero: true });
		if (sizeRes.code !== 0) {
			return { text: '', bytes: 0, binary: false, tooLarge: false, missing: true };
		}
		const size = Number.parseInt(sizeRes.stdout.toString('utf8').trim(), 10);
		if (Number.isFinite(size) && size > cap) {
			this.skipped.add(`${payload.base} (${Math.round(size / 1024)} KB)`);
			return { text: '', bytes: 0, binary: false, tooLarge: true, missing: false };
		}

		const blob = await git(payload.repo, ['cat-file', 'blob', spec], { maxBuffer: cap + 1 });
		if (looksBinary(blob.stdout)) {
			this.skipped.add(`${payload.base} (binary)`);
			return { text: '', bytes: 0, binary: true, tooLarge: false, missing: false };
		}
		const text = toLf(blob.stdout.toString('utf8'));
		return { text, bytes: blob.stdout.length, binary: false, tooLarge: false, missing: false };
	}

	private store(key: string, entry: CacheEntry): void {
		this.cache.set(key, entry);
		this.cacheBytes += entry.bytes;
		while (this.cache.size > MAX_ENTRIES || this.cacheBytes > MAX_CACHE_BYTES) {
			const oldest = this.cache.keys().next();
			if (oldest.done) {
				break;
			}
			const victim = this.cache.get(oldest.value);
			this.cache.delete(oldest.value);
			this.cacheBytes -= victim?.bytes ?? 0;
		}
		if (this.cacheBytes < 0) {
			this.cacheBytes = 0;
		}
	}

	private findOpenDocument(repoRoot: string, relPath: string): vscode.TextDocument | undefined {
		const target = vscode.Uri.joinPath(vscode.Uri.file(repoRoot), ...relPath.split('/')).toString();
		return vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.toString() === target);
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
		this.disposables.length = 0;
		this.cache.clear();
	}
}
