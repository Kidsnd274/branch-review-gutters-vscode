/** Pure presentation of a change kind, shared by Explorer badges and the tree. */

import type { ChangeKind } from './parse';

export interface ChangeStyle {
	/** Badge letter shown in the Explorer. */
	badge: string;
	/** Theme colour id, used for both the badge and the tree icon. */
	color: string;
	/** Codicon name used by the tree and the quick picks. */
	codicon: string;
	label: string;
}

export const CHANGE_STYLES: Record<ChangeKind, ChangeStyle> = {
	added: { badge: 'A', color: 'gitDecoration.addedResourceForeground', codicon: 'diff-added', label: 'Added' },
	untracked: {
		badge: 'U',
		color: 'gitDecoration.untrackedResourceForeground',
		codicon: 'diff-added',
		label: 'Untracked',
	},
	modified: {
		badge: 'M',
		color: 'gitDecoration.modifiedResourceForeground',
		codicon: 'diff-modified',
		label: 'Modified',
	},
	typeChanged: {
		badge: 'M',
		color: 'gitDecoration.modifiedResourceForeground',
		codicon: 'diff-modified',
		label: 'Type changed',
	},
	renamed: { badge: 'R', color: 'gitDecoration.renamedResourceForeground', codicon: 'diff-renamed', label: 'Renamed' },
	deleted: {
		badge: 'D',
		color: 'gitDecoration.deletedResourceForeground',
		codicon: 'diff-removed',
		label: 'Deleted',
	},
};

export function styleFor(kind: ChangeKind): ChangeStyle {
	return CHANGE_STYLES[kind];
}

/**
 * How a folder should be coloured for the changes underneath it: the most
 * serious kind wins, so a folder holding a deletion never reads as merely
 * added. `modified` and `typeChanged` share a tier because they share a colour.
 */
export const KIND_SEVERITY: Record<ChangeKind, number> = {
	deleted: 5,
	renamed: 4,
	modified: 3,
	typeChanged: 3,
	added: 2,
	untracked: 1,
};

/** The kind to show for a folder holding `a` and `b` underneath it. */
export function worseKind(a: ChangeKind, b: ChangeKind): ChangeKind {
	return KIND_SEVERITY[b] > KIND_SEVERITY[a] ? b : a;
}
