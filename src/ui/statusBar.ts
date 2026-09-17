import * as vscode from 'vscode';
import { renderStatus, type StatusInput } from './statusText';

export class StatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;

	constructor() {
		this.item = vscode.window.createStatusBarItem(
			'reviewGutters.status',
			vscode.StatusBarAlignment.Right,
			95,
		);
		this.item.name = 'Branch Review Gutters';
		this.item.command = 'reviewGutters.showMenu';
	}

	render(input: StatusInput): void {
		const out = renderStatus(input);
		if (out.hidden) {
			this.item.hide();
			return;
		}
		this.item.text = out.text;
		const tooltip = new vscode.MarkdownString(out.tooltip);
		tooltip.isTrusted = false;
		tooltip.supportThemeIcons = true;
		this.item.tooltip = tooltip;
		this.item.backgroundColor =
			out.severity === 'error'
				? new vscode.ThemeColor('statusBarItem.errorBackground')
				: out.severity === 'warning'
					? new vscode.ThemeColor('statusBarItem.warningBackground')
					: undefined;
		this.item.show();
	}

	dispose(): void {
		this.item.dispose();
	}
}
