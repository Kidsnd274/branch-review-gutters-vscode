import * as vscode from 'vscode';
import { RepositoryService, type RepoInfo } from './git/repositories';
import { StateStore, type RepoState } from './baseline/state';
import { resolveBaseline, sameSelection, type BaseSelection, type Baseline } from './baseline/resolver';
import { loadChangeSet } from './changes/changeSet';
import { describeCounts, totalChanges, type ChangeSet } from './changes/parse';
import { BaseContentProvider } from './content/baseContentProvider';
import { QuickDiffRenderer, type RenderHost } from './rendering/quickDiff';
import { isRenderableBaseline } from './baseline/selection';
import { ReviewFileDecorationProvider } from './explorer/fileDecorations';
import { StatusBar } from './ui/statusBar';
import { readConfig, CONFIG_SECTION, type Config } from './config';
import { makeGlobMatcher } from './util/paths';
import { debounce } from './util/debounce';
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

export class Controller implements RenderHost, vscode.Disposable {
	private readonly runtimes = new Map<string, RepoRuntime>();
	private readonly disposables: vscode.Disposable[] = [];
	private config: Config;
	private isExcludedPath: (relPath: string) => boolean;
	private lastFocusRefresh = 0;
	private oldGitWarned = false;

	readonly content: BaseContentProvider;
	private readonly renderer: QuickDiffRenderer;
	private readonly decorations: ReviewFileDecorationProvider;
	private readonly statusBar: StatusBar;

	constructor(
		private readonly repositories: RepositoryService,
		private readonly store: StateStore,
	) {
		this.config = readConfig();
		this.isExcludedPath = makeGlobMatcher(this.config.excludeGlobs);
		log.setLogLevel(this.config.logLevel);

		this.content = new BaseContentProvider(() => this.config);
		this.renderer = new QuickDiffRenderer(this, this.content);
		this.decorations = new ReviewFileDecorationProvider(this);
		this.decorations.setEnabled(this.config.explorerBadges);
		this.statusBar = new StatusBar();
		this.disposables.push(this.content, this.renderer, this.decorations, this.statusBar);
	}

	async initialize(): Promise<void> {
		for (const repo of this.repositories.repositories) {
			this.adopt(repo);
		}

		const saveDebounced = debounce(() => {
			for (const runtime of this.runtimes.values()) {
				if (runtime.state.enabled && runtime.touched) {
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
			}),
			vscode.window.onDidChangeVisibleTextEditors(() => this.touchVisibleRepositories()),
			vscode.workspace.onDidSaveTextDocument((doc) => {
				if (doc.uri.scheme !== 'file') {
					return;
				}
				const repo = this.repositories.getRepositoryFor(doc.uri);
				if (repo && this.isEnabled(repo)) {
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
		);

		this.touchVisibleRepositories();
		this.onActiveEditorChanged();
	}

	// ------------------------------------------------------------- RenderHost

	getRepositoryFor(uri: vscode.Uri): RepoInfo | undefined {
		return this.repositories.getRepositoryFor(uri);
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
		this.decorations.refresh();
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
	}

	private async onConfigChanged(): Promise<void> {
		this.config = readConfig();
		this.isExcludedPath = makeGlobMatcher(this.config.excludeGlobs);
		log.setLogLevel(this.config.logLevel);
		this.decorations.setEnabled(this.config.explorerBadges);
		this.content.invalidate();
		await this.refreshAllEnabled('configuration changed');
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
		if (runtime.inFlight) {
			runtime.queued = true;
			return runtime.inFlight;
		}
		const run = async (): Promise<void> => {
			do {
				runtime.queued = false;
				await this.doRefresh(runtime, reason);
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
			}
		} else {
			runtime.changeSet = undefined;
			this.content.invalidate();
		}

		this.renderer.sync(runtime.info, { recreate: true });
		this.decorations.refresh();
		this.renderStatusBar();
	}

	/** Cheap path for saves: the baseline cannot have moved. */
	private async refreshChangeSetOnly(runtime: RepoRuntime): Promise<void> {
		const baseCommit = runtime.baseline?.baseCommit;
		if (!baseCommit || !isRenderableBaseline(runtime.baseline)) {
			return;
		}
		try {
			runtime.changeSet = await loadChangeSet(runtime.info, baseCommit);
			this.decorations.refresh();
			this.renderStatusBar();
		} catch (err) {
			log.error(`could not reload the change set for ${runtime.info.rootFsPath}`, err);
		}
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
			this.decorations.refresh();
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
