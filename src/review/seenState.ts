/** Pure model of the reviewer's seen/unseen marks. No vscode/node imports. */

import type { FileChange } from '../changes/parse';

export interface SeenEntry {
	/** Unix ms when the reviewer marked it. */
	seenAt: number;
	/** The resolved base commit the mark was made against. */
	baseCommit: string;
}

/** Keyed by repository-relative path, exactly as FileChange.path spells it. */
export type SeenMap = Record<string, SeenEntry>;

export type FolderSeen = 'none' | 'partial' | 'all';

/**
 * A mark only counts while the comparison it was made against is still the
 * current one, so moving the base resets the marks rather than leaving a
 * reviewer looking at a fresh diff they believe they have already read.
 *
 * `hasOwnProperty` rather than a bare lookup: storage is untrusted input and
 * `constructor` or `toString` are names someone can legitimately commit.
 */
export function isSeen(seen: SeenMap, relPath: string, baseCommit: string): boolean {
	if (!Object.prototype.hasOwnProperty.call(seen, relPath)) {
		return false;
	}
	return seen[relPath].baseCommit === baseCommit;
}

export function countSeen(
	seen: SeenMap,
	relPaths: readonly string[],
	baseCommit: string,
): number {
	let count = 0;
	for (const relPath of relPaths) {
		if (isSeen(seen, relPath, baseCommit)) {
			count++;
		}
	}
	return count;
}

export function seenProgress(
	seen: SeenMap,
	changes: readonly FileChange[],
	baseCommit: string,
): { seen: number; total: number } {
	return {
		seen: countSeen(
			seen,
			changes.map((c) => c.path),
			baseCommit,
		),
		total: changes.length,
	};
}

/** Drop entries for paths that are no longer part of the comparison. */
export function pruneSeen(seen: SeenMap, livePaths: ReadonlySet<string>): SeenMap {
	const kept: SeenMap = {};
	for (const [relPath, entry] of Object.entries(seen)) {
		if (livePaths.has(relPath)) {
			kept[relPath] = entry;
		}
	}
	return kept;
}

/** Folder aggregate, so a collapsed folder can say how much is left inside it. */
export function folderSeenState(
	seen: SeenMap,
	filesUnderDir: readonly string[],
	baseCommit: string,
): FolderSeen {
	if (filesUnderDir.length === 0) {
		return 'none';
	}
	const count = countSeen(seen, filesUnderDir, baseCommit);
	if (count === 0) {
		return 'none';
	}
	return count === filesUnderDir.length ? 'all' : 'partial';
}

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Storage is untrusted input: these rebuild a mark from scratch and drop
 * anything that is not exactly the shape the model promises.
 */
export function sanitizeSeenEntry(value: unknown): SeenEntry | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const raw = value as { seenAt?: unknown; baseCommit?: unknown };
	if (typeof raw.seenAt !== 'number' || !Number.isFinite(raw.seenAt)) {
		return undefined;
	}
	if (typeof raw.baseCommit !== 'string' || !FULL_SHA.test(raw.baseCommit)) {
		return undefined;
	}
	return { seenAt: raw.seenAt, baseCommit: raw.baseCommit };
}

export function sanitizeSeenRepo(value: unknown): SeenMap {
	const out: SeenMap = {};
	if (typeof value !== 'object' || value === null) {
		return out;
	}
	for (const [relPath, candidate] of Object.entries(value)) {
		const clean = sanitizeSeenEntry(candidate);
		if (clean) {
			out[relPath] = clean;
		}
	}
	return out;
}

/** The whole stored value: one sub-map per repository root. */
export function sanitizeSeenRoots(value: unknown): Record<string, SeenMap> {
	const out: Record<string, SeenMap> = {};
	if (typeof value !== 'object' || value === null) {
		return out;
	}
	for (const [root, repo] of Object.entries(value)) {
		const map = sanitizeSeenRepo(repo);
		if (Object.keys(map).length > 0) {
			out[root] = map;
		}
	}
	return out;
}

/**
 * Bounds a "mark everything" habit: past the limit the oldest marks go, which
 * keeps the newest work rather than whatever was marked first.
 */
export function capSeen(seen: SeenMap, limit: number): SeenMap {
	const entries = Object.entries(seen);
	if (entries.length <= limit) {
		return seen;
	}
	entries.sort((a, b) => a[1].seenAt - b[1].seenAt);
	const kept: SeenMap = {};
	for (const [relPath, entry] of entries.slice(entries.length - Math.max(0, limit))) {
		kept[relPath] = entry;
	}
	return kept;
}
