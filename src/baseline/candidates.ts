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
