import * as vscode from 'vscode';
import type { LogLevel } from './util/log';

export interface Config {
	baseBranches: string[];
	remote: string;
	explorerBadges: boolean;
	maxFileSizeKB: number;
	excludeGlobs: string[];
	logLevel: LogLevel;
}

export const CONFIG_SECTION = 'reviewGutters';

export function readConfig(scope?: vscode.Uri): Config {
	const c = vscode.workspace.getConfiguration(CONFIG_SECTION, scope ?? null);
	const baseBranches = c.get<string[]>('baseBranches', ['main', 'master']);
	const excludeGlobs = c.get<string[]>('excludeGlobs', []);
	return {
		baseBranches: Array.isArray(baseBranches) ? baseBranches.filter((b) => typeof b === 'string') : ['main', 'master'],
		remote: c.get<string>('remote', 'origin') || 'origin',
		explorerBadges: c.get<boolean>('explorerBadges', true),
		maxFileSizeKB: Math.max(1, c.get<number>('maxFileSizeKB', 1024)),
		excludeGlobs: Array.isArray(excludeGlobs) ? excludeGlobs.filter((g) => typeof g === 'string') : [],
		logLevel: c.get<LogLevel>('logLevel', 'info') === 'debug' ? 'debug' : 'info',
	};
}
