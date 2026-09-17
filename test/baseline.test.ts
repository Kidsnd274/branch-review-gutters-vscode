import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoCandidates } from '../src/baseline/candidates';
import { sameSelection, selectionRef } from '../src/baseline/selection';

test('auto candidates are local first, then remote, then remote HEAD', () => {
	assert.deepEqual(
		buildAutoCandidates({
			baseBranches: ['main', 'master'],
			remote: 'origin',
			remoteDefaultBranch: 'origin/develop',
		}),
		['main', 'master', 'origin/main', 'origin/master', 'origin/develop'],
	);
});

test('duplicates collapse to their earliest position', () => {
	assert.deepEqual(
		buildAutoCandidates({
			baseBranches: ['main', 'main'],
			remote: 'origin',
			remoteDefaultBranch: 'origin/main',
		}),
		['main', 'origin/main'],
	);
});

test('invalid branch names are dropped', () => {
	assert.deepEqual(
		buildAutoCandidates({ baseBranches: ['main', '-evil', 'a b', ''], remote: 'origin' }),
		['main', 'origin/main'],
	);
});

test('an unusable remote leaves only the local candidates', () => {
	assert.deepEqual(buildAutoCandidates({ baseBranches: ['main'], remote: '--upload-pack=x' }), ['main']);
});

test('a custom remote is honoured', () => {
	assert.deepEqual(buildAutoCandidates({ baseBranches: ['trunk'], remote: 'upstream' }), [
		'trunk',
		'upstream/trunk',
	]);
});

test('selection helpers', () => {
	assert.equal(selectionRef({ kind: 'auto' }), undefined);
	assert.equal(selectionRef({ kind: 'ref', ref: 'main' }), 'main');
	assert.ok(sameSelection({ kind: 'auto' }, { kind: 'auto' }));
	assert.ok(sameSelection({ kind: 'ref', ref: 'main' }, { kind: 'ref', ref: 'main' }));
	assert.equal(sameSelection({ kind: 'ref', ref: 'main' }, { kind: 'exact', ref: 'main' }), false);
	assert.equal(sameSelection({ kind: 'ref', ref: 'main' }, { kind: 'ref', ref: 'dev' }), false);
});
