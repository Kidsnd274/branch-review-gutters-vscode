import test from 'node:test';
import assert from 'node:assert/strict';
import {
	BaseUriError,
	baseUriParts,
	cacheKey,
	decodeBaseQuery,
	encodeBaseQuery,
	isSafeBasePath,
	type BasePayload,
} from '../src/content/uri';

const SHA = 'c'.repeat(40);

test('round trips a payload', () => {
	const payload: BasePayload = { repo: '/tmp/repo', commit: SHA, base: 'sp ace/\u00fc\u00f1\u00ed.ts' };
	assert.deepEqual(decodeBaseQuery(encodeBaseQuery(payload)), payload);
});

test('round trips a new file with no base', () => {
	const payload: BasePayload = { repo: '/tmp/repo', commit: SHA, base: null };
	assert.deepEqual(decodeBaseQuery(encodeBaseQuery(payload)), payload);
});

test('rejects traversal and absolute base paths', () => {
	assert.equal(isSafeBasePath('src/a.ts'), true);
	assert.equal(isSafeBasePath('..'), false);
	assert.equal(isSafeBasePath('../secret'), false);
	assert.equal(isSafeBasePath('a/../../b'), false);
	assert.equal(isSafeBasePath('/etc/passwd'), false);
	assert.equal(isSafeBasePath('C:\\Windows\\win.ini'), false);
	assert.equal(isSafeBasePath(''), false);
	// A file whose name merely contains dots is fine.
	assert.equal(isSafeBasePath('a..b/c.ts'), true);

	assert.throws(() => encodeBaseQuery({ repo: '/r', commit: SHA, base: '../x' }), BaseUriError);
});

test('rejects anything but a full sha', () => {
	assert.throws(() => encodeBaseQuery({ repo: '/r', commit: 'HEAD', base: 'a.ts' }), BaseUriError);
	assert.throws(() => encodeBaseQuery({ repo: '/r', commit: 'abc1234', base: 'a.ts' }), BaseUriError);
	assert.throws(() => encodeBaseQuery({ repo: '', commit: SHA, base: 'a.ts' }), BaseUriError);
});

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

test('rejects malformed queries instead of trusting them', () => {
	assert.throws(() => decodeBaseQuery('not base64url json'), BaseUriError);
	assert.throws(() => decodeBaseQuery(b64([])), BaseUriError);
	assert.throws(() => decodeBaseQuery(b64({ repo: '/r', commit: SHA, base: '../x' })), BaseUriError);
	assert.throws(() => decodeBaseQuery(b64({ repo: '/r', commit: 'HEAD', base: 'a.ts' })), BaseUriError);
});

test('the encoded query needs no percent-escaping', () => {
	const query = encodeBaseQuery({ repo: '/tmp/re po', commit: SHA, base: 'sp ace/\u00fc.ts' });
	assert.match(query, /^[A-Za-z0-9_-]+$/);
	assert.equal(encodeURIComponent(query), query);
});

test('uri parts keep the current path for the tab title', () => {
	const parts = baseUriParts('src/new.ts', { repo: '/r', commit: SHA, base: 'src/old.ts' });
	assert.equal(parts.scheme, 'review-base');
	assert.equal(parts.path, '/src/new.ts');
	assert.equal(decodeBaseQuery(parts.query).base, 'src/old.ts');
});

test('cache keys separate repo, commit and path', () => {
	const a = cacheKey({ repo: '/r', commit: SHA, base: 'a.ts' });
	const b = cacheKey({ repo: '/r', commit: SHA, base: 'b.ts' });
	const c = cacheKey({ repo: '/other', commit: SHA, base: 'a.ts' });
	assert.notEqual(a, b);
	assert.notEqual(a, c);
	assert.equal(a, cacheKey({ repo: '/r', commit: SHA, base: 'a.ts' }));
});
