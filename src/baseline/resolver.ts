import type { RepoInfo } from '../git/repositories';
import type { Config } from '../config';
import { buildAutoCandidates, rankCandidates, type RankedCandidate } from './candidates';
import { isValidRef } from '../git/args';
import {
	countCommitsAhead,
	headBranchName,
	headCommit,
	mergeBase,
	remoteDefaultBranch,
	resolveCommit,
} from '../git/refs';
import { selectionRef, type BaseSelection, type Baseline } from './selection';
import * as log from '../util/log';

export * from './selection';
export type { RankedCandidate } from './candidates';

async function autoCandidateNames(root: string, cfg: Config): Promise<string[]> {
	const remoteHead = await remoteDefaultBranch(root, cfg.remote).catch(() => undefined);
	return buildAutoCandidates({
		baseBranches: cfg.baseBranches,
		remote: cfg.remote,
		remoteDefaultBranch: remoteHead,
	});
}

/**
 * Every auto-detection candidate that exists and shares history with `head`,
 * best first. Candidates are measured concurrently; one that fails to resolve
 * or count is simply left out.
 */
export async function rankAutoCandidates(root: string, head: string, cfg: Config): Promise<RankedCandidate[]> {
	const names = await autoCandidateNames(root, cfg);
	const measured = await Promise.all(
		names.map(async (ref): Promise<RankedCandidate | undefined> => {
			const commit = await resolveCommit(root, ref);
			if (!commit) {
				return undefined;
			}
			const base = await mergeBase(root, commit, head);
			if (!base) {
				return undefined;
			}
			const ahead = await countCommitsAhead(root, base, head);
			if (ahead === undefined) {
				return undefined;
			}
			return { ref, commit, mergeBase: base, ahead };
		}),
	);
	const ranked = rankCandidates(measured.filter((c): c is RankedCandidate => c !== undefined));
	if (ranked.length > 0) {
		log.debug(
			`auto candidates for ${root}: ${ranked.map((c) => `${c.ref}@${c.mergeBase.slice(0, 7)}+${c.ahead}`).join(', ')}`,
		);
	}
	return ranked;
}

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

		// --- auto: closest fork point among the configured candidates -----------
		if (selection.kind === 'auto') {
			const best = (await rankAutoCandidates(root, head, cfg))[0];
			if (!best) {
				const tried = await autoCandidateNames(root, cfg);
				return {
					selection,
					status: 'noBase',
					headCommit: head,
					headName,
					message: `Could not find a base branch. Tried: ${tried.length ? tried.join(', ') : '(no valid candidates)'}.`,
				};
			}
			return fromMergeBase(selection, best.ref, best.mergeBase, head, headName);
		}

		// --- manual -----------------------------------------------------------
		if (!isValidRef(selection.ref)) {
			return {
				selection,
				status: 'error',
				headCommit: head,
				headName,
				message: `\`${selection.ref}\` is not a ref this extension will pass to git.`,
			};
		}
		const baseRef = selection.ref;
		const baseRefCommit = await resolveCommit(root, baseRef);
		if (!baseRefCommit) {
			return {
				selection,
				status: 'noBase',
				headCommit: head,
				headName,
				message: `Could not resolve \`${selectionRef(selection)}\`.`,
			};
		}

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
		return fromMergeBase(selection, baseRef, base, head, headName);
	} catch (err) {
		log.error(`baseline resolution failed for ${root}`, err);
		return {
			selection,
			status: 'error',
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

function fromMergeBase(
	selection: BaseSelection,
	baseRef: string,
	base: string,
	head: string,
	headName: string | undefined,
): Baseline {
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
}
