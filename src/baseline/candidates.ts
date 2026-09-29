import { isValidBranchName } from '../git/args';

export interface CandidateInput {
	baseBranches: readonly string[];
	remote: string;
	/** Result of `refs/remotes/<remote>/HEAD`, e.g. `origin/main`. */
	remoteDefaultBranch?: string;
}

/**
 * Ordered auto-detection candidates: configured local names first, then the
 * same names on the remote, then the remote's default branch. Invalid names
 * are dropped, and duplicates are collapsed keeping the earliest position.
 */
export function buildAutoCandidates(input: CandidateInput): string[] {
	const out: string[] = [];
	const add = (ref: string) => {
		if (isValidBranchName(ref) && !out.includes(ref)) {
			out.push(ref);
		}
	};
	const remoteOk = isValidBranchName(input.remote);
	for (const name of input.baseBranches) {
		add(name);
	}
	if (remoteOk) {
		for (const name of input.baseBranches) {
			if (isValidBranchName(name)) {
				add(`${input.remote}/${name}`);
			}
		}
	}
	if (input.remoteDefaultBranch) {
		add(input.remoteDefaultBranch);
	}
	return out;
}

/** A candidate that resolved and shares history with HEAD. */
export interface RankedCandidate {
	ref: string;
	/** Full sha the ref points at. */
	commit: string;
	/** Full sha of `merge-base(ref, HEAD)`: the comparison point. */
	mergeBase: string;
	/** Commits on HEAD that the candidate does not have. 0 means HEAD is already in it. */
	ahead: number;
}

/**
 * Orders candidates by how recently HEAD forked from them: the fewest commits
 * ahead wins, because a base that HEAD diverged from later cannot attribute
 * someone else's already-merged work to this branch. This is what makes a
 * fresh `origin/master` beat a stale local `master`, and `develop` beat
 * `master` for a branch cut from `develop`.
 *
 * Candidates that already contain HEAD (`ahead === 0`) would produce an empty
 * comparison, so they go last. Ties keep their configured order.
 */
export function rankCandidates(candidates: readonly RankedCandidate[]): RankedCandidate[] {
	return candidates
		.map((c, index) => ({ c, index }))
		.sort((a, b) => {
			const aEmpty = a.c.ahead === 0;
			const bEmpty = b.c.ahead === 0;
			if (aEmpty !== bEmpty) {
				return aEmpty ? 1 : -1;
			}
			if (a.c.ahead !== b.c.ahead) {
				return a.c.ahead - b.c.ahead;
			}
			return a.index - b.index;
		})
		.map(({ c }) => c);
}
