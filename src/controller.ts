import * as vscode from 'vscode';
import { RepositoryService, type RepoInfo } from './git/repositories';
import { StateStore, type RepoState } from './baseline/state';
import { resolveBaseline, sameSelection, type BaseSelection, type Baseline } from './baseline/resolver';
import { loadChangeSet } from './changes/changeSet';
import { describeCounts, totalChanges, type ChangeSet, type FileChange } from './changes/parse';
import { BaseContentProvider } from './content/baseContentProvider';
import { QuickDiffRenderer, type RenderHost } from './rendering/quickDiff';
import { isRenderableBaseline } from './baseline/selection';
import { ReviewFileDecorationProvider } from './explorer/fileDecorations';
import { ChangedFilesView, VIEW_ID, type TreeHost } from './tree/changedFilesView';
import { type TreeMode, visibleChanges } from './tree/changeTree';
import { SeenStore } from './review/seenStore';
import * as seenState from './review/seenState';
import { StatusBar } from './ui/statusBar';
import { readConfig, CONFIG_SECTION, type Config } from './config';
import { isDotGitPath, makeGlobMatcher } from './util/paths';
import { debounce, type Debounced } from './util/debounce';
import { probeVersion, endOfOptionsSupported } from './git/exec';
import * as log from './util/log';

interface RepoRuntime {
	info: RepoInfo;
	state: RepoState;
	baseline?: Baseline;
	changeSet?: ChangeSet;
	inFlight?: Promise<void>;
	queued: boolean;
	/** A repo enabled from persisted state is only refreshed once it is seen. */
	touched: boolean;
}

const FOCUS_REFRESH_MS = 5000;

export class Controller implements RenderHost, TreeHost, vscode.Disposable {
	private readonly runtimes = new Map<string, RepoRuntime>();
	private readonly disposables: vscode.Disposable[] = [];
	private config: Config;
	private isExcludedPath: (relPath: string) => boolean;
	private lastFocusRefresh = 0;
	private oldGitWarned = false;
	private viewModeValue: TreeMode;
	private readonly treeRefresh: Debounced;
	private readonly changeSetsChangedEmitter = new vscode.EventEmitter<void>();

	/** Fired whenever a repository's change set may have moved. */
	readonly onDidChangeChangeSets = this.changeSetsChangedEmitter.event;

	readonly content: BaseContentProvider;
	private readonly renderer: QuickDiffRenderer;
	private readonly decorations: ReviewFileDecorationProvider;
	private readonly view: ChangedFilesView;
	private readonly statusBar: StatusBar;

	constructor(
		private readonly repositories: RepositoryService,
		private readonly store: StateStore,
		private readonly seenStore: SeenStore,
	) {
		this.config = readConfig();
		this.isExcludedPath = makeGlobMatcher(this.config.excludeGlobs);
		log.setLogLevel(this.config.logLevel);
		this.viewModeValue = this.store.getViewMode() ?? this.config.viewMode;

		this.content = new BaseContentProvider(() => this.config);
		this.renderer = new QuickDiffRenderer(this, this.content);
		this.decorations = new ReviewFileDecorationProvider(this);
		this.decorations.setEnabled(this.config.explorerBadges);
		this.view = new ChangedFilesView(this);
		// One repaint per multi-repo refresh, not one per repository.
		this.treeRefresh = debounce(() => this.view.refresh(), 120);
		this.statusBar = new StatusBar();
		this.disposables.push(
			this.content,
			this.renderer,
			this.decorations,
			this.view,
			this.statusBar,
			this.changeSetsChangedEmitter,
			{ dispose: () => this.treeRefresh.cancel() },
		);
	}

