import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, splitLines, type Hunk } from '../src/changes/lineDiff';

/** Rebuilds the new text from the old one and the hunks, which any correct diff must allow. */
function apply(oldLines: readonly string[], newLines: readonly string[], hunks: readonly Hunk[]): string[] {
	const out: string[] = [];
	let i = 0;
	for (const h of hunks) {
		out.push(...oldLines.slice(i, h.oldStart));
		out.push(...newLines.slice(h.newStart, h.newStart + h.newCount));
		i = h.oldStart + h.oldCount;
	}
	out.push(...oldLines.slice(i));
	return out;
}

/** Fewest lines removed plus added, by the textbook LCS table. */
function minimalEdits(a: readonly string[], b: readonly string[]): number {
	const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
		}
	}
	return a.length + b.length - 2 * t[0][0];
}

function edits(hunks: readonly Hunk[]): number {
	return hunks.reduce((n, h) => n + h.oldCount + h.newCount, 0);
}

test('identical text has no hunks', () => {
	assert.deepEqual(diffLines(['a', 'b'], ['a', 'b']), []);
	assert.deepEqual(diffLines([], []), []);
});

test('a pure deletion points at the line the block sat in front of', () => {
	const hunks = diffLines(['a', 'b', 'c', 'd'], ['a', 'd']);
	assert.deepEqual(hunks, [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 0 }]);
});

test('a replacement is one hunk with both counts', () => {
	const oldLines = ['import x', '', 'fn() {', '  one', '  two', '  three', '}'];
	const newLines = ['import y', '', 'fn() {', '  uno', '  dos', '}'];
	assert.deepEqual(diffLines(oldLines, newLines), [
		{ oldStart: 0, oldCount: 1, newStart: 0, newCount: 1 },
		{ oldStart: 3, oldCount: 3, newStart: 3, newCount: 2 },
	]);
});

test('deleting everything and adding to an empty file', () => {
	assert.deepEqual(diffLines(['a', 'b'], ['']), [{ oldStart: 0, oldCount: 2, newStart: 0, newCount: 1 }]);
	assert.deepEqual(diffLines([], ['a']), [{ oldStart: 0, oldCount: 0, newStart: 0, newCount: 1 }]);
	assert.deepEqual(diffLines(['a'], []), [{ oldStart: 0, oldCount: 1, newStart: 0, newCount: 0 }]);
});

test('ignoreTrimWhitespace hides indentation-only changes', () => {
	assert.deepEqual(diffLines(['  a', 'b'], ['a', 'b  ']), [{ oldStart: 0, oldCount: 2, newStart: 0, newCount: 2 }]);
	assert.deepEqual(diffLines(['  a', 'b'], ['a', 'b  '], { ignoreTrimWhitespace: true }), []);
});

test('past the edit budget the changed middle becomes one hunk', () => {
	const oldLines = ['head', 'a', 'b', 'c', 'tail'];
	const newLines = ['head', 'x', 'y', 'z', 'tail'];
	assert.deepEqual(diffLines(oldLines, newLines, { maxEditDistance: 2 }), [
		{ oldStart: 1, oldCount: 3, newStart: 1, newCount: 3 },
	]);
});

test('random edits: hunks rebuild the new text and are minimal', () => {
	let seed = 42;
	const rand = (n: number) => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed % n;
	};
	for (let round = 0; round < 400; round++) {
		const alphabet = 2 + rand(5);
		const oldLines = Array.from({ length: rand(25) }, () => `l${rand(alphabet)}`);
		const newLines = oldLines.slice();
		for (let e = rand(8); e > 0; e--) {
			const at = rand(newLines.length + 1);
			if (rand(2) === 0 && newLines.length > 0) {
				newLines.splice(Math.min(at, newLines.length - 1), 1 + rand(3));
			} else {
				newLines.splice(at, 0, ...Array.from({ length: 1 + rand(3) }, () => `l${rand(alphabet)}`));
			}
		}
		const hunks = diffLines(oldLines, newLines);
		assert.deepEqual(apply(oldLines, newLines, hunks), newLines, `round ${round}`);
		assert.equal(edits(hunks), minimalEdits(oldLines, newLines), `round ${round} is not minimal`);
		for (let k = 1; k < hunks.length; k++) {
			assert.ok(hunks[k].oldStart > hunks[k - 1].oldStart + hunks[k - 1].oldCount - 1, `round ${round}: overlap`);
		}
	}
});

test('splitLines treats CRLF and LF alike', () => {
	assert.deepEqual(splitLines('a\r\nb\nc'), ['a', 'b', 'c']);
	assert.deepEqual(splitLines('a\n'), ['a', '']);
});
