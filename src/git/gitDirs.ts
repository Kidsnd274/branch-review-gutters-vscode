import * as fs from 'fs';
import * as path from 'path';

export interface GitDirs {
	/** Per-worktree directory: holds `HEAD` (and the index). */
	gitDir: string;
	/** Shared directory: holds `refs/` and `packed-refs`. Same as `gitDir` unless linked. */
	commonDir: string;
}

/**
 * Resolves the directories that hold `HEAD` and `refs/`. Handles the worktree
 * and submodule case where `<root>/.git` is a file containing `gitdir: ...`.
 * For a linked worktree `HEAD` lives in the per-worktree directory while the
 * branch refs live in the common directory recorded in `commondir`.
 */
export function resolveGitDirs(rootFsPath: string): GitDirs | undefined {
	const dotGit = path.join(rootFsPath, '.git');
	let stat: fs.Stats;
	try {
		stat = fs.statSync(dotGit);
	} catch {
		return undefined;
	}
	if (stat.isDirectory()) {
		return { gitDir: dotGit, commonDir: dotGit };
	}
	try {
		const contents = fs.readFileSync(dotGit, 'utf8');
		const m = /^gitdir:\s*(.+?)\s*$/m.exec(contents);
		if (!m) {
			return undefined;
		}
		const gitDir = path.isAbsolute(m[1]) ? m[1] : path.resolve(rootFsPath, m[1]);
		const commonDirFile = path.join(gitDir, 'commondir');
		if (fs.existsSync(commonDirFile)) {
			const common = fs.readFileSync(commonDirFile, 'utf8').trim();
			return { gitDir, commonDir: path.isAbsolute(common) ? common : path.resolve(gitDir, common) };
		}
		return { gitDir, commonDir: gitDir };
	} catch {
		return undefined;
	}
}
