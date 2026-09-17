/** Pure text normalisation for served base content. No vscode imports. */

export const BOM = '﻿';

export type Eol = 'lf' | 'crlf';

/** NUL in the first 8000 bytes is git's own binary heuristic. */
export function looksBinary(buf: Buffer): boolean {
	const limit = Math.min(buf.length, 8000);
	for (let i = 0; i < limit; i++) {
		if (buf[i] === 0) {
			return true;
		}
	}
	return false;
}

export function toLf(text: string): string {
	return text.replace(/\r\n/g, '\n');
}

export function toCrlf(text: string): string {
	return toLf(text).replace(/\n/g, '\r\n');
}

/**
 * Matches the served text to the open document, so a CRLF working tree does
 * not report every line as modified, and a stray BOM does not report line 1.
 */
export function normalizeForDocument(text: string, documentEol: Eol, documentHasBom: boolean): string {
	let out = text.startsWith(BOM) ? text.slice(BOM.length) : text;
	out = documentEol === 'crlf' ? toCrlf(out) : toLf(out);
	return documentHasBom ? BOM + out : out;
}
