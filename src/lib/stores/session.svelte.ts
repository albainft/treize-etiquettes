import { connecte, ecouterConnexion, lireIdentite, type Identite } from '../treize';

/** Etat de connexion partage par toutes les pages du site. */
class Session {
	connecte = $state(false);
	identite = $state<Identite | null>(null);
	erreur = $state('');

	constructor() {
		ecouterConnexion((etat) => {
			this.connecte = etat && connecte();
			if (!etat) {
				this.identite = null;
				return;
			}
			this.erreur = '';
			lireIdentite()
				.then((i) => (this.identite = i))
				.catch((e: Error) => (this.erreur = e.message));
		});
	}

	/** Niveau de l'utilisateur : 0 tant que l'identite n'est pas connue. */
	get niveau(): number {
		return this.identite?.niveau ?? 0;
	}
}

export const session = new Session();
