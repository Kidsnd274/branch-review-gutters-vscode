/** Pure line diff for the deleted-line hints. No vscode imports. */

/** One run of changed lines. Line numbers are 0-based. */
export interface Hunk {
	/** First removed line in the base. */
	oldStart: number;
	oldCount: number;
	/**
	 * First added line in the current text. For a pure deletion this is the line
	 * the removed block used to sit in front of.
	 */
	newStart: number;
	newCount: number;
}

export interface DiffOptions {
	/** Compare lines with leading and trailing whitespace removed, like the gutter does by default. */
	ignoreTrimWhitespace?: boolean;
	/**
	 * Edit distance past which the changed middle of the file is reported as a
	 * single hunk. Bounds both time and the memory the backtrack needs.
	 */
	maxEditDistance?: number;
}

const DEFAULT_MAX_EDIT_DISTANCE = 1000;

/** Splits on LF or CRLF, keeping the empty line after a trailing newline. */
export function splitLines(text: string): string[] {
	return text.split(/\r\n|\n/);
}

/**
 * Myers' O(ND) diff over two line arrays, after trimming the common prefix and
 * suffix so the usual edit costs nothing outside the changed region.
 */
export function diffLines(oldLines: readonly string[], newLines: readonly string[], options: DiffOptions = {}): Hunk[] {
	const key = options.ignoreTrimWhitespace ? (line: string) => line.trim() : (line: string) => line;
	const a = oldLines.map(key);
	const b = newLines.map(key);

	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start++;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	if (start === endA && start === endB) {
		return [];
	}

	const ops = myers(a, b, start, endA, start, endB, options.maxEditDistance ?? DEFAULT_MAX_EDIT_DISTANCE);
	if (!ops) {
		return [{ oldStart: start, oldCount: endA - start, newStart: start, newCount: endB - start }];
	}
	return toHunks(ops, start, start);
}

/** `=` keeps a line, `-` removes one from the base, `+` adds one. */
type Op = '=' | '-' | '+';

function myers(
	a: readonly string[],
	b: readonly string[],
	a0: number,
	a1: number,
	b0: number,
	b1: number,
	maxD: number,
): Op[] | undefined {
	const n = a1 - a0;
	const m = b1 - b0;
	const max = Math.min(n + m, maxD);
	const offset = max + 1;
	const v = new Int32Array(2 * max + 3);
	// trace[d] holds v[-d..d] as it stood after round d.
	const trace: Int32Array[] = [];

	for (let d = 0; d <= max; d++) {
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
					? v[offset + k + 1]
					: v[offset + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				trace.push(v.slice(offset - d, offset + d + 1));
				return backtrack(trace, n, m);
			}
		}
		trace.push(v.slice(offset - d, offset + d + 1));
	}
	return undefined;
}

function backtrack(trace: readonly Int32Array[], n: number, m: number): Op[] {
	const reversed: Op[] = [];
	let x = n;
	let y = m;
	for (let d = trace.length - 1; d > 0; d--) {
		const prev = trace[d - 1];
		const at = (k: number) => prev[k + d - 1];
		const k = x - y;
		const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
		const prevK = down ? k + 1 : k - 1;
		const prevX = at(prevK);
		const prevY = prevX - prevK;
		const midX = down ? prevX : prevX + 1;
		const midY = down ? prevY + 1 : prevY;
		while (x > midX && y > midY) {
			reversed.push('=');
			x--;
			y--;
		}
		reversed.push(down ? '+' : '-');
		x = prevX;
		y = prevY;
	}
	while (x > 0 && y > 0) {
		reversed.push('=');
		x--;
		y--;
	}
	return reversed.reverse();
}

function toHunks(ops: readonly Op[], oldOffset: number, newOffset: number): Hunk[] {
	const hunks: Hunk[] = [];
	let i = oldOffset;
	let j = newOffset;
	let current: Hunk | undefined;
	for (const op of ops) {
		if (op === '=') {
			current = undefined;
			i++;
			j++;
			continue;
		}
		if (!current) {
			current = { oldStart: i, oldCount: 0, newStart: j, newCount: 0 };
			hunks.push(current);
		}
		if (op === '-') {
			current.oldCount++;
			i++;
		} else {
			current.newCount++;
			j++;
		}
	}
	return hunks;
}
