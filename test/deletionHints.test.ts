import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorLine, deletionHints, fenceFor, hunkDiffBlock } from '../src/changes/deletionHints';

test('a pure deletion is labelled on the line above the gap', () => {
	const [hint] = deletionHints([{ oldStart: 4, oldCount: 3, newStart: 3, newCount: 0 }], 10);
	assert.equal(hint.line, 2);
	assert.equal(hint.label, '− 3 lines deleted');
	assert.equal(hint.title, '3 lines deleted after this line');
});

test('a deletion at the top of the file is labelled on line 1, as above it', () => {
	const [hint] = deletionHints([{ oldStart: 0, oldCount: 1, newStart: 0, newCount: 0 }], 5);
	assert.equal(hint.line, 0);
	assert.equal(hint.label, '− 1 line deleted above');
	assert.equal(hint.title, '1 line deleted above this line');
});

test('a replacement is labelled on its first new line', () => {
	const [hint] = deletionHints([{ oldStart: 4, oldCount: 3, newStart: 3, newCount: 2 }], 10);
	assert.equal(hint.line, 3);
	assert.equal(hint.label, '− 3 lines replaced');
	assert.equal(hint.title, '3 lines replaced by 2 lines');
});

test('pure additions get no hint', () => {
	assert.deepEqual(deletionHints([{ oldStart: 2, oldCount: 0, newStart: 2, newCount: 4 }], 10), []);
});

test('anchors never fall past the last line', () => {
	assert.equal(anchorLine({ oldStart: 3, oldCount: 2, newStart: 3, newCount: 0 }, 3), 2);
	assert.equal(anchorLine({ oldStart: 0, oldCount: 2, newStart: 0, newCount: 0 }, 0), 0);
});

test('the hover block lists removed lines, then their replacement', () => {
	const block = hunkDiffBlock(['keep', 'old one', 'old two'], ['keep', 'new'], {
		oldStart: 1,
		oldCount: 2,
		newStart: 1,
		newCount: 1,
	});
	assert.equal(block, '```diff\n-old one\n-old two\n+new\n```');
});

test('long blocks are cut with a count of what is left', () => {
	const old = Array.from({ length: 10 }, (_, i) => `l${i}`);
	const block = hunkDiffBlock(old, [], { oldStart: 0, oldCount: 10, newStart: 0, newCount: 0 }, 3);
	assert.equal(block, '```diff\n-l0\n-l1\n-l2\n- … 7 lines more\n```');
});

test('code containing backticks gets a longer fence', () => {
	assert.equal(fenceFor(['plain']), '```');
	assert.equal(fenceFor(['const s = ```md```;']), '````');
});
