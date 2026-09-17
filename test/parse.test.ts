import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildChangeSet,
	describeCounts,
	parseNameStatusZ,
	resolveBasePath,
	totalChanges,
} from '../src/changes/parse';

const NUL = '\0';
const SHA = 'b'.repeat(40);

function z(...fields: string[]): Buffer {
	return Buffer.from(fields.join(NUL) + NUL, 'utf8');
}

test('parses the simple status letters', () => {
	const changes = parseNameStatusZ(z('M', 'src/modified.ts', 'A', 'src/added.ts', 'D', 'src/gone.ts', 'T', 'link'));
	assert.deepEqual(changes, [
		{ kind: 'modified', path: 'src/modified.ts' },
		{ kind: 'added', path: 'src/added.ts' },
		{ kind: 'deleted', path: 'src/gone.ts' },
		{ kind: 'typeChanged', path: 'link' },
	]);
});

test('renames and copies consume two paths', () => {
	const changes = parseNameStatusZ(
		z('R100', 'src/old.ts', 'src/new.ts', 'C075', 'a.ts', 'b.ts', 'M', 'after.ts'),
	);
	assert.deepEqual(changes, [
		{ kind: 'renamed', path: 'src/new.ts', basePath: 'src/old.ts', similarity: 100 },
		{ kind: 'renamed', path: 'b.ts', basePath: 'a.ts', similarity: 75 },
		{ kind: 'modified', path: 'after.ts' },
	]);
});

test('handles awkward path names', () => {
	const weird = ['sp ace/üñí.ts', '-leading-dash.ts', 'new\nline.ts', 'tab\there.ts'];
	const changes = parseNameStatusZ(z('M', weird[0], 'A', weird[1], 'M', weird[2], 'M', weird[3]));
	assert.deepEqual(
		changes.map((c) => c.path),
		weird,
	);
});

test('tolerates an empty buffer and a truncated record', () => {
	assert.deepEqual(parseNameStatusZ(Buffer.alloc(0)), []);
	assert.deepEqual(parseNameStatusZ(''), []);
	// A status with no path must not produce a half-built entry.
	assert.deepEqual(parseNameStatusZ(z('M')), []);
	assert.deepEqual(parseNameStatusZ(z('R100', 'only-old.ts')), []);
});

test('change set indexes by current path and keeps deletions apart', () => {
	const set = buildChangeSet(
		SHA,
		parseNameStatusZ(z('M', 'a.ts', 'R100', 'old.ts', 'new.ts', 'D', 'gone.ts', 'A', 'fresh.ts')),
		['untracked.ts', 'a.ts'],
	);
	assert.deepEqual([...set.byPath.keys()].sort(), ['a.ts', 'fresh.ts', 'new.ts', 'untracked.ts']);
	assert.deepEqual(
		set.deleted.map((d) => d.path),
		['gone.ts'],
	);
	// A path already known as modified is not re-added as untracked.
	assert.equal(set.byPath.get('a.ts')?.kind, 'modified');
	assert.equal(set.counts.untracked, 1);
	assert.equal(totalChanges(set.counts), 5);
	assert.equal(describeCounts(set.counts), '1 M, 1 A, 1 U, 1 D, 1 R');
});

test('basePathFor is rename-aware', () => {
	const set = buildChangeSet(SHA, parseNameStatusZ(z('M', 'a.ts', 'R100', 'old.ts', 'new.ts', 'A', 'fresh.ts')), [
		'untracked.ts',
	]);
	assert.equal(set.basePathFor('a.ts'), 'a.ts');
	assert.equal(set.basePathFor('new.ts'), 'old.ts');
	assert.equal(set.basePathFor('fresh.ts'), undefined);
	assert.equal(set.basePathFor('untracked.ts'), undefined);
	// Unchanged files still have a base at the same path.
	assert.equal(set.basePathFor('unchanged.ts'), 'unchanged.ts');
});

test('resolveBasePath separates "new file" from "same path"', () => {
	const set = buildChangeSet(SHA, parseNameStatusZ(z('R100', 'old.ts', 'new.ts', 'A', 'fresh.ts')));
	assert.equal(resolveBasePath(set, 'new.ts'), 'old.ts');
	assert.equal(resolveBasePath(set, 'fresh.ts'), null);
	assert.equal(resolveBasePath(set, 'unchanged.ts'), 'unchanged.ts');
	// Before the change set loads, fall back to the same path.
	assert.equal(resolveBasePath(undefined, 'anything.ts'), 'anything.ts');
});

test('all() is sorted and includes deletions', () => {
	const set = buildChangeSet(SHA, parseNameStatusZ(z('M', 'z.ts', 'D', 'a.ts', 'M', 'm.ts')));
	assert.deepEqual(
		set.all().map((c) => c.path),
		['a.ts', 'm.ts', 'z.ts'],
	);
});
