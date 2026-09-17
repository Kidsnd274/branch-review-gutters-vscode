/** Pure path helpers. No vscode/node imports so these are unit-testable. */

const SEP = /[\\/]+/;

function split(p: string): string[] {
	return p.split(SEP).filter((s) => s.length > 0);
}

/**
 * Repo-relative POSIX path of `fsPath` inside `root`, or `undefined` when
 * `fsPath` is not inside `root`. `caseInsensitive` should be true on macOS and
 * Windows.
 */
export function posixRelative(root: string, fsPath: string, caseInsensitive: boolean): string | undefined {
	const rootParts = split(root);
	const parts = split(fsPath);
	if (parts.length < rootParts.length) {
		return undefined;
	}
	const norm = (s: string) => (caseInsensitive ? s.toLowerCase() : s);
	for (let i = 0; i < rootParts.length; i++) {
		if (norm(rootParts[i]) !== norm(parts[i])) {
			return undefined;
		}
	}
	// A path equal to the root is the root itself, not a file in it.
	if (parts.length === rootParts.length) {
		return undefined;
	}
	return parts.slice(rootParts.length).join('/');
}

export function isInside(root: string, fsPath: string, caseInsensitive: boolean): boolean {
	return posixRelative(root, fsPath, caseInsensitive) !== undefined;
}

/** True for paths inside the repository's `.git` directory. */
export function isDotGitPath(relPath: string): boolean {
	return relPath === '.git' || relPath.startsWith('.git/');
}

export function dirnamePosix(relPath: string): string {
	const i = relPath.lastIndexOf('/');
	return i === -1 ? '' : relPath.slice(0, i);
}

export function basenamePosix(relPath: string): string {
	const i = relPath.lastIndexOf('/');
	return i === -1 ? relPath : relPath.slice(i + 1);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

/**
 * Converts a repo-relative glob to a RegExp. Supports `*`, `**`, `?` and
 * `{a,b}`. A pattern with no slash matches the basename at any depth, which is
 * what users expect from entries like `*.lock`.
 */
export function globToRegExp(glob: string): RegExp {
	const anchoredToPath = glob.includes('/');
	let out = '';
	let i = 0;
	while (i < glob.length) {
		const ch = glob[i];
		if (ch === '*') {
			if (glob[i + 1] === '*') {
				// `**/` may match zero directories; a bare `**` matches anything.
				if (glob[i + 2] === '/') {
					out += '(?:.*/)?';
					i += 3;
					continue;
				}
				out += '.*';
				i += 2;
				continue;
			}
			out += '[^/]*';
			i += 1;
			continue;
		}
		if (ch === '?') {
			out += '[^/]';
			i += 1;
			continue;
		}
		if (ch === '{') {
			const end = glob.indexOf('}', i);
			if (end !== -1) {
				const alts = glob.slice(i + 1, end).split(',');
				out += `(?:${alts.map((a) => escapeRegExp(a).replace(/\*/g, '[^/]*')).join('|')})`;
				i = end + 1;
				continue;
			}
		}
		out += escapeRegExp(ch);
		i += 1;
	}
	const body = anchoredToPath ? out : `(?:.*/)?${out}`;
	return new RegExp(`^${body}$`);
}

export function makeGlobMatcher(globs: readonly string[]): (relPath: string) => boolean {
	const patterns = globs
		.filter((g) => typeof g === 'string' && g.trim().length > 0)
		.map((g) => {
			try {
				return globToRegExp(g.trim());
			} catch {
				return undefined;
			}
		})
		.filter((r): r is RegExp => r !== undefined);
	if (patterns.length === 0) {
		return () => false;
	}
	return (relPath: string) => patterns.some((r) => r.test(relPath));
}
