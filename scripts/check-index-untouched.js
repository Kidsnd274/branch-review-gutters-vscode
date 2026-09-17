#!/usr/bin/env node
/**
 * Verifies the "never write to the repository" constraint for the change-set
 * path: loads a change set against a real repository and checks that
 * `.git/index` is byte-for-byte unchanged, having first made the index stat
 * data stale, which is what provokes git's refresh write.
 *
 *   npm run compile
 *   node scripts/check-index-untouched.js [repo-path]
 *
 * Defaults to the fixture repository created by make-fixture-repo.sh.
 */

const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// The git layer logs through an OutputChannel; stub just enough of vscode.
const originalLoad = Module._load;
Module._load = function (request) {
	if (request === 'vscode') {
		return { window: { createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }) } };
	}
	// eslint-disable-next-line prefer-rest-params
	return originalLoad.apply(this, arguments);
};

const repo = path.resolve(
	process.argv[2] ?? path.join(os.tmpdir(), 'review-gutters-fixture'),
);

const outDir = path.join(__dirname, '..', 'out');
if (!fs.existsSync(outDir)) {
	console.error('Run "npm run compile" first.');
	process.exit(2);
}

const { loadChangeSet } = require(path.join(outDir, 'src/changes/changeSet'));
const { probeVersion } = require(path.join(outDir, 'src/git/exec'));

function gitDir() {
	return execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repo, encoding: 'utf8' }).trim();
}

(async () => {
	if (!fs.existsSync(repo)) {
		console.error(`No such repository: ${repo}`);
		process.exit(2);
	}
	await probeVersion(repo);

	const indexPath = path.join(gitDir(), 'index');
	const hash = () => crypto.createHash('sha256').update(fs.readFileSync(indexPath)).digest('hex').slice(0, 16);

	const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
	let base = head;
	try {
		base = execFileSync('git', ['merge-base', 'main', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
	} catch {
		console.warn('No "main" branch; comparing against HEAD.');
	}

	// Touch a tracked file so the cached stat data is stale.
	const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' })
		.split('\0')
		.filter(Boolean)[0];
	if (tracked) {
		const now = new Date();
		fs.utimesSync(path.join(repo, tracked), now, now);
	}

	const before = hash();
	const set = await loadChangeSet({ rootFsPath: repo, rootUri: { fsPath: repo } }, base);
	const after = hash();

	console.log(`repository: ${repo}`);
	console.log(`base:       ${base.slice(0, 12)}`);
	console.log(`changes:    ${set.all().length} files`);
	console.log(`index:      ${before} -> ${after}  ${before === after ? 'UNCHANGED' : 'REWRITTEN'}`);
	process.exit(before === after ? 0 : 1);
})();
