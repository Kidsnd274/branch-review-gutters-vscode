import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { gitLine } from './exec';
import * as log from '../util/log';

/**
 * `git diff` refreshes the index and writes it back even with
 * `GIT_OPTIONAL_LOCKS=0` — that variable only suppresses the write for
 * `git status` and friends. Verified on git 2.50.1.
 *
 * To honour the "never write to the repository" rule we run `diff` against a
 * throwaway copy of the index in the OS temp directory: git rewrites the copy
 * and the repository's own `.git/index` is left byte-for-byte alone. The copy
 * is an exact snapshot taken immediately before the command, so the diff is
 * identical to what a normal invocation would produce.
 */

/** Beyond this the copy costs more than the write we are avoiding. */
const MAX_INDEX_BYTES = 64 * 1024 * 1024;

const gitDirCache = new Map<string, string | undefined>();

async function indexPathFor(repoRoot: string): Promise<string | undefined> {
	if (!gitDirCache.has(repoRoot)) {
		// `--absolute-git-dir` gives the *per-worktree* directory, which is
		// where the index lives even for linked worktrees and submodules.
		gitDirCache.set(repoRoot, await gitLine(repoRoot, ['rev-parse', '--absolute-git-dir']).catch(() => undefined));
	}
	const gitDir = gitDirCache.get(repoRoot);
	return gitDir ? path.join(gitDir, 'index') : undefined;
}

export interface ShadowIndex {
	path: string;
	dispose(): Promise<void>;
}

/**
 * Snapshots the repository index. Returns `undefined` when no snapshot is
 * possible, in which case the caller should run git normally and accept the
 * index refresh.
 */
export async function createShadowIndex(repoRoot: string): Promise<ShadowIndex | undefined> {
	try {
		const source = await indexPathFor(repoRoot);
		if (!source) {
			return undefined;
		}
		const stat = await fs.stat(source).catch(() => undefined);
		if (!stat?.isFile()) {
			return undefined;
		}
		if (stat.size > MAX_INDEX_BYTES) {
			log.warn(
				`index of ${repoRoot} is ${Math.round(stat.size / 1024 / 1024)} MB; running git diff against the real index`,
			);
			return undefined;
		}
		const id = createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
		const target = path.join(os.tmpdir(), `branch-review-gutters-${id}-${process.pid}.index`);
		await fs.copyFile(source, target);
		return {
			path: target,
			dispose: async () => {
				await fs.rm(target, { force: true }).catch(() => undefined);
			},
		};
	} catch (err) {
		log.debug(`could not snapshot the index of ${repoRoot}: ${err instanceof Error ? err.message : String(err)}`);
		return undefined;
	}
}

/** Test seam: forget cached git directories. */
export function resetShadowIndexCache(): void {
	gitDirCache.clear();
}
