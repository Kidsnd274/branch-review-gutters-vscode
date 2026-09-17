import { execFile } from 'child_process';
import { assertAllowed, parseGitVersion, supportsEndOfOptions, type GitVersion } from './args';
import * as log from '../util/log';

export interface GitResult {
	stdout: Buffer;
	stderr: string;
	code: number;
}

export type GitErrorKind = 'timeout' | 'nonzero' | 'spawn' | 'policy';

export class GitError extends Error {
	constructor(
		readonly kind: GitErrorKind,
		readonly args: readonly string[],
		readonly stderr: string,
		message?: string,
	) {
		super(message ?? `git ${args[0] ?? ''} failed (${kind}): ${stderr.trim()}`);
		this.name = 'GitError';
	}
}

export interface GitOptions {
	maxBuffer?: number;
	allowNonZero?: boolean;
	timeoutMs?: number;
	/**
	 * Point git at a throwaway copy of the index. `git diff` refreshes and
	 * rewrites the index even under `GIT_OPTIONAL_LOCKS=0`, so this is how we
	 * keep the repository's own index byte-for-byte untouched.
	 */
	indexFile?: string;
}

const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

let gitPath = 'git';
let version: GitVersion | undefined;
let versionProbed = false;

export function setGitPath(path: string | undefined): void {
	if (path && path.trim().length > 0) {
		gitPath = path;
	}
}

export function getGitPath(): string {
	return gitPath;
}

/** Environment scrubbed of anything that could redirect git at another repo. */
function buildEnv(indexFile?: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env.GIT_DIR;
	delete env.GIT_WORK_TREE;
	delete env.GIT_INDEX_FILE;
	delete env.GIT_NAMESPACE;
	delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
	env.GIT_OPTIONAL_LOCKS = '0';
	env.GIT_TERMINAL_PROMPT = '0';
	env.GIT_ASKPASS = '';
	env.SSH_ASKPASS = '';
	env.LC_ALL = 'C';
	env.LANG = 'C';
	if (indexFile) {
		env.GIT_INDEX_FILE = indexFile;
	}
	return env;
}

export async function git(repoRoot: string, args: string[], opts: GitOptions = {}): Promise<GitResult> {
	assertAllowed(args);
	const started = Date.now();
	return new Promise<GitResult>((resolve, reject) => {
		execFile(
			gitPath,
			args,
			{
				cwd: repoRoot,
				env: buildEnv(opts.indexFile),
				encoding: 'buffer',
				maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
				timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				windowsHide: true,
			},
			(err, stdout, stderr) => {
				const ms = Date.now() - started;
				const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout));
				const errText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '');
				if (err) {
					const anyErr = err as NodeJS.ErrnoException & {
						code?: number | string;
						killed?: boolean;
						signal?: NodeJS.Signals;
					};
					const killed = anyErr.killed === true || anyErr.signal === 'SIGTERM';
					if (killed) {
						log.warn(`git ${args.join(' ')} [timeout after ${ms}ms]`);
						reject(new GitError('timeout', args, errText));
						return;
					}
					if (typeof anyErr.code === 'string') {
						log.warn(`git ${args.join(' ')} [spawn ${anyErr.code} in ${ms}ms]`);
						reject(new GitError('spawn', args, errText, `cannot run git (${anyErr.code}) at ${gitPath}`));
						return;
					}
					const code = typeof anyErr.code === 'number' ? anyErr.code : 1;
					log.debug(`git ${args.join(' ')} [exit ${code} in ${ms}ms]`);
					if (opts.allowNonZero) {
						resolve({ stdout: out, stderr: errText, code });
						return;
					}
					reject(new GitError('nonzero', args, errText));
					return;
				}
				log.debug(`git ${args.join(' ')} [exit 0 in ${ms}ms, ${out.length}B]`);
				resolve({ stdout: out, stderr: errText, code: 0 });
			},
		);
	});
}

/** Convenience wrapper: trimmed utf-8 stdout, `undefined` on a non-zero exit. */
export async function gitLine(repoRoot: string, args: string[], opts: GitOptions = {}): Promise<string | undefined> {
	const res = await git(repoRoot, args, { ...opts, allowNonZero: true });
	if (res.code !== 0) {
		return undefined;
	}
	const text = res.stdout.toString('utf8').trim();
	return text.length > 0 ? text : undefined;
}

/** Probes `git --version` once per session. */
export async function probeVersion(repoRoot: string): Promise<GitVersion | undefined> {
	if (versionProbed) {
		return version;
	}
	versionProbed = true;
	try {
		const res = await git(repoRoot, ['--version'], { allowNonZero: true, timeoutMs: 5000 });
		version = parseGitVersion(res.stdout.toString('utf8'));
		log.info(`git ${version ? `${version.major}.${version.minor}.${version.patch}` : 'version unknown'} at ${gitPath}`);
	} catch (err) {
		log.error('could not determine git version', err);
	}
	return version;
}

export function endOfOptionsSupported(): boolean {
	return supportsEndOfOptions(version);
}

/** Test seam: forget the probed version. */
export function resetVersionProbeForTests(): void {
	versionProbed = false;
	version = undefined;
}
