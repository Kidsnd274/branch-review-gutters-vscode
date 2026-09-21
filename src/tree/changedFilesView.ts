import * as vscode from 'vscode';
import type { RepoInfo } from '../git/repositories';
import type { Baseline } from '../baseline/selection';
import type { ChangeSet, FileChange } from '../changes/parse';
import { describeCounts, ZERO_COUNTS } from '../changes/parse';
import { styleFor } from '../changes/style';
import { buildChangeTree, type DirNode, type FileNode, type TreeNode, type TreeMode } from './changeTree';
import { basenamePosix, dirnamePosix } from '../util/paths';
import * as log from '../util/log';

/** Everything the view needs from the controller. */
export interface TreeHost {
	knownRepositories(): readonly RepoInfo[];
	isEnabled(repo: RepoInfo): boolean;
	/** False until one of the repository's files has been on screen. */
	isTouched(repo: RepoInfo): boolean;
	getBaseline(repo: RepoInfo): Baseline | undefined;
	getChangeSet(repo: RepoInfo): ChangeSet | undefined;
	isExcluded(rel: string): boolean;
	/** Changes when the exclusion settings change, so caches can key off it. */
	excludeSignature(): string;
	viewMode(): TreeMode;
}

export interface RepoNode {
	type: 'repo';
	rootFsPath: string;
}

export type ViewNode = RepoNode | TreeNode;

/** Payload for the tree's commands: which repository, which change. */
export interface ChangeTarget {
	rootFsPath: string;
	change: FileChange;
}

type RepoState = 'notLoaded' | 'noBase' | 'noChanges' | 'ready';

export const VIEW_ID = 'reviewGutters.changedFiles';

function repoItemId(rootFsPath: string, mode: TreeMode): string {
	return `${rootFsPath}\u0000${mode}\u0000repo`;
}

function nodeId(rootFsPath: string, mode: TreeMode, node: TreeNode): string {
	return `${rootFsPath}\u0000${mode}\u0000${node.type}\u0000${node.path}`;
}

/**
 * One repository's rendered branch: the change set turned into nodes, with the
 * tree items and the parent links built once and reused until the inputs move.
 */
class RepoTree {
	readonly node: RepoNode;
	readonly roots: TreeNode[];
	readonly state: RepoState;
	private readonly parents = new Map<string, ViewNode>();
	private readonly byRelPath = new Map<string, TreeNode>();
	private readonly items = new Map<string, vscode.TreeItem>();
	private repoItemValue?: vscode.TreeItem;

	constructor(
		private readonly host: TreeHost,
		private readonly owner: WeakMap<TreeNode, RepoTree>,
		readonly repo: RepoInfo,
		readonly mode: TreeMode,
		readonly excludeKey: string,
		readonly changeSet: ChangeSet | undefined,
		readonly loading: boolean,
		readonly hasBase: boolean,
	) {
		this.node = { type: 'repo', rootFsPath: repo.rootFsPath };
		this.roots =
			loading || !hasBase || !changeSet
				? []
				: buildChangeTree(changeSet.all(), { mode, isExcluded: (rel) => this.host.isExcluded(rel) });
		this.state = loading ? 'notLoaded' : !hasBase ? 'noBase' : this.roots.length === 0 ? 'noChanges' : 'ready';
		this.index(this.roots, this.node);
	}

	repoItem(): vscode.TreeItem {
		if (!this.repoItemValue) {
			const item = new vscode.TreeItem(
				repoDisplayName(this.repo.rootFsPath),
				this.roots.length > 0
					? vscode.TreeItemCollapsibleState.Expanded
					: vscode.TreeItemCollapsibleState.None,
			);
			item.id = repoItemId(this.repo.rootFsPath, this.mode);
			item.contextValue = 'repo';
			item.iconPath = new vscode.ThemeIcon('git-merge');
			item.description = this.repoDescription();
			item.tooltip = this.repoTooltip();
			this.repoItemValue = item;
		}
		return this.repoItemValue;
	}

	treeItemFor(node: TreeNode): vscode.TreeItem {
		const id = nodeId(this.repo.rootFsPath, this.mode, node);
		const cached = this.items.get(id);
		if (cached) {
			return cached;
		}
		const item = node.type === 'dir' ? this.dirItem(node) : this.fileItem(node);
		item.id = id;
		this.items.set(id, item);
		return item;
	}

	parentOf(node: TreeNode): ViewNode | undefined {
		return this.parents.get(nodeId(this.repo.rootFsPath, this.mode, node));
	}

	fileNode(relPath: string): TreeNode | undefined {
		return this.byRelPath.get(relPath);
	}

