/**
 * Pure encoding of `review-seen:` URIs. No vscode imports.
 *
 * A tree row cannot colour its own label: `TreeItem.label` carries no colour and
 * `TreeItemLabel` has no colour field either. The only hook is a
 * `FileDecorationProvider`, which is keyed on `TreeItem.resourceUri` — and the
 * real file uri is shared with the Explorer, so dimming it there would grey the
 * file out everywhere. A seen row therefore points at a synthetic uri of its
 * own, which only this extension's decoration provider answers for.
 */

import { CHANGE_STYLES } from '../changes/style';
import type { ChangeKind } from '../changes/parse';

export const SEEN_SCHEME = 'review-seen';

/** Which kind of row wants the dimmed treatment. */
export type SeenRow = { row: 'dir' } | { row: 'file'; kind: ChangeKind };

const DIR_QUERY = 'dir';

export interface SeenUriParts {
	scheme: string;
	/** Leading-slash path, so the row keeps a sensible name if anything reads it. */
	path: string;
	query: string;
}

export function seenUriParts(relPath: string, row: SeenRow): SeenUriParts {
	return {
		scheme: SEEN_SCHEME,
		path: relPath.startsWith('/') ? relPath : `/${relPath}`,
		query: row.row === 'dir' ? DIR_QUERY : row.kind,
	};
}

/**
 * The row behind a `review-seen:` query, or `undefined` for anything else. The
 * provider is called for every uri VS Code has on screen, so an unrecognised
 * query has to read as "not mine" rather than throw.
 */
export function parseSeenRow(query: string): SeenRow | undefined {
	if (query === DIR_QUERY) {
		return { row: 'dir' };
	}
	if (Object.prototype.hasOwnProperty.call(CHANGE_STYLES, query)) {
		return { row: 'file', kind: query as ChangeKind };
	}
	return undefined;
}
