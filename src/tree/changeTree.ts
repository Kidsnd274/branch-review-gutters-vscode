/** Pure construction of the Changed Files tree. No vscode/node imports. */

import type { ChangeKind, FileChange } from '../changes/parse';
import { worseKind } from '../changes/style';
import { basenamePosix, dirnamePosix, isDotGitPath } from '../util/paths';

export type TreeMode = 'tree' | 'list';

export type TreeNode =
	| { type: 'dir'; path: string; name: string; hint: ChangeKind; children: TreeNode[] }
	| { type: 'file'; path: string; change: FileChange };

export type DirNode = Extract<TreeNode, { type: 'dir' }>;
export type FileNode = Extract<TreeNode, { type: 'file' }>;

export interface ChangeTreeOptions {
	mode: TreeMode;
	isExcluded(rel: string): boolean;
}

/**
 * Changes that reach the user's eyes. The change set itself is git-level, so
 * `.git` internals and the `excludeGlobs` settings have to be dropped here or
 * the tree would show files the Explorer hides.
 */
export function visibleChanges(changes: readonly FileChange[], isExcluded: (rel: string) => boolean): FileChange[] {
	return changes
		.filter((c) => !isDotGitPath(c.path) && !isExcluded(c.path))
		.sort((a, b) => comparePath(a.path, b.path));
}

/**
 * Builds the rendered tree. Tree mode keeps only directories that lead to a
 * changed file, with no path compaction; list mode is the flat set of files.
 */
export function buildChangeTree(changes: readonly FileChange[], opts: ChangeTreeOptions): TreeNode[] {
	const kept = visibleChanges(changes, opts.isExcluded);
	if (opts.mode === 'list') {
		return kept.map((change) => ({ type: 'file', path: change.path, change }));
	}

	const roots: TreeNode[] = [];
	const dirs = new Map<string, DirNode>();
	const ensureDir = (path: string): DirNode => {
		const known = dirs.get(path);
		if (known) {
			return known;
		}
		const node: DirNode = { type: 'dir', path, name: basenamePosix(path), hint: 'untracked', children: [] };
		dirs.set(path, node);
		const parentPath = dirnamePosix(path);
		if (parentPath === '') {
			roots.push(node);
		} else {
			ensureDir(parentPath).children.push(node);
		}
		return node;
	};

	// A changed path that is also an ancestor of another change has to render as
	// the folder holding it, so collect those before placing any file node.
	const folders = new Set<string>();
	for (const change of kept) {
		for (let dir = dirnamePosix(change.path); dir !== ''; dir = dirnamePosix(dir)) {
			if (folders.has(dir)) {
				break;
			}
			folders.add(dir);
		}
	}

	for (const change of kept) {
		if (folders.has(change.path)) {
			continue;
		}
		const file: FileNode = { type: 'file', path: change.path, change };
		const parentPath = dirnamePosix(change.path);
		if (parentPath === '') {
			roots.push(file);
			continue;
		}
		const parent = ensureDir(parentPath);
		parent.children.push(file);
		for (let node: DirNode | undefined = parent; node; node = dirs.get(dirnamePosix(node.path))) {
			node.hint = worseKind(node.hint, change.kind);
		}
	}

	sortNodes(roots);
	return roots;
}

function comparePath(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Folders before files, each group by name, so refreshes never reshuffle. */
function sortNodes(nodes: TreeNode[]): void {
	nodes.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === 'dir' ? -1 : 1;
		}
		const an = a.type === 'dir' ? a.name : basenamePosix(a.path);
		const bn = b.type === 'dir' ? b.name : basenamePosix(b.path);
		return comparePath(an, bn);
	});
	for (const node of nodes) {
		if (node.type === 'dir') {
			sortNodes(node.children);
		}
	}
}
