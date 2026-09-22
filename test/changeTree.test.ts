import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChangeTree, visibleChanges, isDirNode, isFileNode, type DirNode, type FileNode, type TreeNode } from '../src/tree/changeTree';
import { KIND_SEVERITY } from '../src/changes/style';
import type { ChangeKind, FileChange } from '../src/changes/parse';

function change(kind: ChangeKind, path: string, basePath?: string): FileChange {
	return basePath === undefined ? { kind, path } : { kind, path, basePath };
}

function tree(changes: FileChange[], excludes: readonly string[] = []): TreeNode[] {
	const hidden = new Set(excludes);
	return buildChangeTree(changes, { mode: 'tree', isExcluded: (rel) => hidden.has(rel) });
}

function flat(changes: FileChange[], excludes: readonly string[] = []): TreeNode[] {
	const hidden = new Set(excludes);
	return buildChangeTree(changes, { mode: 'list', isExcluded: (rel) => hidden.has(rel) });
}

/** The rendered shape: node paths and kinds, nothing else. */
function shape(nodes: TreeNode[]): unknown[] {
	return nodes.map((n) =>
		n.type === 'dir'
			? { dir: n.path, name: n.name, hint: n.hint, children: shape(n.children) }
			: { file: n.path, kind: n.change.kind },
	);
}

function asDir(node: TreeNode | undefined): DirNode {
	assert.ok(node && node.type === 'dir', `expected a directory, got ${JSON.stringify(node)}`);
	return node;
}

function asFile(node: TreeNode | undefined): FileNode {
	assert.ok(node && node.type === 'file', `expected a file, got ${JSON.stringify(node)}`);
	return node;
}

/** One folder over a set of changes, as { path: kind }, for hint assertions. */
function hintsOf(kinds: [ChangeKind, string][]): Record<string, ChangeKind> {
	const nodes = tree(kinds.map(([kind, name]) => change(kind, `pkg/${name}`)));
	assert.equal(nodes.length, 1);
	const out: Record<string, ChangeKind> = {};
	for (let dir = asDir(nodes[0]); ; dir = asDir(dir.children.find((c) => c.type === 'dir'))) {
		out[dir.path] = dir.hint;
		if (!dir.children.some((c) => c.type === 'dir')) {
			return out;
		}
	}
}

test('groups changed files under the directories that lead to them', () => {
	const nodes = tree([
		change('modified', 'src/app.ts'),
		change('added', 'docs/readme.md'),
		change('modified', 'top.ts'),
		change('modified', 'src/util/deep.ts'),
	]);
	assert.deepEqual(shape(nodes), [
		{
			dir: 'docs',
			name: 'docs',
			hint: 'added',
			children: [{ file: 'docs/readme.md', kind: 'added' }],
		},
		{
			dir: 'src',
			name: 'src',
			hint: 'modified',
			children: [
				{
					dir: 'src/util',
					name: 'util',
					hint: 'modified',
					children: [{ file: 'src/util/deep.ts', kind: 'modified' }],
				},
				{ file: 'src/app.ts', kind: 'modified' },
			],
		},
		{ file: 'top.ts', kind: 'modified' },
	]);
});

test('single-child directories stay their own nodes instead of compacting', () => {
	const nodes = tree([change('modified', 'src/deep/deeper/file.ts')]);
	assert.deepEqual(shape(nodes), [
		{
			dir: 'src',
			name: 'src',
			hint: 'modified',
			children: [
				{
					dir: 'src/deep',
					name: 'deep',
					hint: 'modified',
					children: [
						{
							dir: 'src/deep/deeper',
							name: 'deeper',
							hint: 'modified',
							children: [{ file: 'src/deep/deeper/file.ts', kind: 'modified' }],
						},
					],
				},
			],
		},
	]);
});

