import * as vscode from 'vscode';
import type { Controller } from './controller';
import type { RepoInfo } from './git/repositories';
import { openChange, pickBase, showChangedFiles, showMenu } from './ui/pickers';
import { basenamePosix } from './util/paths';
import { neighbourIndex } from './util/navigation';
import * as log from './util/log';

function requireRepository(controller: Controller): RepoInfo | undefined {
	const repo = controller.activeRepository();
	if (!repo) {
		void vscode.window.showInformationMessage('Branch Review Gutters: no git repository in this window.');
		return undefined;
	}
	return repo;
}

export function registerCommands(ctx: vscode.ExtensionContext, controller: Controller): void {
	const register = (id: string, handler: (...args: unknown[]) => unknown) => {
		ctx.subscriptions.push(vscode.commands.registerCommand(id, handler));
	};

	register('reviewGutters.toggle', async () => {
		const repo = requireRepository(controller);
		if (!repo) {
			return;
		}
		const enabled = !controller.getState(repo).enabled;
		await controller.setEnabled(repo, enabled);
		if (enabled && controller.getBaseline(repo)?.status === 'noBase') {
			await vscode.commands.executeCommand('reviewGutters.selectBase');
		}
	});

	register('reviewGutters.enable', async () => {
		const repo = requireRepository(controller);
		if (!repo) {
			return;
		}
		await controller.setEnabled(repo, true);
		if (controller.getBaseline(repo)?.status === 'noBase') {
			await vscode.commands.executeCommand('reviewGutters.selectBase');
		}
	});

	register('reviewGutters.disable', async () => {
		const repo = requireRepository(controller);
		if (repo) {
			await controller.setEnabled(repo, false);
		}
	});

	register('reviewGutters.selectBase', async () => {
		const repo = requireRepository(controller);
		if (!repo) {
			return;
		}
		const selection = await pickBase(controller, repo);
		if (!selection) {
			return;
		}
		if (!controller.getState(repo).enabled) {
			await controller.setEnabled(repo, true);
		}
		await controller.setSelection(repo, selection);
		const baseline = controller.getBaseline(repo);
		if (baseline?.baseCommit) {
			void vscode.window.showInformationMessage(
				`Branch Review Gutters: base ${baseline.baseRef}, comparing against ${baseline.baseCommit.slice(0, 7)}.`,
			);
		}
	});

	register('reviewGutters.autoDetectBase', async () => {
		const repo = requireRepository(controller);
		if (!repo) {
			return;
		}
		await controller.setSelection(repo, { kind: 'auto' });
		const baseline = controller.getBaseline(repo);
		if (baseline?.baseRef && baseline.baseCommit) {
			void vscode.window.showInformationMessage(
				`Branch Review Gutters: base ${baseline.baseRef}, merge base ${baseline.baseCommit.slice(0, 7)}.`,
			);
		} else {
			void vscode.window.showWarningMessage(
				`Branch Review Gutters: ${baseline?.message ?? 'could not detect a base branch.'}`,
			);
		}
	});

	register('reviewGutters.clearBase', async () => {
		const repo = requireRepository(controller);
		if (repo) {
			await controller.setSelection(repo, { kind: 'auto' });
		}
	});

	register('reviewGutters.refresh', async () => {
		const repo = requireRepository(controller);
		if (!repo) {
			return;
		}
		controller.content.invalidate();
		await controller.refresh(repo, 'manual refresh');
	});

	register('reviewGutters.showMenu', async () => {
		const repo = requireRepository(controller);
		if (repo) {
			await showMenu(controller, repo);
		}
	});

	register('reviewGutters.showChangedFiles', async () => {
		const repo = requireRepository(controller);
		if (repo) {
			await showChangedFiles(controller, repo);
		}
	});

	const jumpFile = async (delta: 1 | -1) => {
		const repo = requireRepository(controller);
		if (!repo) {
			return;
		}
		const changeSet = controller.getChangeSet(repo);
		if (!changeSet) {
			void vscode.window.showInformationMessage('Branch Review Gutters: no comparison is loaded yet.');
			return;
		}
		const changes = changeSet.all();
		if (changes.length === 0) {
			void vscode.window.showInformationMessage('Branch Review Gutters: no files changed against the base.');
			return;
		}
		const activeUri = vscode.window.activeTextEditor?.document.uri;
		const current = activeUri ? controller.relativePath(repo, activeUri) : undefined;
		const index = neighbourIndex(
			changes.map((c) => c.path),
			current,
			delta,
		);
		if (index >= 0) {
			await openChange(controller, repo, changes[index]);
		}
	};
	register('reviewGutters.nextChangedFile', () => jumpFile(1));
	register('reviewGutters.previousChangedFile', () => jumpFile(-1));

	// Quick Diff gives us in-file navigation; we only relabel it.
	register('reviewGutters.nextChange', () => vscode.commands.executeCommand('editor.action.dirtydiff.next'));
	register('reviewGutters.previousChange', () =>
		vscode.commands.executeCommand('editor.action.dirtydiff.previous'),
	);

	const currentBaseUri = async (): Promise<
		{ repo: RepoInfo; fileUri: vscode.Uri; baseUri: vscode.Uri } | undefined
	> => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.scheme !== 'file') {
			void vscode.window.showInformationMessage('Branch Review Gutters: open a file in the repository first.');
			return undefined;
		}
		const repo = controller.getRepositoryFor(editor.document.uri);
		if (!repo) {
			void vscode.window.showInformationMessage('Branch Review Gutters: this file is not in a git repository.');
			return undefined;
		}
		const baseUri = await controller.baseUriFor(repo, editor.document.uri);
		if (!baseUri) {
			void vscode.window.showInformationMessage(
				'Branch Review Gutters: no base version is available for this file.',
			);
			return undefined;
		}
		return { repo, fileUri: editor.document.uri, baseUri };
	};

	register('reviewGutters.openBaseVersion', async () => {
		const target = await currentBaseUri();
		if (!target) {
			return;
		}
		const doc = await vscode.workspace.openTextDocument(target.baseUri);
		await vscode.window.showTextDocument(doc, { preview: true });
	});

	register('reviewGutters.compareWithBase', async () => {
		const target = await currentBaseUri();
		if (!target) {
			return;
		}
		const rel = controller.relativePath(target.repo, target.fileUri) ?? target.fileUri.fsPath;
		await vscode.commands.executeCommand(
			'vscode.diff',
			target.baseUri,
			target.fileUri,
			`${basenamePosix(rel)} (base ↔ working tree)`,
		);
	});

	register('reviewGutters.showLog', () => {
		log.showLog();
	});
}
