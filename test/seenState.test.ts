import test from 'node:test';
import assert from 'node:assert/strict';
import {
	capSeen,
	countSeen,
	folderSeenState,
	isSeen,
	pruneSeen,
	sanitizeSeenEntry,
	sanitizeSeenRepo,
	sanitizeSeenRoots,
	seenProgress,
	type SeenEntry,
	type SeenMap,
} from '../src/review/seenState';
import type { ChangeKind, FileChange } from '../src/changes/parse';

const BASE_A = 'a'.repeat(40);
const BASE_B = 'b'.repeat(40);

function entry(baseCommit: string, seenAt = 1000): SeenEntry {
	return { seenAt, baseCommit };
}

function seen(map: Record<string, SeenEntry>): SeenMap {
	return map;
}

function change(kind: ChangeKind, path: string): FileChange {
	return { kind, path };
}

test('a mark counts only against the base it was set on', () => {
	const marks = seen({ 'src/a.ts': entry(BASE_A) });
	assert.equal(isSeen(marks, 'src/a.ts', BASE_A), true);
	assert.equal(isSeen(marks, 'src/a.ts', BASE_B), false);
});

test('an unmarked path is unseen against any base', () => {
	assert.equal(isSeen(seen({}), 'src/a.ts', BASE_A), false);
	assert.equal(isSeen(seen({}), 'src/a.ts', BASE_B), false);
});

test('inherited Object properties are not marks', () => {
	const marks = seen({});
	// A repository can legitimately contain a file named after an Object member.
	assert.equal(isSeen(marks, 'toString', BASE_A), false);
	assert.equal(isSeen(marks, 'constructor', BASE_A), false);
	assert.equal(isSeen(marks, '__proto__', BASE_A), false);
	assert.equal(isSeen(marks, 'hasOwnProperty', BASE_A), false);
});

test('countSeen ignores paths that are absent or on another base', () => {
	const marks = seen({ 'a.ts': entry(BASE_A), 'b.ts': entry(BASE_B) });
	const paths = ['a.ts', 'b.ts', 'c.ts'];
	assert.equal(countSeen(marks, paths, BASE_A), 1);
	assert.equal(countSeen(marks, paths, BASE_B), 1);
	assert.equal(countSeen(marks, [], BASE_A), 0);
});

test('seenProgress totals every change regardless of kind', () => {
	const changes = [
		change('modified', 'a.ts'),
		change('added', 'b.ts'),
		change('deleted', 'c.ts'),
		change('renamed', 'd.ts'),
		change('untracked', 'e.ts'),
		change('typeChanged', 'f.ts'),
	];
	const marks = seen({ 'a.ts': entry(BASE_A), 'c.ts': entry(BASE_A), 'd.ts': entry(BASE_B) });
	assert.deepEqual(seenProgress(marks, changes, BASE_A), { seen: 2, total: 6 });
	assert.deepEqual(seenProgress(marks, [], BASE_A), { seen: 0, total: 0 });
	assert.deepEqual(seenProgress(seen({}), changes, BASE_A), { seen: 0, total: 6 });
});

test('a rename is marked at its new path only', () => {
	const marks = seen({ 'src/new.ts': entry(BASE_A) });
	assert.equal(isSeen(marks, 'src/new.ts', BASE_A), true);
	assert.equal(isSeen(marks, 'src/old.ts', BASE_A), false);
});

test('pruneSeen keeps live paths and drops the rest', () => {
	const marks = seen({
		'keep.ts': entry(BASE_A),
		'also/keep.ts': entry(BASE_A),
		'gone.ts': entry(BASE_A),
	});
	const pruned = pruneSeen(marks, new Set(['keep.ts', 'also/keep.ts', 'brand/new.ts']));
	assert.deepEqual(Object.keys(pruned).sort(), ['also/keep.ts', 'keep.ts']);
	assert.deepEqual(pruned['keep.ts'], entry(BASE_A));
});

test('pruneSeen on empty input or an empty live set is total', () => {
	assert.deepEqual(pruneSeen(seen({}), new Set(['a.ts'])), {});
	assert.deepEqual(pruneSeen(seen({ 'a.ts': entry(BASE_A) }), new Set()), {});
});

test('pruneSeen does not mutate its input', () => {
	const marks = seen({ 'a.ts': entry(BASE_A), 'b.ts': entry(BASE_A) });
	const before = JSON.stringify(marks);
	pruneSeen(marks, new Set(['a.ts']));
	assert.equal(JSON.stringify(marks), before);
});