	private index(nodes: TreeNode[], parent: ViewNode): void {
		for (const node of nodes) {
			this.owner.set(node, this);
			this.parents.set(nodeId(this.repo.rootFsPath, this.mode, node), parent);
			if (node.type === 'file') {
				this.byRelPath.set(node.path, node);
			} else {
				this.index(node.children, node);
			}
		}
	}

	private repoDescription(): string {
		if (this.state === 'notLoaded') {
			return 'not loaded yet';
		}
		if (this.state === 'noBase') {
			return 'no base';
		}
		if (this.state === 'noChanges') {
			return 'no changes';
		}
		const baseRef = this.host.getBaseline(this.repo)?.baseRef ?? 'base';
		return `${baseRef} · ${describeCounts(this.changeSet?.counts ?? ZERO_COUNTS)}`;
	}

	private repoTooltip(): string {
		const baseline = this.host.getBaseline(this.repo);
		const lines = [`${repoDisplayName(this.repo.rootFsPath)} — ${this.repoDescription()}`];
		if (baseline?.baseCommit) {
			lines.push(`${baseline.selection.kind === 'exact' ? 'exact' : 'merge base'} ${baseline.baseCommit.slice(0, 7)}`);
		}
		if (baseline?.message) {
			lines.push(baseline.message);
		}
		if (this.state === 'notLoaded') {
			lines.push('Opens once this repository has a file on screen.');
		}
		return lines.join('\n');
	}

	private dirItem(node: DirNode): vscode.TreeItem {
		const style = styleFor(node.hint);
		const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
		item.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor(style.color));
		item.contextValue = 'dir';
		item.tooltip = `${node.path} — ${style.label.toLowerCase()} underneath`;
		return item;
	}

	private fileItem(node: FileNode): vscode.TreeItem {
		const change = node.change;
		const style = styleFor(change.kind);
		const deleted = change.kind === 'deleted';
		const item = new vscode.TreeItem(basenamePosix(node.path), vscode.TreeItemCollapsibleState.None);
		item.description = this.mode === 'list' ? dirnamePosix(node.path) || '.' : style.label;
		item.iconPath = new vscode.ThemeIcon(style.codicon, new vscode.ThemeColor(style.color));
		// Deleted files get no resource: there is nothing at that path to point at.
		if (!deleted) {
			item.resourceUri = vscode.Uri.joinPath(this.repo.rootUri, ...node.path.split('/'));
		}
		item.contextValue = change.kind;
		item.tooltip = this.fileTooltip(change);
		item.command = {
			command: 'reviewGutters.openFromTree',
			title: 'Open Changed File',
			arguments: [{ rootFsPath: this.repo.rootFsPath, change } satisfies ChangeTarget],
		};
		return item;
	}

	private fileTooltip(change: FileChange): string {
		const baseline = this.host.getBaseline(this.repo);
		const against = baseline?.baseRef ?? 'base';
		const shortSha = baseline?.baseCommit?.slice(0, 7) ?? '';
		const suffix = change.kind === 'renamed' && change.basePath ? ` from ${change.basePath}` : '';
		const kind = baseline?.selection.kind === 'exact' ? 'exact' : 'merge base';
		return `${styleFor(change.kind).label} vs ${against}${suffix} (${kind} ${shortSha})`;
	}
}

/**
 * The Changed Files view: one node per repository the user has review switched
 * on, holding the files that differ from that repository's base as a folder
 * tree or a flat list.
 *
 * It reads only the change set the controller already loaded. It never asks for
 * git work, and never builds for a repository that has not been touched, so the
 * deliberate "no git fan-out on startup" design stays intact.
 */
