import * as vscode from 'vscode';
import type { ChangeKind } from '../changes/parse';
import type { RenderHost } from '../rendering/quickDiff';
import { isRenderableBaseline } from '../baseline/selection';
import { isDotGitPath } from '../util/paths';

interface Style {
	badge: string;
	color: string;
	label: string;
}

const STYLES: Record<ChangeKind, Style> = {
	added: { badge: 'A', color: 'gitDecoration.addedResourceForeground', label: 'Added' },
	untracked: { badge: 'U', color: 'gitDecoration.untrackedResourceForeground', label: 'Untracked' },
	modified: { badge: 'M', color: 'gitDecoration.modifiedResourceForeground', label: 'Modified' },
	typeChanged: { badge: 'M', color: 'gitDecoration.modifiedResourceForeground', label: 'Type changed' },
	renamed: { badge: 'R', color: 'gitDecoration.renamedResourceForeground', label: 'Renamed' },
	deleted: { badge: 'D', color: 'gitDecoration.deletedResourceForeground', label: 'Deleted' },
};

export class ReviewFileDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<undefined>();
	readonly onDidChangeFileDecorations = this.onDidChangeEmitter.event;
	private readonly disposables: vscode.Disposable[] = [];
	private enabled = true;

	constructor(private readonly host: RenderHost) {
		this.disposables.push(this.onDidChangeEmitter, vscode.window.registerFileDecorationProvider(this));
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled !== enabled) {
			this.enabled = enabled;
			this.refresh();
		}
	}

	refresh(): void {
		this.onDidChangeEmitter.fire(undefined);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (!this.enabled || uri.scheme !== 'file') {
			return undefined;
		}
		const repo = this.host.getRepositoryFor(uri);
		if (!repo || !this.host.isEnabled(repo)) {
			return undefined;
		}
		const baseline = this.host.getBaseline(repo);
		if (!isRenderableBaseline(baseline)) {
			return undefined;
		}
		const rel = this.host.relativePath(repo, uri);
		if (!rel || isDotGitPath(rel) || this.host.isExcluded(rel)) {
			return undefined;
		}
		const change = this.host.getChangeSet(repo)?.byPath.get(rel);
		if (!change) {
			return undefined;
		}
		const style = STYLES[change.kind];
		const against = baseline?.baseRef ?? 'base';
		const shortSha = baseline?.baseCommit?.slice(0, 7) ?? '';
		const suffix = change.kind === 'renamed' && change.basePath ? ` from ${change.basePath}` : '';
		const decoration = new vscode.FileDecoration(
			style.badge,
			`${style.label} vs ${against}${suffix} (${baseline?.selection.kind === 'exact' ? 'exact' : 'merge base'} ${shortSha})`,
			new vscode.ThemeColor(style.color),
		);
		decoration.propagate = true;
		return decoration;
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
		this.disposables.length = 0;
	}
}