test('a folder hint is the most serious kind underneath it', () => {
	assert.equal(KIND_SEVERITY.deleted, 5);
	assert.deepEqual(hintsOf([['added', 'a.ts'], ['deleted', 'b.ts']]), {
		pkg: 'deleted',
	});
	assert.deepEqual(hintsOf([['modified', 'a.ts'], ['deleted', 'b.ts']]), { pkg: 'deleted' });
	assert.deepEqual(hintsOf([['modified', 'a.ts'], ['renamed', 'b.ts']]), { pkg: 'renamed' });
	assert.deepEqual(hintsOf([['added', 'a.ts'], ['renamed', 'b.ts']]), { pkg: 'renamed' });
	assert.deepEqual(hintsOf([['untracked', 'a.ts'], ['added', 'b.ts']]), { pkg: 'added' });
	assert.deepEqual(hintsOf([['untracked', 'a.ts'], ['modified', 'b.ts']]), { pkg: 'modified' });
});

test('modified and typeChanged share a tier, so the tie breaks by path order', () => {
	assert.equal(KIND_SEVERITY.modified, KIND_SEVERITY.typeChanged);
	assert.deepEqual(hintsOf([['modified', 'a.ts'], ['typeChanged', 'b.ts']]), { pkg: 'modified' });
	assert.deepEqual(hintsOf([['typeChanged', 'a.ts'], ['modified', 'b.ts']]), { pkg: 'typeChanged' });
	assert.deepEqual(hintsOf([['typeChanged', 'a.ts'], ['added', 'b.ts']]), { pkg: 'typeChanged' });
});

test('the hint propagates to every ancestor, not just the parent', () => {
	const nodes = tree([
		change('added', 'a/b/c/new.ts'),
		change('deleted', 'a/b/gone.ts'),
		change('untracked', 'a/loose.ts'),
	]);
	const a = asDir(nodes[0]);
	assert.equal(a.path, 'a');
	assert.equal(a.hint, 'deleted');
	const b = asDir(a.children[0]);
	assert.equal(b.path, 'a/b');
	assert.equal(b.hint, 'deleted');
	const c = asDir(b.children[0]);
	assert.equal(c.path, 'a/b/c');
	assert.equal(c.hint, 'added');
});

test('list mode is flat and sorted by full path', () => {
	const nodes = flat([
		change('deleted', 'zeta.ts'),
		change('added', 'alpha/beta.ts'),
		change('modified', 'Alpha.ts'),
		change('renamed', 'm/n.ts', 'm/o.ts'),
	]);
	assert.equal(nodes.every((n) => n.type === 'file'), true);
	assert.deepEqual(
		nodes.map((n) => (n.type === 'file' ? n.path : '<dir>')),
		['Alpha.ts', 'alpha/beta.ts', 'm/n.ts', 'zeta.ts'],
	);
});

test('drops excluded paths and .git internals in both modes', () => {
	const changes = [
		change('modified', 'src/keep.ts'),
		change('added', 'src/generated/sdk.ts'),
		change('modified', '.git/config'),
		change('modified', '.git/HEAD'),
		change('added', '.gitignore'),
	];
	const excludes = ['src/generated/sdk.ts'];
	assert.deepEqual(shape(tree(changes, excludes)), [
		{
			dir: 'src',
			name: 'src',
			hint: 'modified',
			children: [{ file: 'src/keep.ts', kind: 'modified' }],
		},
		{ file: '.gitignore', kind: 'added' },
	]);
	assert.deepEqual(
		flat(changes, excludes).map((n) => (n.type === 'file' ? n.path : '<dir>')),
		['.gitignore', 'src/keep.ts'],
	);
});

test('renames render at the new path with the old path only on the change', () => {
	const nodes = tree([change('renamed', 'src/new.ts', 'src/old.ts')]);
	assert.deepEqual(shape(nodes), [
		{ dir: 'src', name: 'src', hint: 'renamed', children: [{ file: 'src/new.ts', kind: 'renamed' }] },
	]);
	const file = asFile(asDir(nodes[0]).children[0]);
	assert.equal(file.path, 'src/new.ts');
	assert.equal(file.change.basePath, 'src/old.ts');
	assert.doesNotMatch(JSON.stringify(shape(nodes)), /old/);
});

test('deleted files are kept at the path they had at base', () => {
	const nodes = tree([change('deleted', 'src/gone.ts'), change('modified', 'src/stay.ts')]);
	assert.deepEqual(shape(nodes), [
		{
			dir: 'src',
			name: 'src',
			hint: 'deleted',
			children: [
				{ file: 'src/gone.ts', kind: 'deleted' },
				{ file: 'src/stay.ts', kind: 'modified' },
			],
		},
	]);
});

