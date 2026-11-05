export type PageSite = 'etiquettes' | 'ajout' | 'supprimer' | 'scan';

function lire(): PageSite {
	const h = typeof location === 'undefined' ? '' : location.hash.replace('#', '');
	return h === 'ajout' || h === 'supprimer' || h === 'scan' ? h : 'etiquettes';
}

class Pages {
	courante = $state<PageSite>(lire());

	constructor() {
		if (typeof window === 'undefined') return;
		window.addEventListener('hashchange', () => (this.courante = lire()));
	}

	aller(p: PageSite) {
		location.hash = p === 'etiquettes' ? '' : p;
		this.courante = p;
	}
}

export const pages = new Pages();
