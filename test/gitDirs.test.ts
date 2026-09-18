import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveGitDirs } from '../src/git/gitDirs';

function tmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'brg-gitdirs-'));
}

test('a plain repository uses .git for both HEAD and refs', () => {
	const root = tmp();
	fs.mkdirSync(path.join(root, '.git'));
	assert.deepEqual(resolveGitDirs(root), { gitDir: path.join(root, '.git'), commonDir: path.join(root, '.git') });
});

test('a linked worktree keeps HEAD in its own directory and refs in the common one', () => {
	const main = tmp();
	const worktreeGitDir = path.join(main, '.git', 'worktrees', 'wt');
	fs.mkdirSync(worktreeGitDir, { recursive: true });
	fs.writeFileSync(path.join(worktreeGitDir, 'commondir'), '../..\n');
	const wt = tmp();
	fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${worktreeGitDir}\n`);

	assert.deepEqual(resolveGitDirs(wt), { gitDir: worktreeGitDir, commonDir: path.join(main, '.git') });
});

test('a gitdir file without commondir (submodule) points both at the same directory', () => {
	const root = tmp();
	const target = path.join(root, 'modules', 'sub');
	fs.mkdirSync(target, { recursive: true });
	fs.writeFileSync(path.join(root, '.git'), 'gitdir: modules/sub\n');
	assert.deepEqual(resolveGitDirs(root), { gitDir: target, commonDir: target });
});

test('a missing .git yields undefined', () => {
	assert.equal(resolveGitDirs(tmp()), undefined);
});
