import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createShadowIndex, resetShadowIndexCache } from '../src/git/shadowIndex';

function makeRepo(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-shadow-'));
	execFileSync('git', ['init', '-q', root]);
	fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
	execFileSync('git', ['-C', root, 'add', 'a.txt']);
	return fs.realpathSync(root);
}

test('concurrent snapshots of one repository get distinct files', async () => {
	resetShadowIndexCache();
	const root = makeRepo();
	const [first, second] = await Promise.all([createShadowIndex(root), createShadowIndex(root)]);
	assert.ok(first && second, 'both snapshots were created');
	assert.notEqual(first.path, second.path);
	assert.ok(fs.existsSync(first.path));
	assert.ok(fs.existsSync(second.path));

	await first.dispose();
	assert.ok(!fs.existsSync(first.path), 'disposing one snapshot removes only its own file');
	assert.ok(fs.existsSync(second.path));
	await second.dispose();
});
