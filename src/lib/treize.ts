/** Acces a l'application arriere TREIZE depuis le site (connexion Google, appels d'actions). */
import type { Donnees } from './design/lot';

const CLIENT_ID = '841663594728-h4it68rr6h3rj6nd3jj59lavh906kl83.apps.googleusercontent.com';
const URL_ARRIERE =
	'https://script.google.com/macros/s/AKfycbyZ_4Nn10m-XuAJpWnq_3He8Rk9CQA_gJXcElHQt_l3HJU5ixsUNl2NF5XO0OLe5VMWtw/exec';

/** Messages par code de refus de l'arriere. Un code inconnu est affiche tel quel. */
export const MESSAGES: Record<string, string> = {
	ACCES_REFUSE: "Accès refusé : ce compte Google n'a pas accès, ou la connexion a expiré. Reconnecte-toi.",
	NIVEAU_INSUFFISANT: "Ce compte n'a pas le droit de faire cette action.",
	OCCUPE: 'Une autre action est en cours. Réessaie dans un instant.',
	ERREUR_TECHNIQUE: 'Problème technique côté application. Réessaie ; si cela continue, préviens le responsable.',
	TROP_D_AJOUTS: "Trop d'ajouts en une heure. Fais une pause ou préviens le responsable.",
	VALIDATION: 'Vérifie les champs signalés en rouge.',
	ID_INVALIDE: 'Identifiant invalide.',
	INTROUVABLE: 'Aucune pièce avec cet identifiant.',
	AMBIGU: 'Plusieurs lignes portent cet identifiant : ne pas supprimer ici, prévenir le propriétaire.',
	VENDU: 'Pièce vendue : suppression impossible.',
	DANS_PANIER: 'Pièce dans le panier de la caisse : suppression impossible.',
	DANS_VENTE: 'Pièce citée dans une vente : suppression impossible.',
	CODE_INVALIDE: 'Code illisible.',
	SCAN_QR_COLONNES: 'La feuille de scan est incomplète : préviens le responsable.',
	PANIER_CHANGE: 'Le panier a changé entre-temps. Vérifie-le puis valide à nouveau.',
	PANIER_VIDE: 'Le panier est vide.',
	NON_VENDABLE: "Une pièce n'est plus vendable :",
	PRIX: 'Prix à vérifier.',
	PAIEMENT: 'Choisis un moyen de paiement.',
	VENTE_INTROUVABLE: 'Vente introuvable.'
};

export class ErreurTreize extends Error {
	code: string;
	reponse: Record<string, unknown>;
	constructor(code: string, message: string, reponse: Record<string, unknown> = {}) {
		super(message);
		this.code = code;
		this.reponse = reponse;
	}
}

interface GoogleId {
	accounts: {
		id: {
			initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; auto_select?: boolean }): void;
			renderButton(el: HTMLElement, o: Record<string, string>): void;
			prompt?(): void;
		};
	};
}

const CLE_STOCKAGE = 'treize:jeton';
let jeton = '';
let expire = 0;
let initialise = false;

function garder(j: string) {
	try {
		sessionStorage.setItem(CLE_STOCKAGE, j);
	} catch {
		// stockage indisponible : la connexion reste en memoire
	}
}
function oublier() {
	try {
		sessionStorage.removeItem(CLE_STOCKAGE);
	} catch {
		// rien a faire
	}
}
const ecouteurs = new Set<(connecte: boolean) => void>();

/** Appele a chaque changement d'etat de connexion (connexion reussie, expiration, refus). */
export function ecouterConnexion(f: (connecte: boolean) => void): () => void {
	ecouteurs.add(f);
	return () => ecouteurs.delete(f);
}
function notifier(etat: boolean) {
	for (const f of ecouteurs) f(etat);
}

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

// Rechargement de la page : on reprend le jeton de la session tant qu'il n'a pas expire.
try {
	const garde = sessionStorage.getItem(CLE_STOCKAGE);
	if (garde) {
		const exp = expirationDe(garde);
		if (Date.now() < exp - 30_000) {
			jeton = garde;
			expire = exp;
		} else oublier();
	}
} catch {
	// stockage indisponible
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
		s.onerror = () => reject(new Error("Le service de connexion Google n'a pas pu être chargé."));
		document.head.appendChild(s);
	});
}

/** Affiche le bouton Google dans `el`. La connexion est signalee par ecouterConnexion. */
export async function afficherConnexion(el: HTMLElement): Promise<void> {
	const g = await chargerGoogle();
	if (!initialise) {
		g.accounts.id.initialize({
			client_id: CLIENT_ID,
			auto_select: true,
			callback: (r) => {
				if (!r.credential) return;
				jeton = r.credential;
				expire = expirationDe(jeton);
				garder(jeton);
				notifier(true);
			}
		});
		initialise = true;
	}
	g.accounts.id.renderButton(el, { theme: 'outline', size: 'medium', locale: 'fr' });
	// Connexion automatique si la session Google du navigateur est deja ouverte et deja autorisee.
	g.accounts.id.prompt?.();
}

/** Appelle une action de l'arriere. Leve ErreurTreize si le reseau ou l'arriere refuse. */
export async function appeler<T = Record<string, unknown>>(action: string, args: unknown[] = []): Promise<T> {
	if (!connecte()) {
		oublier();
		notifier(false);
		throw new ErreurTreize('ACCES_REFUSE', MESSAGES.ACCES_REFUSE);
	}
	let r: Response;
	try {
		r = await fetch(URL_ARRIERE, {
			method: 'POST',
			// text/plain : requete simple, pas de pre-verification CORS
			headers: { 'Content-Type': 'text/plain;charset=utf-8' },
			body: JSON.stringify({ jeton, action, args })
		});
	} catch {
		throw new ErreurTreize('RESEAU', "Connexion perdue. Réessaie : une pièce déjà envoyée ne sera pas ajoutée deux fois.");
	}
	let corps: { ok?: boolean; code?: string } & Record<string, unknown>;
	try {
		corps = await r.json();
	} catch {
		throw new ErreurTreize('REPONSE', "Réponse illisible de l'application arrière.");
	}
	if (corps.ok !== true) {
		const code = corps.code ?? 'ERREUR_TECHNIQUE';
		if (code === 'ACCES_REFUSE') {
			jeton = '';
			expire = 0;
			oublier();
			notifier(false);
		}
		throw new ErreurTreize(code, MESSAGES[code] ?? 'Refus : ' + code, corps);
	}
	return corps as unknown as T;
}

export interface Identite {
	prenom: string;
	role: string;
	niveau: number;
}

export async function lireIdentite(): Promise<Identite> {
	const r = await appeler<Identite>('identite');
	return { prenom: r.prenom, role: r.role, niveau: r.niveau };
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
