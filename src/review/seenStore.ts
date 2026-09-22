import * as vscode from 'vscode';
import { capSeen, pruneSeen, sanitizeSeenRoots, type SeenMap } from './seenState';

const KEY = 'reviewGutters.seen.v1';
const MAX_ENTRIES_PER_REPO = 2000;

/**
 * Seen marks in workspace storage, never in the working tree:
 *
 * ```jsonc
 * { "/home/u/repos/app": { "src/a.ts": { "seenAt": 1758412800000, "baseCommit": "acf5f7e…" } } }
 * ```
 *
 * Writes are per-repository sub-maps, so one repository's state can never
 * corrupt another's, and maps are replaced rather than mutated so a reader
 * holding an older one still sees a consistent snapshot.
 */
export class SeenStore {
	private cache: Record<string, SeenMap>;

	constructor(private readonly memento: vscode.Memento) {
		this.cache = sanitizeSeenRoots(memento.get<unknown>(KEY, {}));
	}

	/** Read-only by contract: mutate through the methods below, never in place. */
	get(rootFsPath: string): SeenMap {
		return this.cache[rootFsPath] ?? EMPTY;
	}

	/**
	 * `markAll` and `unmarkAll` resolve true when they actually wrote, so a
	 * no-op — the common case with `markSeenOnOpen` on — does not cause a
	 * repaint.
	 *
	 * The compute and the cache swap are synchronous, with no await between
	 * them, so two operations in this window cannot interleave and lose a
	 * mark. Across two windows on one workspace it is last-write-wins.
	 */
	async markAll(rootFsPath: string, relPaths: readonly string[], baseCommit: string): Promise<boolean> {
		const current = this.get(rootFsPath);
		const next: SeenMap = { ...current };
		let changed = false;
		for (const relPath of relPaths) {
			const existing = own(current, relPath) ? current[relPath] : undefined;
			// Re-marking the same base is a no-op, so a stray event cannot churn storage.
			if (existing && existing.baseCommit === baseCommit) {
				continue;
			}
			next[relPath] = { seenAt: Date.now(), baseCommit };
			changed = true;
		}
		if (!changed) {
			return false;
		}
		await this.write(rootFsPath, capSeen(next, MAX_ENTRIES_PER_REPO));
		return true;
	}

	async unmarkAll(rootFsPath: string, relPaths: readonly string[]): Promise<boolean> {
		const current = this.get(rootFsPath);
		if (!relPaths.some((relPath) => own(current, relPath))) {
			return false;
		}
		const next: SeenMap = { ...current };
		for (const relPath of relPaths) {
			delete next[relPath];
		}
		await this.write(rootFsPath, next);
		return true;
	}

	/** Drops marks for paths that have left the change set. */
	async prune(rootFsPath: string, livePaths: ReadonlySet<string>): Promise<boolean> {
		const current = this.cache[rootFsPath];
		if (!current) {
			return false;
		}
		const kept = pruneSeen(current, livePaths);
		if (Object.keys(kept).length === Object.keys(current).length) {
			return false;
		}
		await this.write(rootFsPath, kept);
		return true;
	}

	private async write(rootFsPath: string, next: SeenMap): Promise<void> {
		if (Object.keys(next).length === 0) {
			delete this.cache[rootFsPath];
		} else {
			this.cache[rootFsPath] = next;
		}
		await this.memento.update(KEY, this.cache);
	}
}

const EMPTY: SeenMap = Object.freeze({}) as SeenMap;

function own(map: SeenMap, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(map, key);
}
