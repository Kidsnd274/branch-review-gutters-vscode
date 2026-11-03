import * as vscode from 'vscode';
import type { RepoInfo } from '../git/repositories';
import type { Baseline } from '../baseline/selection';
import type { ChangeSet, FileChange } from '../changes/parse';
import { BASE_SCHEME, decodeBaseQuery } from '../content/uri';
import type { ChangeTarget } from '../tree/changedFilesView';

/** What the deleted-file view needs from the controller. Implemented structurally. */
export interface DeletedFilesHost {
	repositoryAt(rootFsPath: string): RepoInfo | undefined;
	getBaseline(repo: RepoInfo): Baseline | undefined;
	getChangeSet(repo: RepoInfo): ChangeSet | undefined;
	isSeen(repo: RepoInfo, relPath: string): boolean;
}

/**
 * Option C of the deleted-code review: a file the branch deleted opens as its
 * base version, painted red from top to bottom, with a banner above line 1
 * saying so and offering the seen tick.
 *
 * Only base versions of files the current change set lists as deleted are
 * painted. "Open Base Version" of a file that still exists stays plain.
 */
export class DeletedFilesRenderer implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly decoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Full,
	});
	private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly host: DeletedFilesHost) {
		this.disposables.push(
			this.decoration,
			this.onDidChangeCodeLensesEmitter,
			vscode.languages.registerCodeLensProvider({ scheme: BASE_SCHEME }, this),
			vscode.window.onDidChangeVisibleTextEditors(() => this.paintAll()),
			// The base content arrives after the editor opens, and changes when the
			// cache is invalidated, so the painted range has to follow it.
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (e.document.uri.scheme === BASE_SCHEME) {
					this.paintAll();
				}
			}),
		);
		this.paintAll();
	}

	/** Repaints after the change set, the base, or a seen mark moved. */
	refresh(): void {
		this.paintAll();
		this.onDidChangeCodeLensesEmitter.fire();
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const target = this.deletedTarget(document.uri);
		if (!target) {
			return [];
		}
		const { repo, change } = target;
		const baseline = this.host.getBaseline(repo);
		const range = new vscode.Range(0, 0, 0, 0);
		const where = baseline?.baseCommit
			? ` · this is how it looked at ${baseline.baseRef ?? 'the base'} (${baseline.baseCommit.slice(0, 7)})`
			: '';
		const seen = this.host.isSeen(repo, change.path);
		const payload: ChangeTarget = { rootFsPath: repo.rootFsPath, change };
		return [
			new vscode.CodeLens(range, { title: `$(trash) Deleted on this branch${where}`, command: '' }),
			new vscode.CodeLens(range, {
				title: seen ? '$(close) Mark as Unseen' : '$(check) Mark as Seen',
				command: seen ? 'reviewGutters.markUnseen' : 'reviewGutters.markSeen',
				arguments: [payload],
			}),
		];
	}

	private paintAll(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.scheme !== BASE_SCHEME) {
				continue;
			}
			const deleted = this.deletedTarget(editor.document.uri) !== undefined;
			const last = editor.document.lineCount - 1;
			editor.setDecorations(this.decoration, deleted ? [new vscode.Range(0, 0, last, 0)] : []);
		}
	}

	/** The deleted change a `review-base` document shows, if it shows one. */
	private deletedTarget(uri: vscode.Uri): { repo: RepoInfo; change: FileChange } | undefined {
		if (uri.scheme !== BASE_SCHEME) {
			return undefined;
		}
		let payload;
		try {
			payload = decodeBaseQuery(uri.query);
		} catch {
			return undefined;
		}
		const repo = this.host.repositoryAt(payload.repo);
		if (!repo || payload.base === null || this.host.getBaseline(repo)?.baseCommit !== payload.commit) {
			return undefined;
		}
		const change = this.host.getChangeSet(repo)?.deleted.find((c) => c.path === payload.base);
		return change ? { repo, change } : undefined;
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
		this.disposables.length = 0;
	}
}