export class ChangedFilesView implements vscode.TreeDataProvider<ViewNode>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ViewNode | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
	private readonly trees = new Map<string, RepoTree>();
	/** Which repository a node came from, so ids stay unique across roots. */
	private readonly owner = new WeakMap<TreeNode, RepoTree>();
	private readonly disposables: vscode.Disposable[] = [];
	private readonly treeView: vscode.TreeView<ViewNode>;

	constructor(private readonly host: TreeHost) {
		this.treeView = vscode.window.createTreeView(VIEW_ID, {
			treeDataProvider: this,
			showCollapseAll: true,
		});
		this.disposables.push(
			this.onDidChangeTreeDataEmitter,
			this.treeView,
			this.treeView.onDidChangeVisibility(() => {
				if (this.treeView.visible) {
					this.refresh();
				}
			}),
		);
	}

	refresh(): void {
		// Nothing reads the tree while it is hidden, so do not build for it.
		if (!this.treeView.visible) {
			return;
		}
		const live = new Set<string>();
		for (const repo of this.enabledRepositories()) {
			this.treeFor(repo);
			live.add(repo.rootFsPath);
		}
		for (const root of [...this.trees.keys()]) {
			if (!live.has(root)) {
				this.trees.delete(root);
			}
		}
		this.onDidChangeTreeDataEmitter.fire(undefined);
	}

	/** Reveals the file the active editor is showing, if the change set has it. */
	async revealFile(repo: RepoInfo, relPath: string): Promise<void> {
		if (!this.treeView.visible) {
			return;
		}
		const node = this.treeFor(repo).fileNode(relPath);
		if (!node) {
			return;
		}
		try {
			await this.treeView.reveal(node, { expand: true, select: true });
		} catch (err) {
			log.debug(`could not reveal ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	getChildren(element?: ViewNode): vscode.ProviderResult<ViewNode[]> {
		if (!element) {
			return this.rootNodes();
		}
		if (element.type === 'repo') {
			return this.treeForRoot(element.rootFsPath)?.roots ?? [];
		}
		if (element.type === 'dir') {
			return element.children;
		}
		return [];
	}

	getTreeItem(element: ViewNode): vscode.TreeItem {
		if (element.type === 'repo') {
			return this.treeForRoot(element.rootFsPath)?.repoItem() ?? missingRepoItem(element.rootFsPath);
		}
		const tree = this.owner.get(element);
		return tree ? tree.treeItemFor(element) : orphanItem(element, this.host.viewMode());
	}

	/** Required by `TreeView.reveal`. */
	getParent(element: ViewNode): vscode.ProviderResult<ViewNode> {
		if (element.type === 'repo') {
			return undefined;
		}
		return this.owner.get(element)?.parentOf(element);
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
		this.disposables.length = 0;
		this.trees.clear();
	}

	// ------------------------------------------------------------------ internals

	private enabledRepositories(): RepoInfo[] {
		return this.host.knownRepositories().filter((r) => this.host.isEnabled(r));
	}

	/**
	 * Nodes are shown only when there is something to review. When every enabled
	 * repository is still without a base, or has nothing changed, the root is
	 * left empty so the welcome content can say why instead of a dead node.
	 */
	private rootNodes(): ViewNode[] {
		const repos = this.enabledRepositories();
		const states = repos.map((r) => this.treeFor(r).state);
		if (!states.some((s) => s === 'ready' || s === 'notLoaded')) {
			return [];
		}
		return repos.map((r) => this.treeFor(r).node);
	}

	private treeForRoot(rootFsPath: string): RepoTree | undefined {
		const cached = this.trees.get(rootFsPath);
		if (cached) {
			return cached;
		}
		const repo = this.host.knownRepositories().find((r) => r.rootFsPath === rootFsPath);
		return repo ? this.treeFor(repo) : undefined;
	}

	private treeFor(repo: RepoInfo): RepoTree {
		const mode = this.host.viewMode();
		const excludeKey = this.host.excludeSignature();
		const changeSet = this.host.getChangeSet(repo);
		const loading = !this.host.isTouched(repo);
		const hasBase = Boolean(this.host.getBaseline(repo)?.baseCommit);
		const cached = this.trees.get(repo.rootFsPath);
		if (
			cached &&
			cached.mode === mode &&
			cached.excludeKey === excludeKey &&
			cached.changeSet === changeSet &&
			cached.loading === loading &&
			cached.hasBase === hasBase
		) {
			return cached;
		}
		const tree = new RepoTree(this.host, this.owner, repo, mode, excludeKey, changeSet, loading, hasBase);
		this.trees.set(repo.rootFsPath, tree);
		return tree;
	}
}

function repoDisplayName(rootFsPath: string): string {
	return rootFsPath.split(/[\\/]/).filter(Boolean).pop() ?? rootFsPath;
}

function missingRepoItem(rootFsPath: string): vscode.TreeItem {
	const item = new vscode.TreeItem(repoDisplayName(rootFsPath), vscode.TreeItemCollapsibleState.None);
	item.id = `${rootFsPath}\u0000missing\u0000repo`;
	item.description = 'no longer open';
	item.contextValue = 'repo';
	return item;
}

function orphanItem(node: TreeNode, mode: TreeMode): vscode.TreeItem {
	const item = new vscode.TreeItem(
		node.type === 'dir' ? node.name : basenamePosix(node.path),
		node.type === 'dir' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
	);
	item.id = `orphan\u0000${mode}\u0000${node.type}\u0000${node.path}`;
	return item;
}
