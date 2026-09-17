import * as vscode from 'vscode';
import type { Controller } from '../controller';
import type { RepoInfo } from '../git/repositories';
import type { BaseSelection } from '../baseline/resolver';
import { isAncestor, listRefs, resolveCommit, type RefEntry } from '../git/refs';
import { isValidRef } from '../git/args';
import { makeBaseUri } from '../content/baseContentProvider';
import { describeCounts, totalChanges, type FileChange } from '../changes/parse';
import { basenamePosix, dirnamePosix } from '../util/paths';
import * as log from '../util/log';

interface RefItem extends vscode.QuickPickItem {
	ref?: string;
	manual?: boolean;
}

function sectionItems(refs: RefEntry[], kind: RefEntry['kind'], title: string, exclude?: string): RefItem[] {
	const matching = refs.filter((r) => r.kind === kind && r.shortName !== exclude);
	if (matching.length === 0) {
		return [];
	}
	return [
		{ label: title, kind: vscode.QuickPickItemKind.Separator },
		...matching.map((r) => ({
			label: r.shortName,
			description: [r.shortSha, r.relativeDate].filter(Boolean).join('  ·  '),
			ref: r.shortName,
		})),
	];
}

/** Base picker: branches, remote branches, tags, plus manual entry. */
export async function pickBase(controller: Controller, repo: RepoInfo): Promise<BaseSelection | undefined> {
	let refs: RefEntry[] = [];
	try {
		refs = await listRefs(repo.rootFsPath);
	} catch (err) {
		log.error('could not list refs', err);
		void vscode.window.showErrorMessage('Branch Review Gutters: could not list refs. See the log for details.');
		return undefined;
	}
	const currentBranch = controller.getBaseline(repo)?.headName;
	const items: RefItem[] = [
		...sectionItems(refs, 'head', 'Local branches', currentBranch),
		...sectionItems(refs, 'remote', 'Remote branches'),
		...sectionItems(refs, 'tag', 'Tags'),
		{ label: '', kind: vscode.QuickPickItemKind.Separator },
		{ label: '$(edit) Enter a ref or commit manually…', manual: true, alwaysShow: true },
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: 'Select the base to review against',
		placeHolder: 'Branch, tag, ref or commit',
		matchOnDescription: true,
	});
	if (!picked) {
		return undefined;
	}

	const ref = picked.manual ? await promptForRef(repo) : picked.ref;
	if (!ref) {
		return undefined;
	}
	return pickMode(repo, ref);
}

async function promptForRef(repo: RepoInfo): Promise<string | undefined> {
	let sequence = 0;
	return vscode.window.showInputBox({
		title: 'Base ref or commit',
		prompt: 'A branch, tag, commit sha or revision expression such as HEAD~3',
		ignoreFocusOut: true,
		validateInput: async (value): Promise<string | undefined> => {
			const input = value.trim();
			if (input.length === 0) {
				return undefined;
			}
			if (!isValidRef(input)) {
				return 'Not a ref this extension will pass to git.';
			}
			const mine = ++sequence;
			await new Promise((resolve) => setTimeout(resolve, 200));
			if (mine !== sequence) {
				return undefined;
			}
			const sha = await resolveCommit(repo.rootFsPath, input).catch(() => undefined);
			return sha ? undefined : `Not found: ${input}`;
		},
	});
}

/** Merge base or exact comparison. Skipped when the two are equivalent. */
async function pickMode(repo: RepoInfo, ref: string): Promise<BaseSelection | undefined> {
	const sha = await resolveCommit(repo.rootFsPath, ref).catch(() => undefined);
	if (!sha) {
		void vscode.window.showErrorMessage(`Branch Review Gutters: could not resolve "${ref}".`);
		return undefined;
	}
	if (await isAncestor(repo.rootFsPath, sha, 'HEAD').catch(() => false)) {
		// Already an ancestor: merge base and exact comparison are identical.
		return { kind: 'ref', ref };
	}
	const merge = {
		label: 'Use merge base with HEAD (recommended)',
		detail: `Shows only changes made on this branch since it diverged from ${ref}.`,
	};
	const exact = {
		label: `Compare exactly against ${ref}`,
		detail: `Also shows changes made on ${ref} since divergence.`,
	};
	const choice = await vscode.window.showQuickPick([merge, exact], {
		title: `How should ${ref} be used?`,
		placeHolder: 'Comparison mode',
	});
	if (!choice) {
		return undefined;
	}
	return choice === merge ? { kind: 'ref', ref } : { kind: 'exact', ref };
}

// ---------------------------------------------------------------- status menu

