import * as vscode from 'vscode';
import type { RepoInfo } from '../git/repositories';
import type { Baseline } from '../baseline/selection';
import type { BaseContentProvider } from '../content/baseContentProvider';
import type { BasePayload } from '../content/uri';
import { diffLines, splitLines } from '../changes/lineDiff';
import { deletionHints, hunkDiffBlock, type DeletionHint } from '../changes/deletionHints';
import { BOM } from '../content/text';
import * as log from '../util/log';

/** What the hints need from the controller. Implemented structurally. */
export interface DeletedLinesHost {
	getRepositoryFor(uri: vscode.Uri): RepoInfo | undefined;
	getBaseline(repo: RepoInfo): Baseline | undefined;
	basePayloadFor(repo: RepoInfo, uri: vscode.Uri): Promise<BasePayload | undefined>;
	deletedLineHintsEnabled(): boolean;
}

export const OPEN_INLINE_DIFF_COMMAND = 'reviewGutters.openInlineDiff';

const EDIT_DEBOUNCE_MS = 300;

interface DocHints {
	version: number;
	/** Hover body per anchor line. Several hunks can share a line only at the very top. */
	hovers: Map<number, vscode.MarkdownString>;
	options: vscode.DecorationOptions[];
}

/**
 * Option D of the deleted-code review: in a normal editor, a faint label at
 * the end of each line where the branch removed or replaced lines, and a hover
 * on that label showing what was there.
 *
 * Quick Diff already draws the gutter triangle and offers click-to-peek; this
 * adds what it cannot - an always-visible count, readable without a click.
 * Editors showing the file inside a diff tab are skipped, since the diff
 * editor already draws the removed lines in full.
 */
