import * as vscode from 'vscode';
import type { Controller } from '../controller';
import type { RepoInfo } from '../git/repositories';
import type { BaseSelection } from '../baseline/resolver';
import { headUpstream, isAncestor, listRefs, resolveCommit, type RefEntry } from '../git/refs';
import { isValidRef } from '../git/args';
import { makeBaseUri } from '../content/baseContentProvider';
import { describeCounts, totalChanges, type FileChange } from '../changes/parse';
import * as log from '../util/log';

interface RefItem extends vscode.QuickPickItem {
	ref?: string;
	manual?: boolean;
}

function sectionItems(refs: RefEntry[], kind: RefEntry['kind'], title: string, exclude?: string): RefItem[] {
	// The current branch and its upstream are never useful bases: comparing
	// against either yields nothing but uncommitted changes.
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
	const upstream = await headUpstream(repo.rootFsPath).catch(() => undefined);
	const items: RefItem[] = [
		...sectionItems(refs, 'head', 'Local branches', currentBranch),
		...sectionItems(refs, 'remote', 'Remote branches', upstream),
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
	return pickMode(repo, ref, picked.manual === true);
}

/**
 * Auto-detection as a menu: the configured candidates ranked by fork point,
 * the recommended one first. Taking the recommendation keeps the selection on
 * `auto`, so it keeps re-ranking on every refresh; taking another pins it.
 */
export async function pickAutoCandidate(controller: Controller, repo: RepoInfo): Promise<BaseSelection | undefined> {
	const ranked = await controller.rankAutoCandidates(repo).catch((err) => {
		log.error('could not rank base candidates', err);
		return [];
	});
	if (ranked.length === 0) {
		void vscode.window.showWarningMessage(
			'Branch Review Gutters: none of the configured base branches exist here. Check `reviewGutters.baseBranches` or pick a base manually.',
		);
		return undefined;
	}
	interface CandidateItem extends vscode.QuickPickItem {
		selection: BaseSelection;
	}
	const items: CandidateItem[] = ranked.map((c, index) => ({
		label: `${index === 0 ? '$(star-full) ' : ''}${c.ref}`,
		description:
			c.ahead === 0
				? `already contains HEAD  ·  fork point ${c.mergeBase.slice(0, 7)}`
				: `${c.ahead} commit${c.ahead === 1 ? '' : 's'} ahead  ·  fork point ${c.mergeBase.slice(0, 7)}`,
		detail: index === 0 ? 'Recommended: HEAD forked from this most recently. Stays on auto-detect.' : undefined,
		selection: index === 0 ? { kind: 'auto' } : { kind: 'ref', ref: c.ref },
	}));
	const picked = await vscode.window.showQuickPick(items, {
		title: 'Auto-detected base branches',
		placeHolder: 'Fewest commits ahead means the closest fork point',
		matchOnDescription: true,
	});
	return picked?.selection;
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

/**
 * Merge base or exact comparison. Skipped when the two are equivalent; a
 * typed commit that is an ancestor of HEAD asks instead whether the commit
 * itself belongs to the review.
 */
async function pickMode(repo: RepoInfo, ref: string, typed: boolean): Promise<BaseSelection | undefined> {
	const sha = await resolveCommit(repo.rootFsPath, ref).catch(() => undefined);
	if (!sha) {
		void vscode.window.showErrorMessage(`Branch Review Gutters: could not resolve "${ref}".`);
		return undefined;
	}
	if (await isAncestor(repo.rootFsPath, sha, 'HEAD').catch(() => false)) {
		// Already an ancestor: merge base and exact comparison are identical.
		if (!typed || (await isAncestor(repo.rootFsPath, 'HEAD', sha).catch(() => false))) {
			return { kind: 'ref', ref };
		}
		return pickInclusion(ref);
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

/**
 * A pasted sha is ambiguous: the commit the branch was cut *from* (excluded,
 * like a merge request diff) or the branch's *first* commit (which then has
 * to be included). `<ref>^` is a plain revision expression, so the second
 * choice needs no new selection kind.
 */
async function pickInclusion(ref: string): Promise<BaseSelection | undefined> {
	const after = {
		label: `Changes after ${ref} (recommended)`,
		detail: 'Use when this is the commit the branch was created from. Matches a merge request diff.',
	};
	const including = {
		label: `Changes from ${ref} onwards`,
		detail: `Use when this is the first commit of the branch. Compares against its parent, ${ref}^.`,
	};
	const choice = await vscode.window.showQuickPick([after, including], {
		title: `Is ${ref} part of this review?`,
		placeHolder: 'The commit is an ancestor of HEAD',
	});
	if (!choice) {
		return undefined;
	}
	return { kind: 'ref', ref: choice === after ? ref : `${ref}^` };
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

/**
 * Opens a change from the picker or the tree. A deleted file has nothing on
 * disk, so it opens its base version instead of a missing path.
 */
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
