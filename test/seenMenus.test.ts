import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHANGE_STYLES } from '../src/changes/style';
import type { ChangeKind } from '../src/changes/parse';

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
const contextMenu: { command: string; when?: string; group?: string }[] =
	manifest.contributes.menus['view/item/context'];
const declaredCommands: { command: string }[] = manifest.contributes.commands;

const SEEN_SUFFIX = '~seen';
const UNSEEN_FILES = Object.keys(CHANGE_STYLES) as ChangeKind[];
const SEEN_FILES = UNSEEN_FILES.map((kind) => `${kind}${SEEN_SUFFIX}`);
const FOLDERS = ['dir', 'dir~partial', 'dir~seen'];

function entryFor(command: string): { command: string; when?: string } {
	const entry = contextMenu.find((e) => e.command === command && e.group !== undefined && !e.group.startsWith('inline'));
	assert.ok(entry, `package.json has no view/item/context entry for ${command}`);
	return entry;
}

function inlineEntryFor(command: string): { command: string; when?: string } {
	const entry = contextMenu.find((e) => e.command === command && e.group?.startsWith('inline'));
	assert.ok(entry, `package.json has no inline view/item/context entry for ${command}`);
	return entry;
}

/** The viewItem regex out of a when clause, as a matcher. */
function matcher(command: string): (contextValue: string) => boolean {
	const when = entryFor(command).when;
	assert.ok(when, `${command} has no when clause in view/item/context`);
	assert.match(when, /view == reviewGutters\.changedFiles/, `${command} is not scoped to the Changed Files view`);
	const m = /viewItem =~ \/(.*)\/([gimsuy]*)/.exec(when);
	assert.ok(m, `${command} has no viewItem regex: ${when}`);
	return (contextValue) => new RegExp(m[1], m[2]).test(contextValue);
}

function assertShows(command: string, values: readonly string[]): void {
	const shows = matcher(command);
	for (const value of values) {
		assert.equal(shows(value), true, `${command} should show for viewItem "${value}"`);
	}
}

function assertHides(command: string, values: readonly string[]): void {
	const shows = matcher(command);
	for (const value of values) {
		assert.equal(shows(value), false, `${command} should NOT show for viewItem "${value}"`);
	}
}

test('marking a file seen does not hide the menu entries it already had', () => {
	// The regression this guards: the clauses used to be anchored with a bare $,
	// so the ~seen suffix made every entry vanish the moment a file was marked.
	for (const command of ['reviewGutters.openBaseFromTree', 'reviewGutters.compareFromTree']) {
		const hasBase = ['modified', 'typeChanged', 'renamed'];
		assertShows(command, hasBase.map((k) => `${k}${SEEN_SUFFIX}`));
		assertShows(command, hasBase);
	}
	assertShows('reviewGutters.copyTreePath', UNSEEN_FILES.filter((k) => k !== 'deleted'));
	assertShows(
		'reviewGutters.copyTreePath',
		UNSEEN_FILES.filter((k) => k !== 'deleted').map((k) => `${k}${SEEN_SUFFIX}`),
	);
});

test('markSeen offers itself for every unseen file kind and nothing else', () => {
	assertShows('reviewGutters.markSeen', UNSEEN_FILES);
	assertHides('reviewGutters.markSeen', SEEN_FILES);
	assertHides('reviewGutters.markSeen', FOLDERS);
	assertHides('reviewGutters.markSeen', ['repo']);
});

test('a deletion can be marked seen too', () => {
	assertShows('reviewGutters.markSeen', ['deleted']);
	assertShows('reviewGutters.markUnseen', ['deleted~seen']);
});

test('markUnseen offers itself for seen files only', () => {
	assertShows('reviewGutters.markUnseen', SEEN_FILES);
	assertHides('reviewGutters.markUnseen', UNSEEN_FILES);
	assertHides('reviewGutters.markUnseen', FOLDERS);
});

test('markFolderSeen covers an untouched or half-seen folder, never a finished one', () => {
	assertShows('reviewGutters.markFolderSeen', ['dir', 'dir~partial']);
	assertHides('reviewGutters.markFolderSeen', ['dir~seen']);
	assertHides('reviewGutters.markFolderSeen', UNSEEN_FILES);
	assertHides('reviewGutters.markFolderSeen', SEEN_FILES);
});

