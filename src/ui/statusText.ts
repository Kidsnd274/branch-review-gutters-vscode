/** Pure status-bar rendering. No vscode imports. */

import type { BaseSelection, BaselineStatus } from '../baseline/selection';

export interface StatusInput {
	hasRepository: boolean;
	enabled: boolean;
	status: BaselineStatus;
	selection: BaseSelection;
	baseRef?: string;
	baseCommit?: string;
	headName?: string;
	headCommit?: string;
	message?: string;
	/** e.g. "8 M, 3 A, 1 D"; empty when the change set has not loaded. */
	countsSummary?: string;
	fileCount?: number;
	skippedCount?: number;
}

export type StatusSeverity = 'none' | 'warning' | 'error';

export interface StatusOutput {
	hidden: boolean;
	text: string;
	tooltip: string;
	severity: StatusSeverity;
}

const MAX_REF = 24;

export function truncateRef(ref: string, max = MAX_REF): string {
	return ref.length <= max ? ref : `${ref.slice(0, max - 1)}…`;
}

function short(sha: string | undefined): string {
	return sha ? sha.slice(0, 7) : 'unknown';
}

export function renderStatus(input: StatusInput): StatusOutput {
	if (!input.hasRepository) {
		return { hidden: true, text: '', tooltip: '', severity: 'none' };
	}

	const ref = input.baseRef ? truncateRef(input.baseRef) : undefined;
	const lines: string[] = [];

	if (!input.enabled) {
		const base = input.baseRef
			? `Base would be **${input.baseRef}** (merge base \`${short(input.baseCommit)}\`).`
			: 'No base branch detected yet.';
		return {
			hidden: false,
			text: '$(git-compare) Review: off',
			tooltip: `Branch review gutters are off. ${base}\n\nClick for options.`,
			severity: 'none',
		};
	}

	switch (input.status) {
		case 'ok':
		case 'onBase': {
			const exact = input.selection.kind === 'exact';
			const label = exact ? `@${short(input.baseCommit)}` : (ref ?? 'base');
			const suffix = input.status === 'onBase' ? ' (on base)' : '';
			if (exact) {
				lines.push(`Comparing exactly against \`${short(input.baseCommit)}\` (${input.baseRef}), no merge base.`);
			} else {
				lines.push(`Base: **${input.baseRef}**`);
				lines.push(`Merge base: \`${short(input.baseCommit)}\``);
			}
			lines.push(`HEAD: ${input.headName ? `**${input.headName}**` : `detached at \`${short(input.headCommit)}\``}`);
			if (input.status === 'onBase') {
				lines.push(`HEAD has no commits beyond ${input.baseRef}; only uncommitted changes will show.`);
			}
			if (input.fileCount !== undefined) {
				const detail = input.countsSummary ? ` (${input.countsSummary})` : '';
				lines.push(`${input.fileCount} file${input.fileCount === 1 ? '' : 's'} changed${detail}`);
			}
			if (input.skippedCount) {
				lines.push(`${input.skippedCount} file${input.skippedCount === 1 ? '' : 's'} skipped (binary or too large)`);
			}
			lines.push('', 'Click for options.');
			return {
				hidden: false,
				text: `$(git-compare) Review: ${label}${suffix}`,
				tooltip: lines.join('\n\n'),
				severity: 'none',
			};
		}
		case 'noBase':
			return {
				hidden: false,
				text: '$(warning) Review: no base',
				tooltip: `${input.message ?? 'No base branch found.'}\n\nClick to select a base.`,
				severity: 'warning',
			};
		case 'noMergeBase':
			return {
				hidden: false,
				text: '$(warning) Review: unrelated',
				tooltip: `${input.message ?? 'The base and HEAD share no history.'}\n\nClick to select another base.`,
				severity: 'warning',
			};
		case 'unbornHead':
			return {
				hidden: false,
				text: '$(error) Review: no commits',
				tooltip: `${input.message ?? 'This repository has no commits yet.'}\n\nClick for options.`,
				severity: 'error',
			};
		case 'error':
		default:
			return {
				hidden: false,
				text: '$(error) Review: git error',
				tooltip: `${input.message ?? 'A git command failed.'}\n\nClick for options, or run "Review Gutters: Show Log".`,
				severity: 'error',
			};
	}
}