test('a changed path that is also a changed folder renders as the folder', () => {
	const nodes = tree([change('modified', 'pkg'), change('added', 'pkg/inside.ts')]);
	assert.deepEqual(shape(nodes), [
		{ dir: 'pkg', name: 'pkg', hint: 'added', children: [{ file: 'pkg/inside.ts', kind: 'added' }] },
	]);
});

test('awkward path names survive the tree', () => {
	const nodes = tree([
		change('modified', 'sp ace/üñí.ts'),
		change('added', '-leading-dash.ts'),
		change('modified', 'tab\there.ts'),
	]);
	assert.deepEqual(shape(nodes), [
		{
			dir: 'sp ace',
			name: 'sp ace',
			hint: 'modified',
			children: [{ file: 'sp ace/üñí.ts', kind: 'modified' }],
		},
		{ file: '-leading-dash.ts', kind: 'added' },
		{ file: 'tab\there.ts', kind: 'modified' },
	]);
});

test('empty or fully filtered input gives an empty tree in both modes', () => {
	assert.deepEqual(tree([]), []);
	assert.deepEqual(flat([]), []);
	assert.deepEqual(buildChangeTree([change('modified', '.git/HEAD')], { mode: 'tree', isExcluded: () => true }), []);
	assert.deepEqual(buildChangeTree([change('modified', '.git/HEAD')], { mode: 'list', isExcluded: () => true }), []);
});

test('visibleChanges filters and sorts without touching its input', () => {
	const input = [change('modified', 'b.ts'), change('added', 'a.ts'), change('modified', '.git/index')];
	const before = JSON.stringify(input);
	assert.deepEqual(
		visibleChanges(input, (rel) => rel === 'a.ts').map((c) => c.path),
		['b.ts'],
	);
	assert.equal(JSON.stringify(input), before);
});

test('isFileNode recognises the file rows a context menu hands back', () => {
	const nodes = tree([change('modified', 'src/a.ts'), change('added', 'b.ts')]);
	const file = asFile(nodes[1]);
	assert.equal(isFileNode(file), true);
	const nested = asFile(asDir(nodes[0]).children[0]);
	assert.equal(isFileNode(nested), true);
});

test('isFileNode rejects folders and everything that is not a node', () => {
	const nodes = tree([change('modified', 'src/a.ts')]);
	assert.equal(isFileNode(asDir(nodes[0])), false);
	assert.equal(isFileNode(undefined), false);
	assert.equal(isFileNode(null), false);
	assert.equal(isFileNode('src/a.ts'), false);
	assert.equal(isFileNode(42), false);
	assert.equal(isFileNode({ type: 'file' }), false);
	assert.equal(isFileNode({ type: 'file', path: 'a.ts' }), false);
	assert.equal(isFileNode({ type: 'file', path: 1, change: change('modified', 'a.ts') }), false);
	assert.equal(isFileNode({ type: 'dir', path: 'a.ts', change: change('modified', 'a.ts') }), false);
});

test('isDirNode recognises folder rows and nothing else', () => {
	const nodes = tree([change('modified', 'src/a.ts'), change('added', 'b.ts')]);
	assert.equal(isDirNode(asDir(nodes[0])), true);
	assert.equal(isDirNode(asFile(nodes[1])), false);
	assert.equal(isDirNode(undefined), false);
	assert.equal(isDirNode({ type: 'dir', path: 'src' }), false);
	assert.equal(isDirNode({ type: 'dir', children: [] }), false);
});

test('a command payload is not a node and a node is not a command payload', () => {
	// resolveFile has to tell these apart: left-click brings the payload, the
	// context menu brings the element. Neither must satisfy the other's shape.
	const nodes = tree([change('modified', 'src/a.ts'), change('added', 'b.ts')]);
	const file = asFile(nodes[1]);
	const payload = { rootFsPath: '/repo', change: file.change };
	assert.equal(isFileNode(payload), false);
	assert.equal('rootFsPath' in file, false);
});
