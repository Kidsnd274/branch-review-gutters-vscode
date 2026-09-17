/** Trailing-edge debounce. `cancel` clears a pending call; `flush` runs it now. */
export interface Debounced {
	(): void;
	cancel(): void;
	flush(): void;
}

export function debounce(fn: () => void, waitMs: number): Debounced {
	let timer: NodeJS.Timeout | undefined;
	const run = () => {
		timer = undefined;
		fn();
	};
	const debounced = (() => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(run, waitMs);
	}) as Debounced;
	debounced.cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
	};
	debounced.flush = () => {
		if (timer) {
			clearTimeout(timer);
			run();
		}
	};
	return debounced;
}
