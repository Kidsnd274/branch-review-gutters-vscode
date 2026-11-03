/** Pure presentation of removed lines for the editor hints. No vscode imports. */

import type { Hunk } from './lineDiff';

export interface DeletionHint {
	/** 0-based line in the current text the label is drawn at the end of. */
	line: number;
	hunk: Hunk;
	/** Short text drawn after the line. */
	label: string;
	/** Heading of the hover. */
	title: string;
}

/** Past this many lines a hover shows the start of the block and a count. */
export const MAX_HOVER_LINES = 120;

function lines(count: number): string {
	return `${count} line${count === 1 ? '' : 's'}`;
}

/**
 * Where a hunk's label goes. A replacement labels its first new line. A pure
 * deletion labels the line above the gap, so the label reads as "after this
 * line, these were removed"; at the top of the file there is no line above,
 * so it takes the first line instead.
 */
export function anchorLine(hunk: Hunk, newLineCount: number): number {
	const last = Math.max(0, newLineCount - 1);
	if (hunk.newCount > 0) {
		return Math.min(hunk.newStart, last);
	}
	return Math.min(Math.max(0, hunk.newStart - 1), last);
}

/** One hint per hunk that removed anything. Pure additions have nothing to show. */
export function deletionHints(hunks: readonly Hunk[], newLineCount: number): DeletionHint[] {
	const hints: DeletionHint[] = [];
	for (const hunk of hunks) {
		if (hunk.oldCount === 0) {
			continue;
		}
		const pure = hunk.newCount === 0;
		const below = pure && hunk.newStart === 0;
		hints.push({
			line: anchorLine(hunk, newLineCount),
			hunk,
			label: pure ? `− ${lines(hunk.oldCount)} deleted${below ? ' above' : ''}` : `− ${lines(hunk.oldCount)} replaced`,
			title: pure
				? `${lines(hunk.oldCount)} deleted ${below ? 'above this line' : 'after this line'}`
				: `${lines(hunk.oldCount)} replaced by ${lines(hunk.newCount)}`,
		});
	}
	return hints;
}

/** A fence longer than any backtick run in the content, so code cannot close it. */
export function fenceFor(content: readonly string[]): string {
	let longest = 0;
	for (const line of content) {
		for (const run of line.match(/`+/g) ?? []) {
			longest = Math.max(longest, run.length);
		}
	}
	return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The hunk as a fenced `diff` block: removed lines first, then what replaced
 * them, each side cut at `maxLines` with a count of what was left out.
 */
export function hunkDiffBlock(
	oldLines: readonly string[],
	newLines: readonly string[],
	hunk: Hunk,
	maxLines: number = MAX_HOVER_LINES,
): string {
	const body: string[] = [];
	const side = (source: readonly string[], start: number, count: number, sign: '-' | '+', budget: number) => {
		const shown = Math.min(count, budget);
		for (let i = 0; i < shown; i++) {
			body.push(`${sign}${source[start + i] ?? ''}`);
		}
		if (count > shown) {
			body.push(`${sign} … ${lines(count - shown)} more`);
		}
		return shown;
	};
	const used = side(oldLines, hunk.oldStart, hunk.oldCount, '-', maxLines);
	side(newLines, hunk.newStart, hunk.newCount, '+', Math.max(0, maxLines - used));
	const fence = fenceFor(body);
	return `${fence}diff\n${body.join('\n')}\n${fence}`;
}
