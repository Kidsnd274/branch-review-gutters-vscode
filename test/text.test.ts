import test from 'node:test';
import assert from 'node:assert/strict';
import { BOM, looksBinary, normalizeForDocument, toCrlf, toLf } from '../src/content/text';

test('detects binary content by a NUL in the first 8000 bytes', () => {
	assert.equal(looksBinary(Buffer.from('plain text')), false);
	assert.equal(looksBinary(Buffer.from([0x61, 0x00, 0x62])), true);
	assert.equal(looksBinary(Buffer.alloc(0)), false);
	// A NUL beyond the window is not inspected, matching git's heuristic.
	const late = Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0x00])]);
	assert.equal(looksBinary(late), false);
});

test('eol conversion is idempotent and does not double up', () => {
	assert.equal(toLf('a\r\nb\r\n'), 'a\nb\n');
	assert.equal(toCrlf('a\nb\n'), 'a\r\nb\r\n');
	assert.equal(toCrlf('a\r\nb\r\n'), 'a\r\nb\r\n');
	assert.equal(toLf(toLf('a\r\nb')), 'a\nb');
});

test('normalises served text to the document eol', () => {
	assert.equal(normalizeForDocument('a\nb\n', 'crlf', false), 'a\r\nb\r\n');
	assert.equal(normalizeForDocument('a\r\nb\r\n', 'lf', false), 'a\nb\n');
});

test('matches the document BOM so line 1 is not falsely modified', () => {
	assert.equal(normalizeForDocument(`${BOM}a\n`, 'lf', false), 'a\n');
	assert.equal(normalizeForDocument('a\n', 'lf', true), `${BOM}a\n`);
	assert.equal(normalizeForDocument(`${BOM}a\n`, 'lf', true), `${BOM}a\n`);
	assert.equal(normalizeForDocument(`${BOM}a\n`, 'crlf', true), `${BOM}a\r\n`);
});