test('folderSeenState reads none, partial and all', () => {
	const files = ['d/a.ts', 'd/b.ts', 'd/c.ts'];
	assert.equal(folderSeenState(seen({}), files, BASE_A), 'none');
	assert.equal(folderSeenState(seen({ 'd/a.ts': entry(BASE_A) }), files, BASE_A), 'partial');
	assert.equal(
		folderSeenState(seen({ 'd/a.ts': entry(BASE_A), 'd/b.ts': entry(BASE_A), 'd/c.ts': entry(BASE_A) }), files, BASE_A),
		'all',
	);
});

test('a folder whose marks are all on a stale base reads as none', () => {
	const files = ['d/a.ts', 'd/b.ts'];
	const marks = seen({ 'd/a.ts': entry(BASE_B), 'd/b.ts': entry(BASE_B) });
	assert.equal(folderSeenState(marks, files, BASE_A), 'none');
});

test('folderSeenState on an empty folder is none, not all', () => {
	assert.equal(folderSeenState(seen({ 'x.ts': entry(BASE_A) }), [], BASE_A), 'none');
});

test('a single file folder reaches all with one mark', () => {
	assert.equal(folderSeenState(seen({ 'd/only.ts': entry(BASE_A) }), ['d/only.ts'], BASE_A), 'all');
});

test('capSeen keeps the newest marks past the limit', () => {
	const marks = seen({
		'old.ts': entry(BASE_A, 100),
		'mid.ts': entry(BASE_A, 200),
		'new.ts': entry(BASE_A, 300),
	});
	const capped = capSeen(marks, 2);
	assert.deepEqual(Object.keys(capped).sort(), ['mid.ts', 'new.ts']);
});

test('capSeen leaves a map under the limit alone', () => {
	const marks = seen({ 'a.ts': entry(BASE_A, 1), 'b.ts': entry(BASE_A, 2) });
	assert.equal(capSeen(marks, 2), marks);
	assert.equal(capSeen(marks, 2000), marks);
	assert.deepEqual(capSeen(seen({}), 3), {});
});

test('capSeen with a zero limit empties the map', () => {
	assert.deepEqual(capSeen(seen({ 'a.ts': entry(BASE_A, 1) }), 0), {});
});

test('sanitizeSeenEntry accepts only a finite seenAt and a 40-hex base', () => {
	assert.deepEqual(sanitizeSeenEntry({ seenAt: 5, baseCommit: BASE_A }), { seenAt: 5, baseCommit: BASE_A });
	assert.equal(sanitizeSeenEntry({ seenAt: '5', baseCommit: BASE_A }), undefined);
	assert.equal(sanitizeSeenEntry({ seenAt: Number.NaN, baseCommit: BASE_A }), undefined);
	assert.equal(sanitizeSeenEntry({ seenAt: Infinity, baseCommit: BASE_A }), undefined);
	assert.equal(sanitizeSeenEntry({ seenAt: 5 }), undefined);
	assert.equal(sanitizeSeenEntry({ seenAt: 5, baseCommit: 'abc123' }), undefined);
	assert.equal(sanitizeSeenEntry({ seenAt: 5, baseCommit: 'A'.repeat(40) }), undefined);
	assert.equal(sanitizeSeenEntry(null), undefined);
	assert.equal(sanitizeSeenEntry('seen'), undefined);
	assert.equal(sanitizeSeenEntry(1), undefined);
});

test('sanitizeSeenRepo drops bad entries but keeps the good ones', () => {
	const cleaned = sanitizeSeenRepo({
		'good.ts': { seenAt: 1, baseCommit: BASE_A },
		'bad-base.ts': { seenAt: 1, baseCommit: 'nope' },
		'bad-time.ts': { seenAt: 'yesterday', baseCommit: BASE_A },
		'not-an-object.ts': 'yes',
	});
	assert.deepEqual(Object.keys(cleaned), ['good.ts']);
});

test('sanitizeSeenRepo ignores inherited keys and non-objects', () => {
	assert.deepEqual(sanitizeSeenRepo(null), {});
	assert.deepEqual(sanitizeSeenRepo('nonsense'), {});
	const bare = Object.create({ 'poisoned.ts': { seenAt: 1, baseCommit: BASE_A } });
	assert.deepEqual(sanitizeSeenRepo(bare), {});
});

test('sanitizeSeenRoots keeps one good repository and drops empty or broken ones', () => {
	const cleaned = sanitizeSeenRoots({
		'/good': { 'a.ts': { seenAt: 1, baseCommit: BASE_A } },
		'/empty': {},
		'/broken': 'not a map',
		'/all-bad': { 'a.ts': { seenAt: 'x', baseCommit: 'y' } },
	});
	assert.deepEqual(Object.keys(cleaned), ['/good']);
});

test('sanitizeSeenRoots survives a whole value that is not an object', () => {
	assert.deepEqual(sanitizeSeenRoots(undefined), {});
	assert.deepEqual(sanitizeSeenRoots(null), {});
	assert.deepEqual(sanitizeSeenRoots([1, 2, 3]), {});
});
