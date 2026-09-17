import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStatus, truncateRef, type StatusInput } from '../src/ui/statusText';

const SHA = '1a2b3c4d'.repeat(5);

function input(patch: Partial<StatusInput> = {}): StatusInput {
	return {
		hasRepository: true,
		enabled: true,
		status: 'ok',
		selection: { kind: 'auto' },
		baseRef: 'main',
		baseCommit: SHA,
		headName: 'feature',
		headCommit: 'f'.repeat(40),
		...patch,
	};
}

test('hidden without a repository', () => {
	assert.equal(renderStatus(input({ hasRepository: false })).hidden, true);
});

test('off state names the base it would use', () => {
	const out = renderStatus(input({ enabled: false }));
	assert.equal(out.text, '$(git-compare) Review: off');
	assert.match(out.tooltip, /Base would be \*\*main\*\*/);
	assert.equal(out.severity, 'none');
});

test('enabled shows the base ref and counts', () => {
	const out = renderStatus(input({ fileCount: 12, countsSummary: '8 M, 3 A, 1 D' }));
	assert.equal(out.text, '$(git-compare) Review: main');
	assert.match(out.tooltip, /Merge base: `1a2b3c4`/);
	assert.match(out.tooltip, /12 files changed \(8 M, 3 A, 1 D\)/);
	assert.equal(out.severity, 'none');
});

test('exact mode shows the sha, not the ref', () => {
	const out = renderStatus(input({ selection: { kind: 'exact', ref: 'v1.2.0' }, baseRef: 'v1.2.0' }));
	assert.equal(out.text, '$(git-compare) Review: @1a2b3c4');
	assert.match(out.tooltip, /no merge base/);
});

test('on-base is labelled but still active', () => {
	const out = renderStatus(input({ status: 'onBase' }));
	assert.equal(out.text, '$(git-compare) Review: main (on base)');
	assert.match(out.tooltip, /no commits beyond main/);
});

test('detached HEAD is described in the tooltip', () => {
	const out = renderStatus(input({ headName: undefined }));
	assert.match(out.tooltip, /detached at `fffffff`/);
});

test('warning and error states carry a background', () => {
	assert.equal(renderStatus(input({ status: 'noBase' })).severity, 'warning');
	assert.equal(renderStatus(input({ status: 'noMergeBase' })).text, '$(warning) Review: unrelated');
	assert.equal(renderStatus(input({ status: 'unbornHead' })).severity, 'error');
	assert.equal(renderStatus(input({ status: 'error' })).text, '$(error) Review: git error');
});

test('skipped files are surfaced', () => {
	assert.match(renderStatus(input({ skippedCount: 3 })).tooltip, /3 files skipped/);
	assert.doesNotMatch(renderStatus(input({ skippedCount: 0 })).tooltip, /skipped/);
});

test('long refs are truncated', () => {
	const long = 'feature/a-very-long-branch-name-indeed';
	assert.equal(truncateRef(long).length, 24);
	assert.ok(renderStatus(input({ baseRef: long })).text.includes('…'));
	assert.equal(truncateRef('main'), 'main');
});
