/** Pure navigation helper for next/previous changed file. No vscode imports. */

/**
 * Index of the next (`delta = 1`) or previous (`delta = -1`) entry in a sorted
 * path list, relative to `current`. Wraps. When `current` is not itself in the
 * list, moves to the nearest entry in the requested direction.
 */
export function neighbourIndex(paths: readonly string[], current: string | undefined, delta: 1 | -1): number {
	if (paths.length === 0) {
		return -1;
	}
	if (!current) {
		return delta === 1 ? 0 : paths.length - 1;
	}
	const at = paths.indexOf(current);
	if (at === -1) {
		const after = paths.findIndex((p) => p > current);
		if (delta === 1) {
			return after === -1 ? 0 : after;
		}
		return after === -1 ? paths.length - 1 : (after - 1 + paths.length) % paths.length;
	}
	return (at + delta + paths.length) % paths.length;
}
