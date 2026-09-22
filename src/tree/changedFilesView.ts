import * as vscode from 'vscode';
import type { RepoInfo } from '../git/repositories';
import type { Baseline } from '../baseline/selection';
import type { ChangeSet, FileChange } from '../changes/parse';
import { describeCounts, ZERO_COUNTS } from '../changes/parse';
import { styleFor } from '../changes/style';
import {
	buildChangeTree,
	isDirNode,
	isFileNode,
	type DirNode,
	type FileNode,
	type TreeNode,
	type TreeMode,
} from './changeTree';
import type { FolderSeen } from '../review/seenState';
import { basenamePosix, dirnamePosix } from '../util/paths';
import * as log from '../util/log';

/** Everything the view needs from the controller. */
export interface TreeHost {
	knownRepositories(): readonly RepoInfo[];
	/** The repository with exactly this root, as a command payload names it. */
	repositoryAt(rootFsPath: string): RepoInfo | undefined;
	isEnabled(repo: RepoInfo): boolean;
	/** False until one of the repository's files has been on screen. */
	isTouched(repo: RepoInfo): boolean;
	getBaseline(repo: RepoInfo): Baseline | undefined;
	getChangeSet(repo: RepoInfo): ChangeSet | undefined;
	isExcluded(rel: string): boolean;
	/** Changes when the exclusion settings change, so caches can key off it. */
	excludeSignature(): string;
	viewMode(): TreeMode;
	isSeen(repo: RepoInfo, rel: string): boolean;
	seenProgress(repo: RepoInfo, relPaths: readonly string[]): { seen: number; total: number };
	folderSeen(repo: RepoInfo, relPaths: readonly string[]): FolderSeen;
	setSeen(repo: RepoInfo, relPaths: readonly string[], seen: boolean): void;
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

/** Past this many rows, one whole-view repaint beats one event per row. */
const BULK_REPAINT_PATHS = 24;

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
	readonly allFiles: string[];
	private readonly parents = new Map<string, ViewNode>();
	private readonly byRelPath = new Map<string, TreeNode>();
	private readonly items = new Map<string, vscode.TreeItem>();
	private readonly filesUnderDir = new Map<string, string[]>();
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
		this.allFiles = this.index(this.roots, this.node);
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

	private index(nodes: TreeNode[], parent: ViewNode): string[] {
		const files: string[] = [];
		for (const node of nodes) {
			this.owner.set(node, this);
			this.parents.set(nodeId(this.repo.rootFsPath, this.mode, node), parent);
			if (node.type === 'file') {
				this.byRelPath.set(node.path, node);
				files.push(node.path);
				continue;
			}
			const under = this.index(node.children, node);
			this.filesUnderDir.set(node.path, under);
			files.push(...under);
		}
		return files;
	}

	filesUnder(dirPath: string): readonly string[] {
		return this.filesUnderDir.get(dirPath) ?? [];
	}

	/**
	 * Drops the cached items so the next `getTreeItem` rebuilds them from the
	 * store. A seen toggle moves none of the inputs the cache is keyed on, so
	 * without this the row would never repaint.
	 */
	dropItems(nodes: readonly TreeNode[]): void {
		for (const node of nodes) {
			this.items.delete(nodeId(this.repo.rootFsPath, this.mode, node));
		}
	}

	dropRepoItem(): void {
		this.repoItemValue = undefined;
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
		const { seen } = this.host.seenProgress(this.repo, this.allFiles);
		const counts = describeCounts(this.changeSet?.counts ?? ZERO_COUNTS);
		return `${seen}/${this.allFiles.length} seen · ${baseRef} · ${counts}`;
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
		const under = this.filesUnder(node.path);
		const aggregate = this.host.folderSeen(this.repo, under);
		// The aggregate rides on contextValue so the menu can name it exactly.
		// A checkbox cannot carry it: TreeItemCheckboxState has no tri-state, so
		// a half-seen folder would read as unchecked and its first click would
		// mark everything inside.
		item.contextValue = aggregate === 'none' ? 'dir' : `dir~${aggregate}`;
		if (aggregate !== 'none') {
			const { seen } = this.host.seenProgress(this.repo, under);
			item.description = `${seen}/${under.length} seen`;
			item.tooltip = `${node.path} — ${seen} of ${under.length} seen`;
		} else {
			item.tooltip = `${node.path} — ${style.label.toLowerCase()} underneath`;
		}
		return item;
	}

