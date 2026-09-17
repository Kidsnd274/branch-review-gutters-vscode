import * as vscode from 'vscode';
import { RepositoryService } from './git/repositories';
import { StateStore } from './baseline/state';
import { Controller } from './controller';
import { registerCommands } from './commands';
import * as log from './util/log';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	log.initLog(context);
	log.info('Branch Review Gutters activating');

	const repositories = new RepositoryService();
	context.subscriptions.push(repositories);
	await repositories.initialize();

	const store = new StateStore(context.workspaceState);
	const controller = new Controller(repositories, store);
	context.subscriptions.push(controller);

	registerCommands(context, controller);
	await controller.initialize();

	log.info(`activated with ${repositories.repositories.length} repositories`);
}

export function deactivate(): void {
	// Everything is registered on the extension context's subscriptions.
}
