import * as vscode from 'vscode';
import type { RepoInfo } from '../git/repositories';
import { isRenderableBaseline, type Baseline } from '../baseline/selection';
import type { ChangeSet } from '../changes/parse';
import { resolveBasePath } from '../changes/parse';
import { BaseContentProvider, makeBaseUri } from '../content/baseContentProvider';
import { isDotGitPath } from '../util/paths';
import * as log from '../util/log';

/** What the renderer needs from the controller. Implemented structurally. */
export interface RenderHost {
	getRepositoryFor(uri: vscode.Uri): RepoInfo | undefined;
	relativePath(repo: RepoInfo, uri: vscode.Uri): string | undefined;
	isEnabled(repo: RepoInfo): boolean;
	getBaseline(repo: RepoInfo): Baseline | undefined;
	getChangeSet(repo: RepoInfo): ChangeSet | undefined;
	isExcluded(relPath: string): boolean;
}

/**
 * Renders branch changes through VS Code's Quick Diff, which gives native
 * gutter markers, click-to-peek and dirty-diff navigation for free.
 *
 * `window.registerQuickDiffProvider` is not stable in 1.138, so we take the
 * documented fallback: one `SourceControl` per repository carrying only a
 * quick diff provider — no resource groups, no input box use, count 0.
 */
export class QuickDiffRenderer implements vscode.Disposable {
	private readonly controls = new Map<string, vscode.SourceControl>();
	/** Last state the originals were computed from, keyed by repo root. */
	private readonly signatures = new Map<string, string>();

	constructor(
		private readonly host: RenderHost,
		private readonly content: BaseContentProvider,
	) {}

	/** Creates or recreates the provider for a repository. */
	private register(repo: RepoInfo): void {
		this.unregister(repo.rootFsPath);
		const control = vscode.scm.createSourceControl('branchReviewGutters', 'Branch Review', repo.rootUri);
		control.count = 0;
		control.quickDiffProvider = {
			provideOriginalResource: (uri) => this.provideOriginalResource(repo, uri),
		};
		this.controls.set(repo.rootFsPath, control);
		log.debug(`quick diff provider registered for ${repo.rootFsPath}`);
	}

	private unregister(rootFsPath: string): void {
		const existing = this.controls.get(rootFsPath);
		if (existing) {
			existing.dispose();
			this.controls.delete(rootFsPath);
		}
		this.signatures.delete(rootFsPath);
	}

	/**
	 * Everything that can change which original a file maps to: the commit
	 * compared against, and the files whose base path is not their own path.
	 */
	private signatureFor(repo: RepoInfo): string {
		const baseline = this.host.getBaseline(repo);
		const changeSet = this.host.getChangeSet(repo);
		const remapped: string[] = [];
		if (changeSet) {
			for (const change of changeSet.byPath.values()) {
				if (change.kind === 'added' || change.kind === 'untracked') {
					remapped.push(`+${change.path}`);
				} else if (change.kind === 'renamed') {
					remapped.push(`${change.basePath}>${change.path}`);
				}
			}
			remapped.sort();
		}
		return `${baseline?.baseCommit ?? ''}|${remapped.join('\u0000')}`;
	}

	/**
	 * Brings registration in line with the repository's current state.
	 * Re-registering is what makes VS Code re-request originals for already
	 * open editors, so it is done exactly when the answers would differ -
	 * a plain refresh that changed nothing must not flicker the SCM view.
	 */
	sync(repo: RepoInfo): void {
		const shouldRender = this.host.isEnabled(repo) && isRenderableBaseline(this.host.getBaseline(repo));
		if (!shouldRender) {
			this.unregister(repo.rootFsPath);
			return;
		}
		const signature = this.signatureFor(repo);
		if (this.controls.has(repo.rootFsPath) && this.signatures.get(repo.rootFsPath) === signature) {
			return;
		}
		this.register(repo);
		this.signatures.set(repo.rootFsPath, signature);
	}

	remove(rootFsPath: string): void {
		this.unregister(rootFsPath);
	}

	private async provideOriginalResource(repo: RepoInfo, uri: vscode.Uri): Promise<vscode.Uri | undefined> {
		if (uri.scheme !== 'file') {
			return undefined;
		}
		if (!this.host.isEnabled(repo)) {
			return undefined;
		}
		const baseline = this.host.getBaseline(repo);
		if (!isRenderableBaseline(baseline) || !baseline?.baseCommit) {
			return undefined;
		}
		// Longest-root matching, so a submodule's files are not claimed here.
		if (this.host.getRepositoryFor(uri)?.rootFsPath !== repo.rootFsPath) {
			return undefined;
		}
		const rel = this.host.relativePath(repo, uri);
		if (!rel || isDotGitPath(rel) || this.host.isExcluded(rel)) {
			return undefined;
		}
		const basePath = resolveBasePath(this.host.getChangeSet(repo), rel);
		const payload = { repo: repo.rootFsPath, commit: baseline.baseCommit, base: basePath };
		if (!(await this.content.shouldProvide(payload))) {
			return undefined;
		}
		return makeBaseUri(rel, payload);
	}

	/** The `review-base` uri for a file, for "open base version" / "compare". */
	async baseUriFor(repo: RepoInfo, uri: vscode.Uri): Promise<vscode.Uri | undefined> {
		return this.provideOriginalResource(repo, uri);
	}

	dispose(): void {
		for (const root of [...this.controls.keys()]) {
			this.unregister(root);
		}
	}
}
