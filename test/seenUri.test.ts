import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeenRow, seenUriParts, SEEN_SCHEME } from '../src/review/seenUri';

test('a seen file row carries its change kind, so the badge survives dimming', () => {
	const parts = seenUriParts('src/a.ts', { row: 'file', kind: 'modified' });
	assert.equal(parts.scheme, SEEN_SCHEME);
	assert.equal(parts.path, '/src/a.ts');
	assert.deepEqual(parseSeenRow(parts.query), { row: 'file', kind: 'modified' });
});

test('a finished folder row round trips', () => {
	const parts = seenUriParts('src', { row: 'dir' });
	assert.deepEqual(parseSeenRow(parts.query), { row: 'dir' });
});

test('the path always has a leading slash, however it arrives', () => {
	assert.equal(seenUriParts('/src/a.ts', { row: 'dir' }).path, '/src/a.ts');
});

test('an unrecognised query reads as not ours rather than throwing', () => {
	// The decoration provider is asked about every uri on screen.
	for (const query of ['', 'constructor', 'toString', '__proto__', 'File', 'dir~seen']) {
		assert.equal(parseSeenRow(query), undefined, `"${query}" should not resolve to a row`);
	}
});
