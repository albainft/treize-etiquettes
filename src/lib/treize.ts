/** Acces a l'application arriere TREIZE depuis le site (connexion Google, lecture des pieces). */
import type { Donnees } from './design/lot';

const CLIENT_ID = '841663594728-h4it68rr6h3rj6nd3jj59lavh906kl83.apps.googleusercontent.com';
const URL_ARRIERE =
	'https://script.google.com/macros/s/AKfycbyZ_4Nn10m-XuAJpWnq_3He8Rk9CQA_gJXcElHQt_l3HJU5ixsUNl2NF5XO0OLe5VMWtw/exec';

const MESSAGES: Record<string, string> = {
	ACCES_REFUSE: 'Acces refuse : ce compte Google n\'a pas acces, ou la connexion a expire. Reconnecte-toi.',
	NIVEAU_INSUFFISANT: 'Ce compte n\'a pas le droit de lire la liste des pieces.',
	OCCUPE: 'Une autre action est en cours. Reessaie dans un instant.',
	ERREUR_TECHNIQUE: 'Erreur technique cote application arriere.'
};

interface GoogleId {
	accounts: {
		id: {
			initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; auto_select?: boolean }): void;
			renderButton(el: HTMLElement, o: Record<string, string>): void;
		};
	};
}

let jeton = '';
let expire = 0;

/** Lit la date d'expiration du jeton (confort d'affichage : le controle reel est cote arriere). */
function expirationDe(j: string): number {
	try {
		const p = JSON.parse(atob(j.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
		return typeof p.exp === 'number' ? p.exp * 1000 : 0;
	} catch {
		return 0;
	}
}

export function connecte(): boolean {
	return !!jeton && Date.now() < expire - 30_000;
}

function chargerGoogle(): Promise<GoogleId> {
	const g = (window as unknown as { google?: GoogleId }).google;
	if (g?.accounts?.id) return Promise.resolve(g);
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = 'https://accounts.google.com/gsi/client';
		s.async = true;
		s.onload = () => {
			const g2 = (window as unknown as { google?: GoogleId }).google;
			if (g2?.accounts?.id) resolve(g2);
			else reject(new Error('Service Google indisponible.'));
		};
		s.onerror = () => reject(new Error('Le service de connexion Google n\'a pas pu etre charge.'));
		document.head.appendChild(s);
	});
}

/** Affiche le bouton Google dans `el`. `apres` est appele quand la connexion reussit. */
export async function afficherConnexion(el: HTMLElement, apres: () => void): Promise<void> {
	const g = await chargerGoogle();
	g.accounts.id.initialize({
		client_id: CLIENT_ID,
		auto_select: false,
		callback: (r) => {
			if (!r.credential) return;
			jeton = r.credential;
			expire = expirationDe(jeton);
			apres();
		}
	});
	g.accounts.id.renderButton(el, { theme: 'outline', size: 'medium', locale: 'fr' });
}

async function appeler<T>(action: string, args: unknown[] = []): Promise<T> {
	if (!connecte()) throw new Error('Connecte-toi avec Google.');
	let r: Response;
	try {
		r = await fetch(URL_ARRIERE, {
			method: 'POST',
			// text/plain : requete simple, pas de pre-verification CORS
			headers: { 'Content-Type': 'text/plain;charset=utf-8' },
			body: JSON.stringify({ jeton, action, args })
		});
	} catch {
		throw new Error('Pas de reponse de l\'application arriere (reseau ou appel bloque).');
	}
	let corps: { ok?: boolean; code?: string } & Record<string, unknown>;
	try {
		corps = await r.json();
	} catch {
		throw new Error('Reponse illisible de l\'application arriere.');
	}
	if (corps.ok !== true) {
		if (corps.code === 'ACCES_REFUSE') {
			jeton = '';
			expire = 0;
		}
		throw new Error(MESSAGES[corps.code ?? ''] ?? 'Refus : ' + corps.code);
	}
	return corps as unknown as T;
}

interface PieceListee {
	id: string;
	statut: string;
	onglet: string;
}

/** Liste des pieces : ID, statut, onglet. Pas de prix ni de description. */
export async function chargerPieces(): Promise<{ donnees: Donnees; tronque: boolean }> {
	const r = await appeler<{ pieces: PieceListee[]; tronque?: boolean }>('etiquettesListe');
	const lignes = r.pieces.map((p) => ({ ID: p.id, STATUT: p.statut, ONGLET: p.onglet }));
	return { donnees: { entetes: ['ID', 'STATUT', 'ONGLET'], lignes }, tronque: !!r.tronque };
}
