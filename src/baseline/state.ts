import * as vscode from 'vscode';
import type { BaseSelection } from './resolver';

export interface RepoState {
	enabled: boolean;
	selection: BaseSelection;
}

const KEY = 'reviewGutters.repos.v1';

export const DEFAULT_REPO_STATE: RepoState = { enabled: false, selection: { kind: 'auto' } };

function sanitize(value: unknown): RepoState | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const raw = value as { enabled?: unknown; selection?: unknown };
	const selection = raw.selection as { kind?: unknown; ref?: unknown } | undefined;
	let parsed: BaseSelection = { kind: 'auto' };
	if (selection && (selection.kind === 'ref' || selection.kind === 'exact') && typeof selection.ref === 'string') {
		parsed = { kind: selection.kind, ref: selection.ref };
	}
	return { enabled: raw.enabled === true, selection: parsed };
}

export class StateStore {
	private cache: Record<string, RepoState>;

	constructor(private readonly memento: vscode.Memento) {
		const stored = memento.get<Record<string, unknown>>(KEY, {});
		this.cache = {};
		for (const [root, value] of Object.entries(stored ?? {})) {
			const parsed = sanitize(value);
			if (parsed) {
				this.cache[root] = parsed;
			}
		}
	}

	get(rootFsPath: string): RepoState {
		return this.cache[rootFsPath] ?? { ...DEFAULT_REPO_STATE, selection: { kind: 'auto' } };
	}

	async set(rootFsPath: string, state: RepoState): Promise<void> {
		this.cache[rootFsPath] = state;
		await this.memento.update(KEY, this.cache);
	}

	async update(rootFsPath: string, patch: Partial<RepoState>): Promise<RepoState> {
		const next: RepoState = { ...this.get(rootFsPath), ...patch };
		await this.set(rootFsPath, next);
		return next;
	}
}
