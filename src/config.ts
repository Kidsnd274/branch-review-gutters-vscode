import * as vscode from 'vscode';
import type { LogLevel } from './util/log';
import type { TreeMode } from './tree/changeTree';

/** What opening a changed file shows: the normal editor, or an inline diff against the base. */
export type OpenMode = 'editor' | 'inlineDiff';

export interface Config {
	baseBranches: string[];
	remote: string;
	explorerBadges: boolean;
	viewMode: TreeMode;
	autoReveal: boolean;
	markSeenOnOpen: boolean;
	openMode: OpenMode;
	deletedLineHints: boolean;
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
		viewMode: c.get<string>('viewMode', 'tree') === 'list' ? 'list' : 'tree',
		autoReveal: c.get<boolean>('autoReveal', true),
		markSeenOnOpen: c.get<boolean>('markSeenOnOpen', false),
		openMode: c.get<string>('openMode', 'editor') === 'inlineDiff' ? 'inlineDiff' : 'editor',
		deletedLineHints: c.get<boolean>('deletedLineHints', true),
		maxFileSizeKB: Math.max(1, c.get<number>('maxFileSizeKB', 1024)),
		excludeGlobs: Array.isArray(excludeGlobs) ? excludeGlobs.filter((g) => typeof g === 'string') : [],
		logLevel: c.get<LogLevel>('logLevel', 'info') === 'debug' ? 'debug' : 'info',
	};
}
