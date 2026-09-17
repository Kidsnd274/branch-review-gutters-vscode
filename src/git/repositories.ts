import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { API as GitAPI, GitExtension, Repository as GitRepository } from '../types/git';
import { gitLine, setGitPath } from './exec';
import { debounce } from '../util/debounce';
import { posixRelative } from '../util/paths';
import * as log from '../util/log';

export interface RepoInfo {
	rootUri: vscode.Uri;
	rootFsPath: string;
	headName?: string;
	headCommit?: string;
}

const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

export class RepositoryService implements vscode.Disposable {
	private readonly repos = new Map<string, RepoInfo>();
	private readonly disposables: vscode.Disposable[] = [];
	/** Per-repository disposables, keyed by root fsPath. */
	private readonly perRepo = new Map<string, vscode.Disposable[]>();

	private readonly onDidChangeRepositoriesEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeRepositories = this.onDidChangeRepositoriesEmitter.event;

	private readonly onDidChangeRepositoryStateEmitter = new vscode.EventEmitter<RepoInfo>();
	readonly onDidChangeRepositoryState = this.onDidChangeRepositoryStateEmitter.event;

	private api: GitAPI | undefined;
	private usingFallback = false;

	get repositories(): readonly RepoInfo[] {
		return [...this.repos.values()];
	}

	async initialize(): Promise<void> {
		this.disposables.push(
			this.onDidChangeRepositoriesEmitter,
			this.onDidChangeRepositoryStateEmitter,
		);
		const attached = await this.tryAttachGitExtension();
		if (!attached) {
			await this.startFallback();
		}
	}

	getRepositoryFor(uri: vscode.Uri): RepoInfo | undefined {
		if (uri.scheme !== 'file') {
			return undefined;
		}
		// Longest matching root wins, so submodules beat their super-project.
		let best: RepoInfo | undefined;
		for (const repo of this.repos.values()) {
			if (posixRelative(repo.rootFsPath, uri.fsPath, CASE_INSENSITIVE) === undefined) {
				continue;
			}
			if (!best || repo.rootFsPath.length > best.rootFsPath.length) {
				best = repo;
			}
		}
		return best;
	}

	getRepository(rootFsPath: string): RepoInfo | undefined {
		return this.repos.get(rootFsPath);
	}

	/** Repo-relative POSIX path, or `undefined` if the uri is outside `repo`. */
	relativePath(repo: RepoInfo, uri: vscode.Uri): string | undefined {
		return posixRelative(repo.rootFsPath, uri.fsPath, CASE_INSENSITIVE);
	}

	// ---------------------------------------------------------------- git ext

	private async tryAttachGitExtension(): Promise<boolean> {
		const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
		if (!ext) {
			log.info('built-in Git extension not found; using fallback repository discovery');
			return false;
		}
		let exports: GitExtension;
		try {
			exports = await ext.activate();
		} catch (err) {
			log.error('could not activate the built-in Git extension', err);
			return false;
		}
		if (!exports.enabled) {
			log.info('built-in Git extension is disabled (git.enabled=false); using fallback discovery');
			// If the user enables git later, switch over.
			this.disposables.push(
				exports.onDidChangeEnablement(async (enabled) => {
					if (enabled && this.usingFallback) {
						log.info('git enablement changed; re-attaching to the Git extension');
						this.teardownRepos();
						this.usingFallback = false;
						await this.tryAttachGitExtension();
						this.onDidChangeRepositoriesEmitter.fire();
					}
				}),
			);
			return false;
		}

		const api = exports.getAPI(1);
		this.api = api;
		setGitPath(api.git?.path);
		log.info(`attached to the built-in Git extension (${api.repositories.length} repositories)`);

		for (const repo of api.repositories) {
			this.addApiRepository(repo);
		}
		this.disposables.push(
			api.onDidOpenRepository((repo) => {
				this.addApiRepository(repo);
				this.onDidChangeRepositoriesEmitter.fire();
			}),
			api.onDidCloseRepository((repo) => {
				this.removeRepository(repo.rootUri.fsPath);
				this.onDidChangeRepositoriesEmitter.fire();
			}),
		);
		return true;
	}

	private addApiRepository(repo: GitRepository): void {
		const rootFsPath = repo.rootUri.fsPath;
		const info: RepoInfo = {
			rootUri: repo.rootUri,
			rootFsPath,
			headName: repo.state.HEAD?.name,
			headCommit: repo.state.HEAD?.commit,
		};
		this.repos.set(rootFsPath, info);

		const notify = debounce(() => {
			const current = this.repos.get(rootFsPath);
			if (!current) {
				return;
			}
			current.headName = repo.state.HEAD?.name;
			current.headCommit = repo.state.HEAD?.commit;
			this.onDidChangeRepositoryStateEmitter.fire(current);
		}, 300);
		const sub = repo.state.onDidChange(() => notify());
		this.perRepo.set(rootFsPath, [sub, { dispose: () => notify.cancel() }]);
	}

