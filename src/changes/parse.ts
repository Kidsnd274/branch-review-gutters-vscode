/** Pure parsing and modelling of the change set. No vscode/node imports. */

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'typeChanged';

export interface FileChange {
	kind: ChangeKind;
	/** Repo-relative POSIX path of the file as it exists now (or at base, for deletions). */
	path: string;
	/** Path at the base commit, when it differs from `path`. */
	basePath?: string;
	similarity?: number;
}

export interface ChangeSet {
	baseCommit: string;
	byPath: Map<string, FileChange>;
	deleted: FileChange[];
	basePathFor(path: string): string | undefined;
	counts: Record<ChangeKind, number>;
	/** Every change, deletions included, sorted by path. */
	all(): FileChange[];
}

export const ZERO_COUNTS: Record<ChangeKind, number> = {
	added: 0,
	modified: 0,
	deleted: 0,
	renamed: 0,
	untracked: 0,
	typeChanged: 0,
};

/** Splits a NUL-separated buffer into fields, dropping the trailing empty one. */
function splitZ(text: string): string[] {
	const parts = text.split('\0');
	if (parts.length > 0 && parts[parts.length - 1] === '') {
		parts.pop();
	}
	return parts;
}

/**
 * Parses `git diff -z --name-status --find-renames` output.
 *
 * Record grammar: a status field, then one path, except `R<score>` and
 * `C<score>` which are followed by the old path and then the new path.
 * Unknown status letters are treated as modifications; the caller logs them.
 */
export function parseNameStatusZ(buf: Buffer | string): FileChange[] {
	const text = typeof buf === 'string' ? buf : buf.toString('utf8');
	const fields = splitZ(text);
	const out: FileChange[] = [];
	let i = 0;
	while (i < fields.length) {
		const status = fields[i++];
		if (status.length === 0) {
			continue;
		}
		const letter = status[0];
		const score = Number.parseInt(status.slice(1), 10);
		if (letter === 'R' || letter === 'C') {
			const oldPath = fields[i++];
			const newPath = fields[i++];
			if (oldPath === undefined || newPath === undefined) {
				break;
			}
			out.push({
				kind: 'renamed',
				path: newPath,
				basePath: oldPath,
				similarity: Number.isNaN(score) ? undefined : score,
			});
			continue;
		}
		const path = fields[i++];
		if (path === undefined) {
			break;
		}
		switch (letter) {
			case 'A':
				out.push({ kind: 'added', path });
				break;
			case 'D':
				out.push({ kind: 'deleted', path });
				break;
			case 'T':
				out.push({ kind: 'typeChanged', path });
				break;
			case 'M':
			default:
				out.push({ kind: 'modified', path });
				break;
		}
	}
	return out;
}

/** Status letters this parser understands; anything else falls back to `M`. */
export function isKnownStatusLetter(letter: string): boolean {
	return 'AMDTRC'.includes(letter);
}

export function buildChangeSet(
	baseCommit: string,
	changes: readonly FileChange[],
	untracked: readonly string[] = [],
): ChangeSet {
	const byPath = new Map<string, FileChange>();
	const deleted: FileChange[] = [];
	const counts: Record<ChangeKind, number> = { ...ZERO_COUNTS };

	for (const change of changes) {
		if (change.kind === 'deleted') {
			deleted.push(change);
		} else {
			byPath.set(change.path, change);
		}
		counts[change.kind]++;
	}
	for (const path of untracked) {
		if (byPath.has(path)) {
			continue;
		}
		byPath.set(path, { kind: 'untracked', path });
		counts.untracked++;
	}

	return {
		baseCommit,
		byPath,
		deleted,
		counts,
		basePathFor(path: string): string | undefined {
			const change = byPath.get(path);
			if (!change) {
				return path;
			}
			switch (change.kind) {
				case 'added':
				case 'untracked':
					return undefined;
				case 'renamed':
					return change.basePath ?? path;
				default:
					return path;
			}
		},
		all(): FileChange[] {
			return [...byPath.values(), ...deleted].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		},
	};
}

/**
 * Base path for a file, distinguishing "no base because the file is new"
 * (`null`) from "same path" — which `basePathFor` alone cannot express when the
 * change set has not loaded yet.
 */
export function resolveBasePath(changeSet: ChangeSet | undefined, relPath: string): string | null {
	if (!changeSet) {
		return relPath;
	}
	const change = changeSet.byPath.get(relPath);
	if (!change) {
		return relPath;
	}
	if (change.kind === 'added' || change.kind === 'untracked') {
		return null;
	}
	return change.basePath ?? relPath;
}

export function describeCounts(counts: Record<ChangeKind, number>): string {
	const parts: string[] = [];
	const push = (n: number, label: string) => {
		if (n > 0) {
			parts.push(`${n} ${label}`);
		}
	};
	push(counts.modified + counts.typeChanged, 'M');
	push(counts.added, 'A');
	push(counts.untracked, 'U');
	push(counts.deleted, 'D');
	push(counts.renamed, 'R');
	return parts.join(', ');
}

export function totalChanges(counts: Record<ChangeKind, number>): number {
	return Object.values(counts).reduce((a, b) => a + b, 0);
}