interface MenuItem extends vscode.QuickPickItem {
	run: () => Thenable<unknown>;
}

export async function showMenu(controller: Controller, repo: RepoInfo): Promise<void> {
	const state = controller.getState(repo);
	const baseline = controller.getBaseline(repo);
	const changeSet = controller.getChangeSet(repo);
	const selectionLabel =
		state.selection.kind === 'auto'
			? `auto${baseline?.baseRef ? ` → ${baseline.baseRef}` : ''}`
			: `${state.selection.ref}${state.selection.kind === 'exact' ? ' (exact)' : ''}`;

	const items: MenuItem[] = [
		state.enabled
			? {
					label: '$(circle-large-filled) Disable review gutters',
					run: () => vscode.commands.executeCommand('reviewGutters.disable'),
				}
			: {
					label: '$(circle-large-outline) Enable review gutters',
					run: () => vscode.commands.executeCommand('reviewGutters.enable'),
				},
		{
			label: '$(git-branch) Select base branch or commit…',
			description: selectionLabel,
			run: () => vscode.commands.executeCommand('reviewGutters.selectBase'),
		},
		{
			label: '$(search) Auto-detect base',
			description: baseline?.baseRef ? `currently ${baseline.baseRef}` : undefined,
			run: () => vscode.commands.executeCommand('reviewGutters.autoDetectBase'),
		},
		{
			label: '$(list-unordered) Show changed files…',
			description: changeSet
				? `${totalChanges(changeSet.counts)} files (${describeCounts(changeSet.counts)})`
				: undefined,
			run: () => vscode.commands.executeCommand('reviewGutters.showChangedFiles'),
		},
		{
			label: '$(refresh) Refresh',
			run: () => vscode.commands.executeCommand('reviewGutters.refresh'),
		},
	];
	if (state.selection.kind !== 'auto') {
		items.push({
			label: '$(clear-all) Clear base selection',
			run: () => vscode.commands.executeCommand('reviewGutters.clearBase'),
		});
	}
	items.push({
		label: '$(output) Show log',
		run: () => vscode.commands.executeCommand('reviewGutters.showLog'),
	});

	const picked = await vscode.window.showQuickPick(items, {
		title: `Branch Review Gutters — ${repo.rootFsPath.split(/[\\/]/).pop() ?? ''}`,
		placeHolder: baseline?.message ?? selectionLabel,
	});
	await picked?.run();
}

// -------------------------------------------------------------- changed files

const ICONS: Record<FileChange['kind'], string> = {
	added: 'diff-added',
	untracked: 'diff-added',
	modified: 'diff-modified',
	typeChanged: 'diff-modified',
	renamed: 'diff-renamed',
	deleted: 'diff-removed',
};

interface FileItem extends vscode.QuickPickItem {
	change: FileChange;
}

export function buildChangedFileItems(changes: readonly FileChange[]): FileItem[] {
	return changes.map((change) => ({
		label: `$(${ICONS[change.kind]}) ${basenamePosix(change.path)}`,
		description: dirnamePosix(change.path),
		detail: change.kind === 'renamed' && change.basePath ? `from ${change.basePath}` : undefined,
		change,
	}));
}

export async function showChangedFiles(controller: Controller, repo: RepoInfo): Promise<void> {
	const changeSet = controller.getChangeSet(repo);
	if (!changeSet) {
		void vscode.window.showInformationMessage(
			'Branch Review Gutters: no comparison is loaded for this repository yet.',
		);
		return;
	}
	const changes = changeSet.all();
	if (changes.length === 0) {
		void vscode.window.showInformationMessage('Branch Review Gutters: no files changed against the base.');
		return;
	}
	const picked = await vscode.window.showQuickPick(buildChangedFileItems(changes), {
		title: `Changed vs ${controller.getBaseline(repo)?.baseRef ?? 'base'} (${changes.length})`,
		matchOnDescription: true,
		placeHolder: 'Open a changed file',
	});
	if (!picked) {
		return;
	}
	await openChange(controller, repo, picked.change);
}

export async function openChange(controller: Controller, repo: RepoInfo, change: FileChange): Promise<void> {
	if (change.kind === 'deleted') {
		const baseCommit = controller.getBaseline(repo)?.baseCommit;
		if (!baseCommit) {
			return;
		}
		const uri = makeBaseUri(change.path, { repo: repo.rootFsPath, commit: baseCommit, base: change.path });
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc, { preview: true });
		return;
	}
	const uri = vscode.Uri.joinPath(repo.rootUri, ...change.path.split('/'));
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc, { preview: true });
}