	// ---------------------------------------------------------------- fallback

	private async startFallback(): Promise<void> {
		this.usingFallback = true;
		setGitPath(vscode.workspace.getConfiguration('git').get<string>('path') ?? undefined);
		await this.discoverWorkspaceRepos();
		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(async () => {
				await this.discoverWorkspaceRepos();
				this.onDidChangeRepositoriesEmitter.fire();
			}),
		);
	}

	private async discoverWorkspaceRepos(): Promise<void> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const found = new Set<string>();
		for (const folder of folders) {
			if (folder.uri.scheme !== 'file') {
				continue;
			}
			const root = await gitLine(folder.uri.fsPath, ['rev-parse', '--show-toplevel'], { timeoutMs: 5000 }).catch(
				() => undefined,
			);
			if (!root) {
				continue;
			}
			found.add(root);
			if (this.repos.has(root)) {
				continue;
			}
			const info: RepoInfo = { rootUri: vscode.Uri.file(root), rootFsPath: root };
			this.repos.set(root, info);
			this.watchFallbackRepo(info);
			log.info(`discovered repository (fallback): ${root}`);
		}
		for (const known of [...this.repos.keys()]) {
			if (!found.has(known)) {
				this.removeRepository(known);
			}
		}
	}

	/**
	 * Watches `HEAD` and `refs/**` in the git directory. For worktrees and
	 * submodules `.git` is a file containing `gitdir: <path>`.
	 */
	private watchFallbackRepo(info: RepoInfo): void {
		const gitDir = resolveGitDir(info.rootFsPath);
		const subs: vscode.Disposable[] = [];
		const notify = debounce(async () => {
			const current = this.repos.get(info.rootFsPath);
			if (!current) {
				return;
			}
			current.headCommit = await gitLine(current.rootFsPath, ['rev-parse', 'HEAD']).catch(() => undefined);
			current.headName = await gitLine(current.rootFsPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(
				() => undefined,
			);
			this.onDidChangeRepositoryStateEmitter.fire(current);
		}, 300);

		if (gitDir) {
			const pattern = new vscode.RelativePattern(vscode.Uri.file(gitDir), '{HEAD,refs/**,packed-refs}');
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			subs.push(
				watcher,
				watcher.onDidChange(() => notify()),
				watcher.onDidCreate(() => notify()),
				watcher.onDidDelete(() => notify()),
			);
		} else {
			log.warn(`could not resolve a git directory for ${info.rootFsPath}; relying on focus events`);
		}
		subs.push({ dispose: () => notify.cancel() });
		this.perRepo.set(info.rootFsPath, subs);
		void notify();
	}

	private removeRepository(rootFsPath: string): void {
		this.repos.delete(rootFsPath);
		const subs = this.perRepo.get(rootFsPath);
		this.perRepo.delete(rootFsPath);
		subs?.forEach((s) => s.dispose());
	}

	private teardownRepos(): void {
		for (const root of [...this.repos.keys()]) {
			this.removeRepository(root);
		}
	}

	/** Re-reads HEAD for every repository; used on window focus regain. */
	async refreshHeads(): Promise<void> {
		if (this.api) {
			for (const repo of this.api.repositories) {
				const info = this.repos.get(repo.rootUri.fsPath);
				if (info) {
					info.headName = repo.state.HEAD?.name;
					info.headCommit = repo.state.HEAD?.commit;
				}
			}
			return;
		}
		for (const info of this.repos.values()) {
			info.headCommit = await gitLine(info.rootFsPath, ['rev-parse', 'HEAD']).catch(() => undefined);
		}
	}

	dispose(): void {
		this.teardownRepos();
		this.disposables.forEach((d) => d.dispose());
		this.disposables.length = 0;
	}
}

/**
 * Resolves the directory that holds `HEAD` and `refs/`. Handles the worktree
 * and submodule case where `<root>/.git` is a file containing `gitdir: ...`.
 * Returns the *common* directory when one is recorded, since that is where
 * branch refs live for a linked worktree.
 */
export function resolveGitDir(rootFsPath: string): string | undefined {
	const dotGit = path.join(rootFsPath, '.git');
	let stat: fs.Stats;
	try {
		stat = fs.statSync(dotGit);
	} catch {
		return undefined;
	}
	if (stat.isDirectory()) {
		return dotGit;
	}
	try {
		const contents = fs.readFileSync(dotGit, 'utf8');
		const m = /^gitdir:\s*(.+)\s*$/m.exec(contents);
		if (!m) {
			return undefined;
		}
		const target = path.isAbsolute(m[1]) ? m[1] : path.resolve(rootFsPath, m[1]);
		const commonDirFile = path.join(target, 'commondir');
		if (fs.existsSync(commonDirFile)) {
			const common = fs.readFileSync(commonDirFile, 'utf8').trim();
			return path.isAbsolute(common) ? common : path.resolve(target, common);
		}
		return target;
	} catch {
		return undefined;
	}
}
