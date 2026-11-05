<script lang="ts">
	import { appeler } from '../treize';
	import { session } from '../stores/session.svelte';
	import ConnexionTreize from './ConnexionTreize.svelte';
	import ScanCamera from './ScanCamera.svelte';

	// Bloc B de la caisse : scan par camera et panier. La validation de la vente reste dans l'ancienne page Caisse.
	interface Ligne {
		id: string;
		description: string;
		prix: number;
		prixBoutique: number;
	}
	interface Resultat {
		code: string;
		resultat: string;
		message: string;
		description: string;
	}
	interface Etat {
		panier: Ligne[];
		panierMax: number;
		resultats?: Resultat[];
		scanne?: string;
	}

	const FORMAT_ID = /^(FRI|BRO)-[A-Z0-9]+(-[A-Z0-9]+)?-\d{4}$/;
	const DELAI_MEME_CODE = 4000;

	let panier = $state<Ligne[]>([]);
	let panierMax = $state(0);
	let derniers = $state<Resultat[]>([]);
	let message = $state('');
	let erreur = $state(false);
	let occupe = $state(false);
	let videArme = $state(false);
	let dernierCode = '';
	let dernierInstant = 0;
	let demarre = false;
	let minuteurVide: ReturnType<typeof setTimeout> | null = null;

	const total = $derived(panier.reduce((s, l) => s + (Number.isFinite(l.prix) ? l.prix : 0), 0));
	const euros = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

	function appliquer(e: Etat) {
		panier = e.panier ?? [];
		panierMax = e.panierMax ?? panierMax;
	}
	function dire(t: string, ko = false) {
		message = t;
		erreur = ko;
	}

	async function action(nom: string, args: unknown[] = []): Promise<Etat | null> {
		occupe = true;
		try {
			const e = await appeler<Etat>(nom, args);
			appliquer(e);
			return e;
		} catch (err) {
			dire((err as Error).message, true);
			return null;
		} finally {
			occupe = false;
		}
	}

	// Premier traitement a la connexion : affiche le panier en cours.
	$effect(() => {
		if (session.connecte && !demarre) {
			demarre = true;
			void action('caisseTraiter');
		}
	});

	async function envoyer(code: string) {
		dire('Lecture de ' + code + '...');
		const e = await action('caisseScanner', [code]);
		if (!e) return;
		const r = (e.resultats ?? []).find((x) => x.code === code);
		if (r) {
			derniers = [r, ...derniers].slice(0, 5);
			dire(r.message + (r.description ? ' : ' + r.description : ''), r.resultat !== 'OK');
			if (r.resultat === 'OK') navigator.vibrate?.(60);
		} else {
			dire(code + ' : envoyé, résultat visible dans le panier.');
		}
	}

	function surCode(brut: string) {
		const code = brut.trim().toUpperCase();
		if (!code || occupe || !session.connecte) return;
		const maintenant = Date.now();
		if (code === dernierCode && maintenant - dernierInstant < DELAI_MEME_CODE) return;
		if (!FORMAT_ID.test(code)) {
			if (code !== dernierCode || maintenant - dernierInstant >= DELAI_MEME_CODE) dire('QR non reconnu (pas une pièce TREIZE).', true);
			dernierCode = code;
			dernierInstant = maintenant;
			return;
		}
		dernierCode = code;
		dernierInstant = maintenant;
		void envoyer(code);
	}

	async function retirer(id: string) {
		const e = await action('caisseRetirer', [id]);
		if (e) dire(id + ' retiré du panier.');
	}

	async function vider() {
		if (!videArme) {
			videArme = true;
			minuteurVide = setTimeout(() => (videArme = false), 4000);
			return;
		}
		if (minuteurVide) clearTimeout(minuteurVide);
		videArme = false;
		const e = await action('caisseVider');
		if (e) dire('Panier vidé.');
	}
</script>

<div class="page">
	<h2>Caisse : scan et panier</h2>
	<ConnexionTreize />
	{#if session.connecte}
		<ScanCamera onCode={surCode} />
		<p class="msg" class:err={erreur} role="status">{message}</p>
		<section>
			<h3>Panier ({panier.length}{panierMax ? ' / ' + panierMax : ''})</h3>
			{#if !panier.length}
				<p class="discret">Le panier est vide.</p>
			{:else}
				<ul>
					{#each panier as l (l.id)}
						<li>
							<span class="id">{l.id}</span>
							<span class="prix">{euros(l.prix)}</span>
							<button class="btn sm ghost" onclick={() => retirer(l.id)} disabled={occupe} aria-label={'Retirer ' + l.id}>x</button>
							<span class="desc">{l.description}</span>
						</li>
					{/each}
				</ul>
				<p class="total"><b>Total</b> {euros(total)}</p>
				<button class="btn ghost" onclick={vider} disabled={occupe}>{videArme ? 'Confirmer : vider le panier' : 'Vider le panier'}</button>
			{/if}
			<p class="discret">La validation de la vente se fait encore dans l'ancienne page Caisse.</p>
		</section>
	{/if}
</div>

<style>
	.page {
		max-width: 520px;
		margin: 0 auto;
		padding: 16px;
		display: grid;
		gap: 12px;
	}
	h2 {
		margin: 0;
		font-size: 18px;
	}
	h3 {
		margin: 0 0 8px;
		font-size: 15px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	li {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 2px 8px;
		align-items: center;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
	}
	.desc {
		grid-column: 1 / -1;
		color: var(--muted);
		font-size: 13px;
	}
	.id {
		font-weight: 600;
		word-break: break-all;
	}
	.total {
		margin: 8px 0;
	}
	.discret {
		color: var(--muted);
		font-size: 13px;
		margin: 8px 0 0;
	}
	.msg {
		margin: 0;
		min-height: 1.4em;
	}
	.msg.err {
		color: #b3261e;
	}
</style>