export class DeletedLinesRenderer implements vscode.HoverProvider, vscode.Disposable {
	private readonly decoration = vscode.window.createTextEditorDecorationType({
		after: {
			color: new vscode.ThemeColor('editorGutter.deletedBackground'),
			fontStyle: 'italic',
			margin: '0 0 0 2.5em',
		},
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
	});
	private readonly cache = new Map<string, DocHints>();
	/** Latest computation per document, so a slow one cannot overwrite a newer one. */
	private readonly sequence = new Map<string, number>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly host: DeletedLinesHost,
		private readonly content: BaseContentProvider,
	) {
		this.disposables.push(
			this.decoration,
			vscode.languages.registerHoverProvider({ scheme: 'file' }, this),
			vscode.window.onDidChangeVisibleTextEditors(() => this.update(false)),
			vscode.window.tabGroups.onDidChangeTabs(() => this.repaint()),
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (e.contentChanges.length > 0 && this.isVisible(e.document)) {
					this.schedule(e.document, EDIT_DEBOUNCE_MS);
				}
			}),
			vscode.workspace.onDidCloseTextDocument((doc) => this.forget(doc.uri.toString())),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (
					e.affectsConfiguration('scm.diffDecorationsIgnoreTrimWhitespace') ||
					e.affectsConfiguration('diffEditor.ignoreTrimWhitespace')
				) {
					this.refreshAll();
				}
			}),
		);
		this.refreshAll();
	}

	/** Recomputes every visible file; call when a baseline, change set or setting moved. */
	refreshAll(): void {
		this.update(true);
	}

	/**
	 * Brings every visible file up to date. Without `force`, a file whose hints
	 * were computed for its current text is only repainted, so switching tabs
	 * does not re-run the diff.
	 */
	private update(force: boolean): void {
		const done = new Set<string>();
		for (const editor of vscode.window.visibleTextEditors) {
			const doc = editor.document;
			const key = doc.uri.toString();
			if (doc.uri.scheme !== 'file' || done.has(key)) {
				continue;
			}
			done.add(key);
			if (!force && this.cache.get(key)?.version === doc.version) {
				this.paint(doc);
			} else {
				this.schedule(doc, 0);
			}
		}
	}

	provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const entry = this.cache.get(document.uri.toString());
		if (!entry || entry.version !== document.version || this.activeEditorInDiff(document)) {
			return undefined;
		}
		const lineEnd = document.lineAt(position.line).range.end;
		// Only on the label itself, which sits after the last character, so the
		// hint never piles onto the language's own hover over code.
		if (position.character < lineEnd.character) {
			return undefined;
		}
		const hover = entry.hovers.get(position.line);
		return hover ? new vscode.Hover(hover, new vscode.Range(lineEnd, lineEnd)) : undefined;
	}

	// ------------------------------------------------------------- internals

	private isVisible(doc: vscode.TextDocument): boolean {
		return doc.uri.scheme === 'file' && vscode.window.visibleTextEditors.some((e) => e.document === doc);
	}

	private schedule(doc: vscode.TextDocument, delayMs: number): void {
		const key = doc.uri.toString();
		const pending = this.timers.get(key);
		if (pending) {
			clearTimeout(pending);
		}
		this.timers.set(
			key,
			setTimeout(() => {
				this.timers.delete(key);
				void this.compute(doc).catch((err) => log.error(`deleted-line hints failed for ${doc.uri.fsPath}`, err));
			}, delayMs),
		);
	}

	private async compute(doc: vscode.TextDocument): Promise<void> {
		const key = doc.uri.toString();
		const mine = (this.sequence.get(key) ?? 0) + 1;
		this.sequence.set(key, mine);
		const stale = () => this.sequence.get(key) !== mine || doc.isClosed;

		const repo = this.host.deletedLineHintsEnabled() ? this.host.getRepositoryFor(doc.uri) : undefined;
		const payload = repo ? await this.host.basePayloadFor(repo, doc.uri) : undefined;
		const baseText = payload ? await this.content.baseText(payload) : undefined;
		if (stale()) {
			return;
		}
		if (!repo || baseText === undefined) {
			this.cache.delete(key);
			this.paint(doc);
			return;
		}

		const version = doc.version;
		const oldLines = splitLines(stripBom(baseText));
		const newLines = splitLines(stripBom(doc.getText()));
		const hunks = diffLines(oldLines, newLines, { ignoreTrimWhitespace: ignoreTrimWhitespace(doc.uri) });
		const hints = deletionHints(hunks, newLines.length);
		this.cache.set(key, this.build(doc, repo, hints, oldLines, newLines, version));
		this.paint(doc);
	}

	private build(
		doc: vscode.TextDocument,
		repo: RepoInfo,
		hints: readonly DeletionHint[],
		oldLines: readonly string[],
		newLines: readonly string[],
		version: number,
	): DocHints {
		const baseline = this.host.getBaseline(repo);
		const against = baseline?.baseCommit
			? ` · vs ${baseline.baseRef ?? 'base'} (${baseline.baseCommit.slice(0, 7)})`
			: '';
		const openArgs = encodeURIComponent(JSON.stringify([doc.uri.toString()]));
		const hovers = new Map<number, vscode.MarkdownString>();
		const labels = new Map<number, string[]>();
		for (const hint of hints) {
			const md = hovers.get(hint.line) ?? new vscode.MarkdownString();
			md.isTrusted = { enabledCommands: [OPEN_INLINE_DIFF_COMMAND] };
			if (md.value.length > 0) {
				md.appendMarkdown('\n\n---\n\n');
			}
			md.appendMarkdown(`**${escapeMarkdown(hint.title)}**${escapeMarkdown(against)}\n\n`);
			md.appendMarkdown(hunkDiffBlock(oldLines, newLines, hint.hunk));
			hovers.set(hint.line, md);
			labels.set(hint.line, [...(labels.get(hint.line) ?? []), hint.label]);
		}
		for (const md of hovers.values()) {
			md.appendMarkdown(`\n\n[Open as inline diff](command:${OPEN_INLINE_DIFF_COMMAND}?${openArgs})`);
		}
		const options: vscode.DecorationOptions[] = [];
		for (const [line, text] of labels) {
			const end = doc.lineAt(Math.min(line, doc.lineCount - 1)).range.end;
			options.push({
				range: new vscode.Range(end, end),
				renderOptions: { after: { contentText: text.join('  ') } },
			});
		}
		return { version, hovers, options };
	}

	/**
	 * Applies the cached hints to every visible editor of a document. Hints from
	 * an older version stay up while typing: the editor moves decorations along
	 * with edits, and the debounced recompute replaces them.
	 */
	private paint(doc: vscode.TextDocument): void {
		const entry = this.cache.get(doc.uri.toString());
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document !== doc) {
				continue;
			}
			editor.setDecorations(this.decoration, entry && !this.editorInDiff(editor) ? entry.options : []);
		}
	}

	/** Re-applies cached hints without recomputing, for tab moves. */
	private repaint(): void {
		const docs = new Set(vscode.window.visibleTextEditors.map((e) => e.document));
		for (const doc of docs) {
			if (doc.uri.scheme === 'file') {
				this.paint(doc);
			}
		}
	}

	/**
	 * True when this editor is the working-tree side of a diff tab. A text editor
	 * does not say which tab it belongs to, so it is matched by view column
	 * against the active tab of each group.
	 */
	private editorInDiff(editor: vscode.TextEditor): boolean {
		const target = editor.document.uri.toString();
		return vscode.window.tabGroups.all.some((group) => {
			if (editor.viewColumn !== undefined && group.viewColumn !== editor.viewColumn) {
				return false;
			}
			const input = group.activeTab?.input;
			return input instanceof vscode.TabInputTextDiff && input.modified.toString() === target;
		});
	}

	private activeEditorInDiff(doc: vscode.TextDocument): boolean {
		const editor = vscode.window.activeTextEditor;
		return editor?.document === doc && this.editorInDiff(editor);
	}

	private forget(key: string): void {
		const pending = this.timers.get(key);
		if (pending) {
			clearTimeout(pending);
		}
		this.timers.delete(key);
		this.cache.delete(key);
		this.sequence.delete(key);
	}

	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		this.disposables.forEach((d) => d.dispose());
		this.disposables.length = 0;
		this.cache.clear();
	}
}

function stripBom(text: string): string {
	return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

/** The same whitespace rule the Quick Diff gutter uses, so labels and markers agree. */
function ignoreTrimWhitespace(uri: vscode.Uri): boolean {
	const scm = vscode.workspace.getConfiguration('scm', uri).get<string>('diffDecorationsIgnoreTrimWhitespace', 'false');
	if (scm === 'inherit') {
		return vscode.workspace.getConfiguration('diffEditor', uri).get<boolean>('ignoreTrimWhitespace', true);
	}
	return scm === 'true';
}

function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+!|<>]/g, '\\$&');
}
