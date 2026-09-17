import test from 'node:test';
import assert from 'node:assert/strict';
import {
	ALLOWED_SUBCOMMANDS,
	assertAllowed,
	blobSpec,
	GitPolicyError,
	isFullSha,
	isValidBranchName,
	isValidRef,
	nameStatusArgs,
	parseGitVersion,
	revParseCommitArgs,
	supportsEndOfOptions,
} from '../src/git/args';

const SHA = 'a'.repeat(40);

test('only read-only subcommands are allowed', () => {
	for (const sub of ALLOWED_SUBCOMMANDS) {
		assert.doesNotThrow(() => assertAllowed(sub === 'diff' ? [sub, '--name-status'] : [sub]));
	}
	for (const sub of ['commit', 'add', 'checkout', 'push', 'gc', 'update-index', 'status']) {
		assert.throws(() => assertAllowed([sub]), GitPolicyError, `${sub} must be rejected`);
	}
	assert.throws(() => assertAllowed([]), GitPolicyError);
});

test('git diff is only allowed in its name-status form', () => {
	assert.throws(() => assertAllowed(['diff', 'HEAD']), GitPolicyError);
	assert.doesNotThrow(() => assertAllowed(['diff', '-z', '--name-status', SHA]));
});

test('ref validation rejects option-looking and range input', () => {
	assert.ok(isValidRef('main'));
	assert.ok(isValidRef('feature/x'));
	assert.ok(isValidRef('release/1.0'));
	assert.ok(isValidRef('v1.2'));
	assert.ok(isValidRef('HEAD~3'));
	assert.ok(isValidRef('origin/main'));
	assert.ok(isValidRef('HEAD^{commit}'));
	assert.ok(isValidRef('a'.repeat(40)));

	assert.equal(isValidRef('-foo'), false);
	assert.equal(isValidRef('--upload-pack=evil'), false);
	assert.equal(isValidRef(''), false);
	assert.equal(isValidRef('main..HEAD'), false);
	assert.equal(isValidRef('a b'), false);
	assert.equal(isValidRef('$(touch x)'), false);
	assert.equal(isValidRef(';rm -rf /'), false);
});

test('branch names from settings forbid revision syntax', () => {
	assert.ok(isValidBranchName('main'));
	assert.ok(isValidBranchName('origin/main'));
	assert.equal(isValidBranchName('HEAD~1'), false);
	assert.equal(isValidBranchName('-x'), false);
	assert.equal(isValidBranchName(''), false);
});

test('full sha detection', () => {
	assert.ok(isFullSha(SHA));
	assert.equal(isFullSha('abc1234'), false);
	assert.equal(isFullSha(SHA.toUpperCase()), false);
});

test('rev-parse args carry --end-of-options when supported', () => {
	assert.deepEqual(revParseCommitArgs('main', true), [
		'rev-parse',
		'--verify',
		'--quiet',
		'--end-of-options',
		'main^{commit}',
	]);
	assert.deepEqual(revParseCommitArgs('main', false), ['rev-parse', '--verify', '--quiet', 'main^{commit}']);
	assert.throws(() => revParseCommitArgs('-x', true), GitPolicyError);
});

test('name-status args are read-only and end with a separator', () => {
	const args = nameStatusArgs(SHA, true);
	assert.deepEqual(args, [
		'diff',
		'--no-ext-diff',
		'--no-color',
		'--no-textconv',
		'-z',
		'--name-status',
		'--find-renames',
		'--end-of-options',
		SHA,
		'--',
	]);
	assert.doesNotThrow(() => assertAllowed(args));
	assert.throws(() => nameStatusArgs('main', true), GitPolicyError);
});

test('blob specs reject traversal and absolute paths', () => {
	assert.equal(blobSpec(SHA, 'src/a.ts'), `${SHA}:src/a.ts`);
	assert.throws(() => blobSpec(SHA, '../etc/passwd'), GitPolicyError);
	assert.throws(() => blobSpec(SHA, 'a/../../b'), GitPolicyError);
	assert.throws(() => blobSpec(SHA, '/etc/passwd'), GitPolicyError);
	assert.throws(() => blobSpec('HEAD', 'src/a.ts'), GitPolicyError);
});

test('git version parsing and --end-of-options support', () => {
	assert.deepEqual(parseGitVersion('git version 2.50.1 (Apple Git-155)'), { major: 2, minor: 50, patch: 1 });
	assert.deepEqual(parseGitVersion('git version 2.24'), { major: 2, minor: 24, patch: 0 });
	assert.equal(parseGitVersion('nonsense'), undefined);

	assert.equal(supportsEndOfOptions({ major: 2, minor: 24, patch: 0 }), true);
	assert.equal(supportsEndOfOptions({ major: 2, minor: 23, patch: 9 }), false);
	assert.equal(supportsEndOfOptions({ major: 3, minor: 0, patch: 0 }), true);
	assert.equal(supportsEndOfOptions(undefined), false);
});
