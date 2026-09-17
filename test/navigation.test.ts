import test from 'node:test';
import assert from 'node:assert/strict';
import { neighbourIndex } from '../src/util/navigation';

const PATHS = ['a.ts', 'm.ts', 'z.ts'];

test('moves forwards and backwards from a changed file', () => {
	assert.equal(neighbourIndex(PATHS, 'a.ts', 1), 1);
	assert.equal(neighbourIndex(PATHS, 'm.ts', -1), 0);
});

test('wraps at both ends', () => {
	assert.equal(neighbourIndex(PATHS, 'z.ts', 1), 0);
	assert.equal(neighbourIndex(PATHS, 'a.ts', -1), 2);
});

test('with no active file, starts at the appropriate end', () => {
	assert.equal(neighbourIndex(PATHS, undefined, 1), 0);
	assert.equal(neighbourIndex(PATHS, undefined, -1), 2);
});

test('from an unchanged file, moves to the nearest entry in that direction', () => {
	assert.equal(neighbourIndex(PATHS, 'b.ts', 1), 1);
	assert.equal(neighbourIndex(PATHS, 'b.ts', -1), 0);
	// Past the end of the list, wrap around.
	assert.equal(neighbourIndex(PATHS, 'zz.ts', 1), 0);
	assert.equal(neighbourIndex(PATHS, 'zz.ts', -1), 2);
});

test('an empty change set yields no target', () => {
	assert.equal(neighbourIndex([], 'a.ts', 1), -1);
	assert.equal(neighbourIndex([], undefined, -1), -1);
});
