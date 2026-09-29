import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoCandidates, rankCandidates, type RankedCandidate } from '../src/baseline/candidates';
import { sameSelection, selectionRef } from '../src/baseline/selection';

const HEAD = 'h'.repeat(40);
const candidate = (ref: string, ahead: number, mergeBase = ref.padEnd(40, '0')): RankedCandidate => ({
	ref,
	commit: ref.padEnd(40, '1'),
	mergeBase,
	ahead,
});

test('the candidate HEAD forked from most recently ranks first', () => {
	// A branch cut from develop: master's fork point is older, so it sees more commits.
	const ranked = rankCandidates([candidate('master', 40), candidate('develop', 3)]);
	assert.deepEqual(
		ranked.map((c) => c.ref),
		['develop', 'master'],
	);
});

test('a fresh remote branch beats its stale local twin', () => {
	const ranked = rankCandidates([candidate('master', 182), candidate('origin/master', 14)]);
	assert.equal(ranked[0].ref, 'origin/master');
});

test('candidates that already contain HEAD rank last', () => {
	const ranked = rankCandidates([candidate('uat', 0, HEAD), candidate('master', 14), candidate('test', 2)]);
	assert.deepEqual(
		ranked.map((c) => c.ref),
		['test', 'master', 'uat'],
	);
});

test('ties keep the configured order', () => {
	const ranked = rankCandidates([candidate('main', 5), candidate('origin/main', 5), candidate('release', 5)]);
	assert.deepEqual(
		ranked.map((c) => c.ref),
		['main', 'origin/main', 'release'],
	);
	assert.deepEqual(rankCandidates([candidate('a', 0), candidate('b', 0)]).map((c) => c.ref), ['a', 'b']);
});

test('ranking does not mutate its input', () => {
	const input = [candidate('master', 40), candidate('develop', 3)];
	rankCandidates(input);
	assert.equal(input[0].ref, 'master');
	assert.deepEqual(rankCandidates([]), []);
});

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
