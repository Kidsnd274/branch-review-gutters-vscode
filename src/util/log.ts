import * as vscode from 'vscode';

export type LogLevel = 'info' | 'debug';

let channel: vscode.OutputChannel | undefined;
let level: LogLevel = 'info';

export function initLog(ctx: vscode.ExtensionContext): void {
	channel = vscode.window.createOutputChannel('Branch Review Gutters');
	ctx.subscriptions.push(channel);
}

export function setLogLevel(next: LogLevel): void {
	level = next;
}

function write(prefix: string, message: string): void {
	const stamp = new Date().toISOString().slice(11, 23);
	channel?.appendLine(`${stamp} ${prefix} ${message}`);
}

export function info(message: string): void {
	write('[info ]', message);
}

export function debug(message: string): void {
	if (level === 'debug') {
		write('[debug]', message);
	}
}

export function warn(message: string): void {
	write('[warn ]', message);
}

export function error(message: string, err?: unknown): void {
	const detail = err instanceof Error ? `${err.message}` : err === undefined ? '' : String(err);
	write('[error]', detail ? `${message}: ${detail}` : message);
}

export function showLog(): void {
	channel?.show(true);
}
