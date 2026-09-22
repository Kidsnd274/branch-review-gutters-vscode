import * as vscode from 'vscode';
import type { RenderHost } from '../rendering/quickDiff';
import { isRenderableBaseline } from '../baseline/selection';
import { styleFor } from '../changes/style';
import { parseSeenRow, SEEN_SCHEME } from '../review/seenUri';
import { isDotGitPath } from '../util/paths';

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
		// Seen rows in the Changed Files view, which carry a synthetic uri of
		// their own. Answered before the `enabled` check: that setting governs
		// Explorer badges, and greying a row the reviewer has finished with is
		// the view's own business.
		if (uri.scheme === SEEN_SCHEME) {
			return seenDecoration(uri);
		}
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
		const style = styleFor(change.kind);
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

/**
 * Greys out a row the reviewer has marked seen, keeping the change-kind badge so
 * the row still says what happened to the file.
 */
function seenDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
	const row = parseSeenRow(uri.query);
	if (!row) {
		return undefined;
	}
	return new vscode.FileDecoration(
		row.row === 'file' ? styleFor(row.kind).badge : undefined,
		'Seen',
		new vscode.ThemeColor('disabledForeground'),
	);
}
