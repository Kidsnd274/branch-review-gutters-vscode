/**
 * Pure argument policy for every git invocation. No vscode/node imports, so it
 * is directly unit-testable.
 */

/** The only subcommands this extension is ever allowed to run. All read-only. */
export const ALLOWED_SUBCOMMANDS = [
	'--version',
	'rev-parse',
	'merge-base',
	'symbolic-ref',
	'for-each-ref',
	'cat-file',
	'diff',
	'ls-files',
] as const;

export type AllowedSubcommand = (typeof ALLOWED_SUBCOMMANDS)[number];

export class GitPolicyError extends Error {}

/**
 * Throws unless `args` starts with a whitelisted subcommand and, for `diff`,
 * stays within the read-only `--name-status` shape.
 */
export function assertAllowed(args: readonly string[]): void {
	const sub = args[0];
	if (sub === undefined) {
		throw new GitPolicyError('empty git argument list');
	}
	if (!(ALLOWED_SUBCOMMANDS as readonly string[]).includes(sub)) {
		throw new GitPolicyError(`subcommand not allowed: ${sub}`);
	}
	if (sub === 'diff' && !args.includes('--name-status')) {
		throw new GitPolicyError('git diff is only allowed with --name-status');
	}
}

/**
 * Refs we are willing to hand to git. Deliberately conservative: revision
 * syntax characters are allowed, anything that could be read as an option is
 * not. Guards the case where `--end-of-options` is unavailable (git < 2.24).
 */
const REF_PATTERN = /^[A-Za-z0-9._\/~^@{}:+-]+$/;

export function isValidRef(ref: string): boolean {
	if (ref.length === 0 || ref.length > 512) {
		return false;
	}
	if (ref.startsWith('-')) {
		return false;
	}
	if (ref.includes('..') && !ref.includes('...')) {
		// range syntax is meaningless for us and hides two refs in one string
		return false;
	}
	return REF_PATTERN.test(ref);
}

/** Branch/remote names from settings: stricter, no revision syntax. */
export function isValidBranchName(name: string): boolean {
	if (name.length === 0 || name.length > 256 || name.startsWith('-')) {
		return false;
	}
	return /^[A-Za-z0-9._\/-]+$/.test(name) && !name.includes('..');
}

/** True when the 40-character lowercase hex form of a commit id. */
export function isFullSha(value: string): boolean {
	return /^[0-9a-f]{40}$/.test(value);
}

export interface GitVersion {
	major: number;
	minor: number;
	patch: number;
}

export function parseGitVersion(output: string): GitVersion | undefined {
	const m = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
	if (!m) {
		return undefined;
	}
	return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) };
}

/** `--end-of-options` landed in git 2.24. */
export function supportsEndOfOptions(version: GitVersion | undefined): boolean {
	if (!version) {
		return false;
	}
	return version.major > 2 || (version.major === 2 && version.minor >= 24);
}

/**
 * Builds `rev-parse --verify --quiet [--end-of-options] <rev>^{commit}`.
 * Throws when the ref would not survive {@link isValidRef}.
 */
export function revParseCommitArgs(rev: string, endOfOptions: boolean): string[] {
	if (!isValidRef(rev)) {
		throw new GitPolicyError(`invalid ref: ${rev}`);
	}
	const args = ['rev-parse', '--verify', '--quiet'];
	if (endOfOptions) {
		args.push('--end-of-options');
	}
	args.push(`${rev}^{commit}`);
	return args;
}

export function nameStatusArgs(baseCommit: string, endOfOptions: boolean): string[] {
	if (!isFullSha(baseCommit)) {
		throw new GitPolicyError(`expected a full sha, got: ${baseCommit}`);
	}
	const args = ['diff', '--no-ext-diff', '--no-color', '--no-textconv', '-z', '--name-status', '--find-renames'];
	if (endOfOptions) {
		args.push('--end-of-options');
	}
	args.push(baseCommit, '--');
	return args;
}

/** Builds the `<commit>:<path>` spec for cat-file, rejecting traversal. */
export function blobSpec(commit: string, path: string): string {
	if (!isFullSha(commit)) {
		throw new GitPolicyError(`expected a full sha, got: ${commit}`);
	}
	if (path.length === 0 || path.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(path)) {
		throw new GitPolicyError(`invalid base path: ${path}`);
	}
	return `${commit}:${path}`;
}
