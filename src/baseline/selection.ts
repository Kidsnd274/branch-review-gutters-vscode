/** Pure baseline value types and helpers. No vscode imports. */

export type BaseSelection =
	| { kind: 'auto' }
	| { kind: 'ref'; ref: string }
	| { kind: 'exact'; ref: string };

export type BaselineStatus = 'ok' | 'onBase' | 'noBase' | 'noMergeBase' | 'unbornHead' | 'error';

export interface Baseline {
	selection: BaseSelection;
	status: BaselineStatus;
	/** The ref the base came from, e.g. `main`, `origin/main`, `v1.2.0`. */
	baseRef?: string;
	/** Full sha actually compared against: a merge base, or the ref itself. */
	baseCommit?: string;
	headCommit?: string;
	/** Branch name, or undefined when HEAD is detached. */
	headName?: string;
	/** Human-readable explanation for a non-ok status. */
	message?: string;
}

export function selectionRef(selection: BaseSelection): string | undefined {
	return selection.kind === 'auto' ? undefined : selection.ref;
}

export function sameSelection(a: BaseSelection, b: BaseSelection): boolean {
	return a.kind === b.kind && selectionRef(a) === selectionRef(b);
}

/** True when the baseline is good enough to render markers for. */
export function isRenderableBaseline(baseline: Baseline | undefined): boolean {
	return baseline?.status === 'ok' || baseline?.status === 'onBase';
}
