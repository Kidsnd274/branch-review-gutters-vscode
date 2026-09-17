import test from 'node:test';
import assert from 'node:assert/strict';
import {
	basenamePosix,
	dirnamePosix,
	globToRegExp,
	isDotGitPath,
	isInside,
	makeGlobMatcher,
	posixRelative,
} from '../src/util/paths';

test('posixRelative returns repo-relative paths', () => {
	assert.equal(posixRelative('/repo', '/repo/src/a.ts', false), 'src/a.ts');
	assert.equal(posixRelative('/repo/', '/repo/a.ts', false), 'a.ts');
	assert.equal(posixRelative('/repo', '/other/a.ts', false), undefined);
	// The root itself is not a file in the repository.
	assert.equal(posixRelative('/repo', '/repo', false), undefined);
	// A sibling with a shared prefix must not match.
	assert.equal(posixRelative('/repo', '/repository/a.ts', false), undefined);
});

test('posixRelative honours case sensitivity', () => {
	assert.equal(posixRelative('/Repo', '/repo/a.ts', false), undefined);
	assert.equal(posixRelative('/Repo', '/repo/a.ts', true), 'a.ts');
});

test('windows separators are accepted', () => {
	assert.equal(posixRelative('C:\\repo', 'C:\\repo\\src\\a.ts', true), 'src/a.ts');
	assert.ok(isInside('/repo', '/repo/a.ts', false));
});

test('dot-git detection', () => {
	assert.ok(isDotGitPath('.git'));
	assert.ok(isDotGitPath('.git/config'));
	assert.equal(isDotGitPath('.gitignore'), false);
	assert.equal(isDotGitPath('src/.git-blame'), false);
});

test('path component helpers', () => {
	assert.equal(dirnamePosix('src/a/b.ts'), 'src/a');
	assert.equal(dirnamePosix('b.ts'), '');
	assert.equal(basenamePosix('src/a/b.ts'), 'b.ts');
	assert.equal(basenamePosix('b.ts'), 'b.ts');
});

test('globs without a slash match the basename at any depth', () => {
	const re = globToRegExp('*.lock');
	assert.ok(re.test('package.lock'));
	assert.ok(re.test('deep/nested/package.lock'));
	assert.equal(re.test('package.lock.txt'), false);
});

test('globs with a slash are anchored to the repo root', () => {
	const re = globToRegExp('generated/**');
	assert.ok(re.test('generated/a.ts'));
	assert.ok(re.test('generated/deep/a.ts'));
	assert.equal(re.test('src/generated/a.ts'), false);
});

test('double star matches zero directories', () => {
	const re = globToRegExp('src/**/*.ts');
	assert.ok(re.test('src/a.ts'));
	assert.ok(re.test('src/deep/a.ts'));
	assert.equal(re.test('other/a.ts'), false);
});

test('brace alternatives and single-character wildcards', () => {
	const re = globToRegExp('*.{png,jpg}');
	assert.ok(re.test('a.png'));
	assert.ok(re.test('dir/b.jpg'));
	assert.equal(re.test('a.gif'), false);
	assert.ok(globToRegExp('a?.ts').test('ab.ts'));
	assert.equal(globToRegExp('a?.ts').test('a/b.ts'), false);
});

test('glob special characters are escaped', () => {
	assert.ok(globToRegExp('a+b.ts').test('a+b.ts'));
	assert.equal(globToRegExp('a+b.ts').test('aab.ts'), false);
});

test('matcher combines patterns and ignores empty input', () => {
	const match = makeGlobMatcher(['*.lock', 'generated/**', '  ']);
	assert.ok(match('yarn.lock'));
	assert.ok(match('generated/x.ts'));
	assert.equal(match('src/a.ts'), false);
	assert.equal(makeGlobMatcher([])('anything'), false);
});
