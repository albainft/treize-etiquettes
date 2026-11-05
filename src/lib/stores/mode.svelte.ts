/** Which UI is shown: the quick one-screen label maker, or the full studio. */
export type AppMode = 'quick' | 'studio' | 'lot';

const KEY = 'katasymbol-web:mode';
/** "Phone": a small screen held upright. */
const PHONE_QUERY = '(max-width: 640px) and (orientation: portrait)';

function readChoice(): AppMode | null {
	try {
		const v = sessionStorage.getItem(KEY);
		return v === 'quick' || v === 'studio' ? v : null;
	} catch {
		return null;
	}
}

class ModeStore {
	mode = $state<AppMode>('lot');
	/** The Quick label / Full studio chooser is showing. */
	choosing = $state(false);

	constructor() {
		if (typeof window === 'undefined') return;
		const params = new URLSearchParams(location.search);
		if (params.has('lot')) this.mode = 'lot';
		else if (params.has('quick')) this.mode = 'quick';
		else if (params.has('studio')) this.mode = 'studio';
		// Le mode Lot est le mode par defaut, y compris sur telephone (plus de question Quick / Studio).
	}

	choose(mode: AppMode) {
		this.mode = mode;
		this.choosing = false;
		try {
			sessionStorage.setItem(KEY, mode);
		} catch {
			// Storage unavailable; the choice just won't survive a reload.
		}
	}
}

export const mode = new ModeStore();