test('markFolderUnseen covers a finished or half-seen folder, never an untouched one', () => {
	assertShows('reviewGutters.markFolderUnseen', ['dir~seen', 'dir~partial']);
	assertHides('reviewGutters.markFolderUnseen', ['dir']);
	assertHides('reviewGutters.markFolderUnseen', UNSEEN_FILES);
});

test('a row never offers a file mark command and a folder mark command together', () => {
	const rows = [...UNSEEN_FILES, ...SEEN_FILES, ...FOLDERS, 'repo'];
	const fileCommands = ['reviewGutters.markSeen', 'reviewGutters.markUnseen'];
	const folderCommands = ['reviewGutters.markFolderSeen', 'reviewGutters.markFolderUnseen'];
	for (const row of rows) {
		const onFile = fileCommands.filter((c) => matcher(c)(row));
		const onFolder = folderCommands.filter((c) => matcher(c)(row));
		assert.equal(
			onFile.length === 0 || onFolder.length === 0,
			true,
			`"${row}" offers both ${onFile} and ${onFolder}`,
		);
	}
});

test('markSeen and markUnseen are mutually exclusive, a folder is not', () => {
	// A half-seen folder legitimately offers both directions: finish it off,
	// or clear what was marked. A file has only one of the two to offer.
	for (const row of [...UNSEEN_FILES, ...SEEN_FILES, ...FOLDERS, 'repo']) {
		const fileMarks = ['reviewGutters.markSeen', 'reviewGutters.markUnseen'].filter((c) => matcher(c)(row));
		assert.ok(fileMarks.length <= 1, `"${row}" offers ${fileMarks}`);
	}
	assert.equal(
		['reviewGutters.markFolderSeen', 'reviewGutters.markFolderUnseen'].filter((c) => matcher(c)('dir~partial'))
			.length,
		2,
	);
});

test('every command used in the tree context menu is declared', () => {
	const declared = new Set(declaredCommands.map((c) => c.command));
	for (const entry of contextMenu) {
		assert.ok(declared.has(entry.command), `${entry.command} is used in a menu but never declared`);
	}
});

test('the seen commands are hidden from the command palette', () => {
	const palette: { command: string; when?: string }[] = manifest.contributes.menus.commandPalette;
	for (const command of [
		'reviewGutters.markSeen',
		'reviewGutters.markUnseen',
		'reviewGutters.markFolderSeen',
		'reviewGutters.markFolderUnseen',
	]) {
		const entry = palette.find((e) => e.command === command);
		assert.ok(entry, `${command} is missing from commandPalette`);
		assert.equal(entry.when, 'false', `${command} should not appear in the command palette`);
	}
});

test('markSeenOnOpen is declared and defaults off', () => {
	const prop = manifest.contributes.configuration.properties['reviewGutters.markSeenOnOpen'];
	assert.ok(prop, 'reviewGutters.markSeenOnOpen is not declared');
	assert.equal(prop.type, 'boolean');
	assert.equal(prop.default, false);
});

test('every mark command is offered inline, on the same rows as in the menu', () => {
	// The row action is what replaced the checkbox, so a mark command that is
	// only in the context menu has no visible affordance at all. The two copies
	// share a when clause, so a row can never offer one and not the other.
	for (const command of [
		'reviewGutters.markSeen',
		'reviewGutters.markUnseen',
		'reviewGutters.markFolderSeen',
		'reviewGutters.markFolderUnseen',
	]) {
		assert.equal(inlineEntryFor(command).when, entryFor(command).when, `${command} inline/menu when clauses differ`);
	}
});

test('every mark command has an icon, or its inline action would be invisible', () => {
	for (const command of [
		'reviewGutters.markSeen',
		'reviewGutters.markUnseen',
		'reviewGutters.markFolderSeen',
		'reviewGutters.markFolderUnseen',
	]) {
		const declared = manifest.contributes.commands.find((c: { command: string }) => c.command === command);
		assert.match(declared.icon ?? '', /^\$\([a-z-]+\)$/, `${command} needs a codicon for its inline action`);
	}
});
