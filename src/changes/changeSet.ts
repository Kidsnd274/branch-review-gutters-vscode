import type { RepoInfo } from '../git/repositories';
import { git, endOfOptionsSupported } from '../git/exec';
import { nameStatusArgs } from '../git/args';
import { createShadowIndex } from '../git/shadowIndex';
import { buildChangeSet, parseNameStatusZ, type ChangeSet } from './parse';
import * as log from '../util/log';

const SLOW_MS = 5000;

export async function loadChangeSet(repo: RepoInfo, baseCommit: string): Promise<ChangeSet> {
	const started = Date.now();

	// Both commands are run against a snapshot of the index, so git's refresh
	// rewrites the copy and never the repository's own index. See
	// git/shadowIndex.ts for why GIT_OPTIONAL_LOCKS is not enough.
	const shadow = await createShadowIndex(repo.rootFsPath);
	const indexFile = shadow?.path;
	try {
		const diff = await git(repo.rootFsPath, nameStatusArgs(baseCommit, endOfOptionsSupported()), { indexFile });
		const changes = parseNameStatusZ(diff.stdout);

		let untracked: string[] = [];
		try {
			const others = await git(repo.rootFsPath, ['ls-files', '--others', '--exclude-standard', '-z'], {
				indexFile,
			});
			untracked = others.stdout
				.toString('utf8')
				.split('\0')
				.filter((p) => p.length > 0);
		} catch (err) {
			log.error(`could not list untracked files in ${repo.rootFsPath}`, err);
		}

		const elapsed = Date.now() - started;
		if (elapsed > SLOW_MS) {
			log.warn(`change set for ${repo.rootFsPath} took ${elapsed}ms`);
		}
		const set = buildChangeSet(baseCommit, changes, untracked);
		log.debug(`change set ${baseCommit.slice(0, 7)}: ${set.byPath.size} tracked, ${set.deleted.length} deleted`);
		return set;
	} finally {
		await shadow?.dispose();
	}
}

export type { ChangeSet };
