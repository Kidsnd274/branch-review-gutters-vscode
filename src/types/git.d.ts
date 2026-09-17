/**
 * Minimal subset of the built-in Git extension's API (`vscode.git`, version 1)
 * covering only what this extension consumes. Mirrors the shape of
 * `extensions/git/src/api/git.d.ts` in the VS Code repository.
 */
import type { Uri, Event, Disposable } from 'vscode';

export interface Ref {
	readonly type: number;
	readonly name?: string;
	readonly commit?: string;
	readonly remote?: string;
}

export interface Branch extends Ref {
	readonly upstream?: { readonly name: string; readonly remote: string };
	readonly ahead?: number;
	readonly behind?: number;
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly onDidChange: Event<void>;
}

export interface Repository {
	readonly rootUri: Uri;
	readonly state: RepositoryState;
}

export interface Git {
	readonly path: string;
}

export interface API {
	readonly git: Git;
	readonly repositories: Repository[];
	getRepository(uri: Uri): Repository | null;
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;
}

export interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: Event<boolean>;
	getAPI(version: 1): API;
}

export type { Disposable };