	async initialize(): Promise<void> {
		for (const repo of this.repositories.repositories) {
			this.adopt(repo);
		}

		// Saves only reload the repository that was saved into, so one save in a
		// multi-root workspace does not fan out git across every repository.
		const pendingSaves = new Set<string>();
		const saveDebounced = debounce(() => {
			const roots = [...pendingSaves];
			pendingSaves.clear();
			for (const root of roots) {
				const runtime = this.runtimes.get(root);
				if (runtime?.state.enabled && runtime.touched) {
					void this.refreshChangeSetOnly(runtime);
				}
			}
		}, 300);

		this.disposables.push(
			this.repositories.onDidChangeRepositories(() => this.onRepositoriesChanged()),
			this.repositories.onDidChangeRepositoryState((repo) => {
				const runtime = this.runtimes.get(repo.rootFsPath);
				if (runtime?.state.enabled && runtime.touched) {
					void this.refresh(repo, 'repository state changed');
				} else {
					this.renderStatusBar();
				}
			}),
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.onActiveEditorChanged();
				void this.revealActiveFile();
			}),
			vscode.window.onDidChangeVisibleTextEditors(() => this.touchVisibleRepositories()),
			vscode.workspace.onDidSaveTextDocument((doc) => {
				if (doc.uri.scheme !== 'file') {
					return;
				}
				const repo = this.repositories.getRepositoryFor(doc.uri);
				if (repo && this.isEnabled(repo)) {
					pendingSaves.add(repo.rootFsPath);
					saveDebounced();
				}
			}),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration(CONFIG_SECTION)) {
					void this.onConfigChanged();
				}
			}),
			vscode.window.onDidChangeWindowState((state) => {
				if (!state.focused) {
					return;
				}
				const now = Date.now();
				if (now - this.lastFocusRefresh < FOCUS_REFRESH_MS) {
					return;
				}
				this.lastFocusRefresh = now;
				void this.refreshAllEnabled('window focused');
			}),
			{ dispose: () => saveDebounced.cancel() },
			this.onDidChangeChangeSets(() => this.treeRefresh()),
		);

		this.touchVisibleRepositories();
		this.onActiveEditorChanged();
	}

	// ------------------------------------------------------------- RenderHost

	getRepositoryFor(uri: vscode.Uri): RepoInfo | undefined {
		return this.repositories.getRepositoryFor(uri);
	}

	/** The repository with exactly this root, as used by the tree's commands. */
	repositoryAt(rootFsPath: string): RepoInfo | undefined {
		return this.repositories.repositories.find((r) => r.rootFsPath === rootFsPath);
	}

	knownRepositories(): readonly RepoInfo[] {
		return this.repositories.repositories;
	}

	relativePath(repo: RepoInfo, uri: vscode.Uri): string | undefined {
		return this.repositories.relativePath(repo, uri);
	}

	isEnabled(repo: RepoInfo): boolean {
		return this.runtimes.get(repo.rootFsPath)?.state.enabled === true;
	}

	getBaseline(repo: RepoInfo): Baseline | undefined {
		return this.runtimes.get(repo.rootFsPath)?.baseline;
	}

	getChangeSet(repo: RepoInfo): ChangeSet | undefined {
		return this.runtimes.get(repo.rootFsPath)?.changeSet;
	}

	isExcluded(relPath: string): boolean {
		return this.isExcludedPath(relPath);
	}

	originalsConfigKey(): string {
		return JSON.stringify([this.config.excludeGlobs, this.config.maxFileSizeKB]);
	}

	isTouched(repo: RepoInfo): boolean {
		return this.runtimes.get(repo.rootFsPath)?.touched === true;
	}

	viewMode(): TreeMode {
		return this.viewModeValue;
	}

	excludeSignature(): string {
		return JSON.stringify(this.config.excludeGlobs);
	}

	/**
	 * Base-commit scoping is applied at read time so the view never reasons
	 * about staleness. A repository with no base reads as the empty string,
	 * which no stored mark can match, because a mark always carries a real sha.
	 */
	private seenBaseOf(repo: RepoInfo): string {
		return this.getBaseline(repo)?.baseCommit ?? '';
	}

	isSeen(repo: RepoInfo, relPath: string): boolean {
		return seenState.isSeen(this.seenStore.get(repo.rootFsPath), relPath, this.seenBaseOf(repo));
	}

	seenProgress(repo: RepoInfo, relPaths: readonly string[]): { seen: number; total: number } {
		const seen = seenState.countSeen(this.seenStore.get(repo.rootFsPath), relPaths, this.seenBaseOf(repo));
		return { seen, total: relPaths.length };
	}

	folderSeen(repo: RepoInfo, relPaths: readonly string[]): seenState.FolderSeen {
		return seenState.folderSeenState(this.seenStore.get(repo.rootFsPath), relPaths, this.seenBaseOf(repo));
	}

	setSeen(repo: RepoInfo, relPaths: readonly string[], seen: boolean): void {
		const baseCommit = this.getBaseline(repo)?.baseCommit;
		if (!baseCommit || relPaths.length === 0) {
			return;
		}
		const root = repo.rootFsPath;
		const write = seen
			? this.seenStore.markAll(root, relPaths, baseCommit)
			: this.seenStore.unmarkAll(root, relPaths);
		void write
			.then((changed) => {
				if (!changed) {
					return;
				}
				this.view.invalidateSeen(root, relPaths);
				this.updateSeenContextKeys();
			})
			.catch((err) => log.error(`could not save the seen state for ${root}`, err));
	}

	/** Resolves a command argument — left-click payload or tree element — to its change. */
	resolveTreeFile(element: unknown): { repo: RepoInfo; change: FileChange } | undefined {
		return this.view.resolveFile(element);
	}

	/**
	 * Marks the file rows a tree command was invoked on — one row, or a whole
	 * multi-selection. False when none of the arguments named a file still in a
	 * change set, so the caller can say so.
	 */
	setSeenForRows(args: readonly unknown[], seen: boolean): boolean {
		const groups = this.view.resolveFileSelection(args);
		for (const group of groups) {
			this.setSeen(group.repo, group.paths, seen);
		}
		return groups.length > 0;
	}

	/** Marks every visible file under the folder row a command was invoked on. */
	markFolder(element: unknown, seen: boolean): boolean {
		const folder = this.view.resolveFolder(element);
		if (!folder) {
			return false;
		}
		this.setSeen(folder.repo, folder.paths, seen);
		return true;
	}

	private updateSeenContextKeys(): void {
		let seen = 0;
		let total = 0;
		const repo = this.activeRepository();
		const baseCommit = repo ? this.getBaseline(repo)?.baseCommit : undefined;
		const changeSet = repo ? this.getChangeSet(repo) : undefined;
		if (repo && baseCommit && changeSet) {
			const visible = visibleChanges(changeSet.all(), (rel) => this.isExcluded(rel));
			const tally = seenState.seenProgress(this.seenStore.get(repo.rootFsPath), visible, baseCommit);
			seen = tally.seen;
			total = tally.total;
		}
		void vscode.commands.executeCommand('setContext', 'reviewGutters.seenCount', seen);
		void vscode.commands.executeCommand('setContext', 'reviewGutters.unseenCount', total - seen);
		void vscode.commands.executeCommand('setContext', 'reviewGutters.allSeen', total > 0 && seen === total);
	}

	/** Repaints everything that reads a change set, and tells listeners. */
	private notifyChangeSetsChanged(): void {
		this.decorations.refresh();
		// The seen tally is a function of the change set and the base, so a
		// refresh moves it even though no mark was made — a base that advanced
		// overnight invalidates every mark in the repository.
		this.updateSeenContextKeys();
		this.changeSetsChangedEmitter.fire();
	}

	// --------------------------------------------------------------- lifecycle

	private adopt(repo: RepoInfo): RepoRuntime {
		const existing = this.runtimes.get(repo.rootFsPath);
		if (existing) {
			existing.info = repo;
			return existing;
		}
		const runtime: RepoRuntime = {
			info: repo,
			state: this.store.get(repo.rootFsPath),
			queued: false,
			touched: false,
		};
		this.runtimes.set(repo.rootFsPath, runtime);
		return runtime;
	}

	private onRepositoriesChanged(): void {
		const known = new Set(this.repositories.repositories.map((r) => r.rootFsPath));
		for (const root of [...this.runtimes.keys()]) {
			if (!known.has(root)) {
				this.runtimes.delete(root);
				this.renderer.remove(root);
			}
		}
		for (const repo of this.repositories.repositories) {
			this.adopt(repo);
		}
		this.touchVisibleRepositories();
		this.notifyChangeSetsChanged();
		this.renderStatusBar();
	}

	/**
	 * Repositories only start spawning git once one of their files is on
	 * screen, so a multi-root workspace does not fan out on startup.
	 */
	private touchVisibleRepositories(): void {
		const seen = new Set<string>();
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.scheme !== 'file') {
				continue;
			}
			const repo = this.repositories.getRepositoryFor(editor.document.uri);
			if (!repo || seen.has(repo.rootFsPath)) {
				continue;
			}
			seen.add(repo.rootFsPath);
			const runtime = this.adopt(repo);
			if (runtime.state.enabled && !runtime.touched) {
				runtime.touched = true;
				void this.refresh(repo, 'first visible editor');
			}
		}
	}

	private onActiveEditorChanged(): void {
		this.renderStatusBar();
		const repo = this.activeRepository();
		void vscode.commands.executeCommand(
			'setContext',
			'reviewGutters.enabled',
			repo ? this.isEnabled(repo) : false,
		);
		void vscode.commands.executeCommand('setContext', 'reviewGutters.hasRepository', Boolean(repo));
		void vscode.commands.executeCommand(
			'setContext',
			'reviewGutters.hasBase',
			Boolean(repo && this.getBaseline(repo)?.baseCommit),
		);
		// Visible changes, not raw counts: a change set whose every file is
		// excluded would otherwise leave the view empty with no welcome state.
		void vscode.commands.executeCommand('setContext', 'reviewGutters.hasChanges', this.hasVisibleChanges(repo));
		void vscode.commands.executeCommand('setContext', 'reviewGutters.viewMode', this.viewModeValue);
		this.updateSeenContextKeys();
		this.markActiveFileSeenIfSet();
	}

	/**
	 * `markSeenOnOpen`, hooked onto the editor listener that already runs rather
	 * than a new one. Off by default: with it on, preview-clicking through the
	 * tree marks everything it opens.
	 */
	private markActiveFileSeenIfSet(): void {
		if (!this.config.markSeenOnOpen) {
			return;
		}
		const doc = vscode.window.activeTextEditor?.document;
		// Base-version editors use the review-base scheme. Opening one of those is
		// looking at the old file, not reviewing the working-tree copy, so it
		// must not mark it.
		if (!doc || doc.uri.scheme !== 'file') {
			return;
		}
		const repo = this.repositories.getRepositoryFor(doc.uri);
		if (!repo || !this.isEnabled(repo)) {
			return;
		}
		const changeSet = this.getChangeSet(repo);
		if (!changeSet || !this.getBaseline(repo)?.baseCommit) {
			return;
		}
		const rel = this.repositories.relativePath(repo, doc.uri);
		if (!rel || isDotGitPath(rel) || this.isExcluded(rel) || !changeSet.byPath.has(rel)) {
			return;
		}
		this.setSeen(repo, [rel], true);
	}

	/**
	 * A file that has left the comparison takes its mark with it. Only ever
	 * called once a change set has actually been produced: pruning a repository
	 * that has not loaded yet would wipe real state on startup.
	 */
	private pruneSeenTo(runtime: RepoRuntime): void {
		const changeSet = runtime.changeSet;
		if (!changeSet) {
			return;
		}
		const live = new Set<string>([...changeSet.byPath.keys(), ...changeSet.deleted.map((c) => c.path)]);
		void this.seenStore.prune(runtime.info.rootFsPath, live).catch((err) =>
			log.error(`could not prune the seen state for ${runtime.info.rootFsPath}`, err),
		);
	}

	private hasVisibleChanges(repo: RepoInfo | undefined): boolean {
		if (!repo) {
			return false;
		}
		const changeSet = this.getChangeSet(repo);
		if (!changeSet) {
			return false;
		}
		return visibleChanges(changeSet.all(), (rel) => this.isExcluded(rel)).length > 0;
	}

	/**
	 * Follows the active editor into the tree. Driven only by editor changes and
	 * never by a refresh, so it cannot fight the user's collapse state.
	 */
	private async revealActiveFile(): Promise<void> {
		if (!this.config.autoReveal) {
			return;
		}
		const uri = vscode.window.activeTextEditor?.document.uri;
		if (!uri || uri.scheme !== 'file') {
			return;
		}
		const repo = this.repositories.getRepositoryFor(uri);
		if (!repo || !this.isEnabled(repo)) {
			return;
		}
		const rel = this.repositories.relativePath(repo, uri);
		if (!rel || isDotGitPath(rel) || this.isExcluded(rel)) {
			return;
		}
		if (!this.getChangeSet(repo)?.byPath.has(rel)) {
			return;
		}
		await this.view.revealFile(repo, rel);
	}

	async setViewMode(mode: TreeMode): Promise<void> {
		if (this.viewModeValue === mode) {
			return;
		}
		this.viewModeValue = mode;
		await this.store.setViewMode(mode);
		void vscode.commands.executeCommand('setContext', 'reviewGutters.viewMode', mode);
		this.view.refresh();
	}

	/** Focuses the Changed Files view and reveals the file being edited. */
	async focusChangedFiles(): Promise<void> {
		await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		await this.revealActiveFile();
	}

	private async onConfigChanged(): Promise<void> {
		this.config = readConfig();
		this.isExcludedPath = makeGlobMatcher(this.config.excludeGlobs);
		log.setLogLevel(this.config.logLevel);
		this.decorations.setEnabled(this.config.explorerBadges);
		// The title-bar toggle wins over the setting until it is changed here.
		if (!this.store.getViewMode()) {
			this.viewModeValue = this.config.viewMode;
		}
		this.content.invalidate();
		await this.refreshAllEnabled('configuration changed');
		this.onActiveEditorChanged();
	}

	// ----------------------------------------------------------------- refresh

	async refreshAllEnabled(reason: string): Promise<void> {
		await Promise.all(
			[...this.runtimes.values()]
				.filter((r) => r.state.enabled && r.touched)
				.map((r) => this.refresh(r.info, reason)),
		);
	}

	/** Serialised per repository: at most one in flight and one queued. */
	async refresh(repo: RepoInfo, reason: string): Promise<void> {
		const runtime = this.adopt(repo);
		runtime.touched = true;
		return this.serialised(runtime, () => this.doRefresh(runtime, reason));
	}

	/**
	 * Runs `work` unless a refresh for this repository is already in flight,
	 * in which case a full refresh is queued behind it instead. Every git run
	 * for a repository goes through here, so two operations never share the
	 * repository's shadow index or race to assign its change set.
	 */
	private serialised(runtime: RepoRuntime, work: () => Promise<void>): Promise<void> {
		if (runtime.inFlight) {
			runtime.queued = true;
			return runtime.inFlight;
		}
		const run = async (): Promise<void> => {
			let step = work;
			do {
				runtime.queued = false;
				await step();
				// Anything queued while we ran may have needed a full refresh.
				step = () => this.doRefresh(runtime, 'queued behind another refresh');
			} while (runtime.queued);
		};
		runtime.inFlight = run().finally(() => {
			runtime.inFlight = undefined;
		});
		return runtime.inFlight;
	}

	private async doRefresh(runtime: RepoRuntime, reason: string): Promise<void> {
		log.debug(`refresh ${runtime.info.rootFsPath} (${reason})`);
		await this.ensureGitVersion(runtime.info);

		const previousBase = runtime.baseline?.baseCommit;
		const baseline = await resolveBaseline(runtime.info, runtime.state.selection, this.config);
		runtime.baseline = baseline;

		if (isRenderableBaseline(baseline) && baseline.baseCommit) {
			if (previousBase !== baseline.baseCommit) {
				this.content.invalidate();
			}
			try {
				// Keep the previous change set visible until the new one lands.
				runtime.changeSet = await loadChangeSet(runtime.info, baseline.baseCommit);
			} catch (err) {
				log.error(`could not load the change set for ${runtime.info.rootFsPath}`, err);
				if (previousBase !== baseline.baseCommit) {
					// The old change set describes a different comparison; showing
					// nothing is better than badges and renames from the wrong base.
					runtime.changeSet = undefined;
				}
			}
		} else {
			runtime.changeSet = undefined;
			this.content.invalidate();
		}

		this.pruneSeenTo(runtime);
		this.renderer.sync(runtime.info);
		this.notifyChangeSetsChanged();
		this.renderStatusBar();
	}

	/** Cheap path for saves: the baseline cannot have moved. */
	private refreshChangeSetOnly(runtime: RepoRuntime): Promise<void> {
		return this.serialised(runtime, async () => {
			const baseCommit = runtime.baseline?.baseCommit;
			if (!baseCommit || !isRenderableBaseline(runtime.baseline)) {
				return;
			}
			try {
				runtime.changeSet = await loadChangeSet(runtime.info, baseCommit);
				this.pruneSeenTo(runtime);
				this.renderer.sync(runtime.info);
				this.notifyChangeSetsChanged();
				this.renderStatusBar();
			} catch (err) {
				log.error(`could not reload the change set for ${runtime.info.rootFsPath}`, err);
			}
		});
	}

	private async ensureGitVersion(repo: RepoInfo): Promise<void> {
		await probeVersion(repo.rootFsPath);
		if (!endOfOptionsSupported() && !this.oldGitWarned) {
			this.oldGitWarned = true;
			log.warn('git is older than 2.24; --end-of-options is unavailable, refs are validated by pattern only');
			void vscode.window.showWarningMessage(
				'Branch Review Gutters: git 2.24 or newer is recommended. Older versions are supported with stricter ref validation.',
			);
		}
	}

	// ------------------------------------------------------------------- state

	activeRepository(): RepoInfo | undefined {
		const active = vscode.window.activeTextEditor?.document.uri;
		if (active && active.scheme === 'file') {
			const repo = this.repositories.getRepositoryFor(active);
			if (repo) {
				return repo;
			}
		}
		return this.repositories.repositories[0];
	}

	getState(repo: RepoInfo): RepoState {
		return this.adopt(repo).state;
	}

	async setEnabled(repo: RepoInfo, enabled: boolean): Promise<void> {
		const runtime = this.adopt(repo);
		runtime.state = await this.store.update(repo.rootFsPath, { enabled });
		runtime.touched = true;
		if (enabled) {
			await this.refresh(repo, 'enabled');
		} else {
			runtime.changeSet = undefined;
			this.renderer.sync(repo);
			this.content.invalidate();
			this.notifyChangeSetsChanged();
			this.renderStatusBar();
		}
		this.onActiveEditorChanged();
	}

	async setSelection(repo: RepoInfo, selection: BaseSelection): Promise<void> {
		const runtime = this.adopt(repo);
		if (sameSelection(runtime.state.selection, selection) && runtime.baseline) {
			await this.refresh(repo, 'selection reapplied');
			return;
		}
		runtime.state = await this.store.update(repo.rootFsPath, { selection });
		runtime.baseline = undefined;
		runtime.changeSet = undefined;
		this.content.invalidate();
		await this.refresh(repo, 'selection changed');
	}

	// -------------------------------------------------------------- status bar

	renderStatusBar(): void {
		const repo = this.activeRepository();
		if (!repo) {
			this.statusBar.render({
				hasRepository: false,
				enabled: false,
				status: 'ok',
				selection: { kind: 'auto' },
			});
			return;
		}
		const runtime = this.adopt(repo);
		const baseline = runtime.baseline;
		const counts = runtime.changeSet?.counts;
		this.statusBar.render({
			hasRepository: true,
			enabled: runtime.state.enabled,
			status: baseline?.status ?? 'ok',
			selection: runtime.state.selection,
			baseRef: baseline?.baseRef,
			baseCommit: baseline?.baseCommit,
			headName: baseline?.headName ?? runtime.info.headName,
			headCommit: baseline?.headCommit ?? runtime.info.headCommit,
			message: baseline?.message,
			countsSummary: counts ? describeCounts(counts) : undefined,
			fileCount: counts ? totalChanges(counts) : undefined,
			skippedCount: this.content.skippedCount,
		});
	}

	/** Resolves the base-version uri for a file, for open/compare commands. */
	async baseUriFor(repo: RepoInfo, uri: vscode.Uri): Promise<vscode.Uri | undefined> {
		return this.renderer.baseUriFor(repo, uri);
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
		this.disposables.length = 0;
		this.runtimes.clear();
	}
}
