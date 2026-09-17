import type { RepoInfo } from '../git/repositories';
import type { Config } from '../config';
import { buildAutoCandidates } from './candidates';
import { isValidRef } from '../git/args';
import { headBranchName, headCommit, mergeBase, remoteDefaultBranch, resolveCommit } from '../git/refs';
import { selectionRef, type BaseSelection, type Baseline } from './selection';
import * as log from '../util/log';

export * from './selection';

export async function resolveBaseline(repo: RepoInfo, selection: BaseSelection, cfg: Config): Promise<Baseline> {
	const root = repo.rootFsPath;
	try {
		const head = await headCommit(root);
		if (!head) {
			return {
				selection,
				status: 'unbornHead',
				message: 'This repository has no commits yet.',
			};
		}
		const headName = await headBranchName(root);

		// --- candidate refs -------------------------------------------------
		let candidates: string[];
		if (selection.kind === 'auto') {
			const remoteHead = await remoteDefaultBranch(root, cfg.remote).catch(() => undefined);
			candidates = buildAutoCandidates({
				baseBranches: cfg.baseBranches,
				remote: cfg.remote,
				remoteDefaultBranch: remoteHead,
			});
		} else {
			if (!isValidRef(selection.ref)) {
				return {
					selection,
					status: 'error',
					headCommit: head,
					headName,
					message: `\`${selection.ref}\` is not a ref this extension will pass to git.`,
				};
			}
			candidates = [selection.ref];
		}

		let baseRef: string | undefined;
		let baseRefCommit: string | undefined;
		for (const candidate of candidates) {
			const sha = await resolveCommit(root, candidate);
			if (sha) {
				baseRef = candidate;
				baseRefCommit = sha;
				break;
			}
		}
		if (!baseRef || !baseRefCommit) {
			const tried = candidates.length ? candidates.join(', ') : '(no valid candidates)';
			return {
				selection,
				status: 'noBase',
				headCommit: head,
				headName,
				message:
					selection.kind === 'auto'
						? `Could not find a base branch. Tried: ${tried}.`
						: `Could not resolve \`${selectionRef(selection)}\`.`,
			};
		}

		// --- exact mode -------------------------------------------------------
		if (selection.kind === 'exact') {
			return {
				selection,
				status: baseRefCommit === head ? 'onBase' : 'ok',
				baseRef,
				baseCommit: baseRefCommit,
				headCommit: head,
				headName,
				message:
					baseRefCommit === head ? `HEAD is exactly \`${baseRef}\`; only uncommitted changes will show.` : undefined,
			};
		}

		// --- merge base -------------------------------------------------------
		const base = await mergeBase(root, baseRefCommit, head);
		if (!base) {
			return {
				selection,
				status: 'noMergeBase',
				baseRef,
				headCommit: head,
				headName,
				message: `\`${baseRef}\` and HEAD share no history.`,
			};
		}
		const onBase = base === head;
		return {
			selection,
			status: onBase ? 'onBase' : 'ok',
			baseRef,
			baseCommit: base,
			headCommit: head,
			headName,
			message: onBase ? `HEAD has no commits beyond \`${baseRef}\`.` : undefined,
		};
	} catch (err) {
		log.error(`baseline resolution failed for ${root}`, err);
		return {
			selection,
			status: 'error',
			message: err instanceof Error ? err.message : String(err),
		};
	}
}