	private fileItem(node: FileNode): vscode.TreeItem {
		const change = node.change;
		const style = styleFor(change.kind);
		const deleted = change.kind === 'deleted';
		const seen = this.host.isSeen(this.repo, node.path);
		const item = new vscode.TreeItem(basenamePosix(node.path), vscode.TreeItemCollapsibleState.None);
		item.description = this.mode === 'list' ? dirnamePosix(node.path) || '.' : style.label;
		item.iconPath = new vscode.ThemeIcon(style.codicon, new vscode.ThemeColor(style.color));
		// Deleted files get no resource: there is nothing at that path to point at.
		if (!deleted) {
			item.resourceUri = vscode.Uri.joinPath(this.repo.rootUri, ...node.path.split('/'));
		}
		// The row keeps its change-kind icon and letter badge; the checkbox
		// carries only the seen bit.
		item.checkboxState = seen
			? { state: vscode.TreeItemCheckboxState.Checked, tooltip: 'Seen — click to unmark' }
			: { state: vscode.TreeItemCheckboxState.Unchecked, tooltip: 'Mark as seen' };
		item.contextValue = seen ? `${change.kind}~seen` : change.kind;
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
			// Without this VS Code cascades a parent's checkbox into its children,
			// which fights the store the moment a folder is toggled.
			manageCheckboxStateManually: true,
		});
		this.disposables.push(
			this.onDidChangeTreeDataEmitter,
			this.treeView,
			this.treeView.onDidChangeVisibility(() => {
				if (this.treeView.visible) {
					this.refresh();
				}
			}),
			this.treeView.onDidChangeCheckboxState((event) => {
				const groups = new Map<string, { repo: RepoInfo; seen: boolean; paths: string[] }>();
				for (const [element, state] of event.items) {
					if (element.type !== 'file') {
						continue;
					}
					const tree = this.owner.get(element);
					if (!tree) {
						continue;
					}
					const seen = state === vscode.TreeItemCheckboxState.Checked;
					const key = `${tree.repo.rootFsPath}\u0000${seen}`;
					const group = groups.get(key) ?? { repo: tree.repo, seen, paths: [] };
					group.paths.push(element.path);
					groups.set(key, group);
				}
				for (const group of groups.values()) {
					this.host.setSeen(group.repo, group.paths, group.seen);
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

	/**
	 * Repaints the rows a seen toggle touched: the files, every folder above
	 * them, and the repository row, whose description carries the count. A
	 * targeted fire per node rather than a whole-view repaint keeps the user's
	 * expansion state, which the stable node ids make possible.
	 */
	invalidateSeen(repoRootFsPath: string, relPaths: readonly string[]): void {
		if (relPaths.length === 0 || !this.treeView.visible) {
			return;
		}
		const tree = this.trees.get(repoRootFsPath);
		if (!tree) {
			return;
		}
		if (relPaths.length > BULK_REPAINT_PATHS) {
			this.refresh();
			return;
		}
		const nodes: TreeNode[] = [];
		const pushed = new Set<string>();
		const push = (node: TreeNode): void => {
			const id = nodeId(repoRootFsPath, tree.mode, node);
			if (pushed.has(id)) {
				return;
			}
			pushed.add(id);
			nodes.push(node);
		};
		for (const relPath of relPaths) {
			const fileNode = tree.fileNode(relPath);
			if (!fileNode) {
				continue;
			}
			push(fileNode);
			for (let parent = tree.parentOf(fileNode); parent && parent.type === 'dir'; parent = tree.parentOf(parent)) {
				push(parent);
			}
		}
		if (nodes.length === 0) {
			return;
		}
		tree.dropItems(nodes);
		tree.dropRepoItem();
		for (const node of nodes) {
			this.onDidChangeTreeDataEmitter.fire(node);
		}
		this.onDidChangeTreeDataEmitter.fire(tree.node);
	}

	/**
	 * The repository and change behind whatever a command was handed.
	 *
	 * A left-click delivers the payload baked into `TreeItem.command.arguments`;
	 * a context-menu command delivers the tree element itself, which VS Code
	 * converts back from the item's handle. They are different objects, so any
	 * tree command has to accept both.
	 */
	resolveFile(element: unknown): { repo: RepoInfo; change: FileChange } | undefined {
		const target = element as ChangeTarget | null | undefined;
		if (target && typeof target.rootFsPath === 'string' && target.change) {
			const repo = this.host.repositoryAt(target.rootFsPath);
			return repo ? { repo, change: target.change } : undefined;
		}
		if (isFileNode(element)) {
			const tree = this.owner.get(element);
			return tree ? { repo: tree.repo, change: element.change } : undefined;
		}
		return undefined;
	}

	/** The folder row a command was invoked on, and every visible file under it. */
	resolveFolder(element: unknown): { repo: RepoInfo; dirPath: string; paths: readonly string[] } | undefined {
		if (!isDirNode(element)) {
			return undefined;
		}
		const tree = this.owner.get(element);
		if (!tree) {
			return undefined;
		}
		const paths = tree.filesUnder(element.path);
		return paths.length > 0 ? { repo: tree.repo, dirPath: element.path, paths } : undefined;
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
