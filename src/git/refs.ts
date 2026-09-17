import { git, gitLine, endOfOptionsSupported } from './exec';
import { isValidRef, revParseCommitArgs } from './args';

export interface RefEntry {
	shortName: string;
	fullName: string;
	shortSha: string;
	relativeDate: string;
	kind: 'head' | 'remote' | 'tag';
}

/** Resolves any revision to a full commit sha, or `undefined` if it is unknown. */
export async function resolveCommit(repoRoot: string, rev: string): Promise<string | undefined> {
	if (!isValidRef(rev)) {
		return undefined;
	}
	return gitLine(repoRoot, revParseCommitArgs(rev, endOfOptionsSupported()));
}

export async function headCommit(repoRoot: string): Promise<string | undefined> {
	return gitLine(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']);
}

/** Current branch name, or `undefined` when HEAD is detached. */
export async function headBranchName(repoRoot: string): Promise<string | undefined> {
	return gitLine(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
}

/** The merge base of two commits, or `undefined` for unrelated histories. */
export async function mergeBase(repoRoot: string, a: string, b: string): Promise<string | undefined> {
	return gitLine(repoRoot, ['merge-base', a, b]);
}

export async function isAncestor(repoRoot: string, maybeAncestor: string, descendant: string): Promise<boolean> {
	const res = await git(repoRoot, ['merge-base', '--is-ancestor', maybeAncestor, descendant], {
		allowNonZero: true,
	});
	return res.code === 0;
}

/**
 * The remote's default branch, e.g. `origin/main`, from
 * `refs/remotes/<remote>/HEAD`. Returns `undefined` when the symref is absent.
 */
export async function remoteDefaultBranch(repoRoot: string, remote: string): Promise<string | undefined> {
	const full = await gitLine(repoRoot, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]);
	if (!full) {
		return undefined;
	}
	return full.startsWith('refs/remotes/') ? full.slice('refs/remotes/'.length) : undefined;
}

const REF_FORMAT = '%(refname:short)%00%(objectname:short)%00%(committerdate:relative)%00%(refname)';

export async function listRefs(repoRoot: string): Promise<RefEntry[]> {
	const res = await git(repoRoot, [
		'for-each-ref',
		`--format=${REF_FORMAT}`,
		'refs/heads',
		'refs/remotes',
		'refs/tags',
	]);
	return parseForEachRef(res.stdout.toString('utf8'));
}

export function parseForEachRef(text: string): RefEntry[] {
	const out: RefEntry[] = [];
	for (const line of text.split('\n')) {
		if (line.trim().length === 0) {
			continue;
		}
		const [shortName, shortSha, relativeDate, fullName] = line.split('\0');
		if (!shortName || !fullName) {
			continue;
		}
		// `refs/remotes/origin/HEAD` is a symref alias, not a branch to review.
		if (fullName.endsWith('/HEAD')) {
			continue;
		}
		const kind = fullName.startsWith('refs/heads/')
			? 'head'
			: fullName.startsWith('refs/remotes/')
				? 'remote'
				: 'tag';
		out.push({ shortName, fullName, shortSha: shortSha ?? '', relativeDate: relativeDate ?? '', kind });
	}
	return out;
}
