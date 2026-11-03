import * as vscode from 'vscode';
import { basenamePosix } from '../util/paths';

/** The question below is asked at most once a session, whatever the answer. */
let asked = false;

/**
 * Opens base ↔ working tree as a diff meant to be read inline. The working-tree
 * side is the real file, so Go to Definition and the rest work there.
 */
export async function showBaseDiff(baseUri: vscode.Uri, fileUri: vscode.Uri, relPath: string): Promise<void> {
	await vscode.commands.executeCommand('vscode.diff', baseUri, fileUri, `${basenamePosix(relPath)} (base ↔ working tree)`, {
		preview: true,
	});
	void offerInlineView();
}

/**
 * VS Code has no per-editor "open this diff inline" option: inline or side by
 * side is the user-level `diffEditor.renderSideBySide` setting, shared by every
 * diff editor. So instead of flipping it behind the user's back, ask once.
 * Doesn't block: the diff opens either way and follows the setting live.
 */
export async function offerInlineView(): Promise<void> {
	const diffConfig = vscode.workspace.getConfiguration('diffEditor');
	if (asked || diffConfig.get<boolean>('renderSideBySide', true) === false) {
		return;
	}
	asked = true;
	const useInline = 'Use Inline View';
	const keep = 'Keep Side by Side';
	const choice = await vscode.window.showInformationMessage(
		'Branch Review Gutters: your diffs open side by side. Switch VS Code to inline diffs, with deleted lines as red rows inside the file? This changes the diffEditor.renderSideBySide setting, which applies to every diff editor.',
		useInline,
		keep,
	);
	if (choice === useInline) {
		await diffConfig.update('renderSideBySide', false, vscode.ConfigurationTarget.Global);
	}
}
