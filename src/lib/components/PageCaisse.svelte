<script lang="ts">
	import { appeler, ErreurTreize } from '../treize';
	import { session } from '../stores/session.svelte';
	import ConnexionTreize from './ConnexionTreize.svelte';
	import ScanCamera from './ScanCamera.svelte';

	// Caisse du site : scan par camera, panier, validation de la vente, ventes du jour, annulation.
	interface LignePanier {
		id: string;
		description: string;
		prixBoutique: number;
		prixVinted: number;
	}
	interface Ligne extends LignePanier {
		saisi: string;
		modifie: boolean;
		erreur: boolean;
	}
	interface Resultat {
		code: string;
		resultat: string;
		message: string;
		description: string;
	}
	interface VenteJour {
		id: string;
		total: number;
		heure: string;
		canal: string;
		paiement: string;
		nb: number;
		statut: string;
	}
	interface Etat {
		panier: LignePanier[];
		panierMax: number;
		canaux?: { boutique: string; vinted: string };
		paiements?: Record<string, string[]>;
		ventes?: { lignes: VenteJour[]; total: number; nb: number };
		peutAnnuler?: boolean;
		peutAnnulerAncienne?: boolean;
		resultats?: Resultat[];
		vente?: { idVente: string; total: number; nb: number; rejeu: boolean };
		annulation?: { idVente: string; remises: number; notes?: string[] };
	}

	const FORMAT_ID = /^(FRI|BRO)-[A-Z0-9]+(-[A-Z0-9]+)?-\d{4}$/;
	const FORMAT_VENTE = /^VT\d{2}-\d{2}-\d{3,}$/;
	// Un code n'est renvoye qu'apres 2 s sans le revoir : une piece tenue devant la camera ne cree qu'un envoi.
	const SILENCE_MEME_CODE = 2000;

	let lignes = $state<Ligne[]>([]);
	let panierMax = $state(0);
	let etat = $state<Etat | null>(null);
	let canal = $state('');
	let paiement = $state('');
	let message = $state('');
	let erreur = $state(false);
	let succes = $state('');
	let occupe = $state(false);
	let videArme = $state(false);
	let annuleArme = $state('');
	let ancienneId = $state('');
	let ancienneArmee = $state(false);
	let cle = nouvelleCle();
	let dernierCode = '';
	let derniereVue = 0;
	let demarre = false;
	let minuteurVide: ReturnType<typeof setTimeout> | null = null;
	let minuteurAnnule: ReturnType<typeof setTimeout> | null = null;
	let minuteurAncienne: ReturnType<typeof setTimeout> | null = null;

	const nomBoutique = $derived(etat?.canaux?.boutique ?? 'Treize');
	const nomVinted = $derived(etat?.canaux?.vinted ?? 'Vinted');
	const paiements = $derived(etat?.paiements?.[canal] ?? []);
	const euros = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

	function nouvelleCle(): string {
		const a = new Uint8Array(16);
		crypto.getRandomValues(a);
		return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
	}
	function lireMontant(brut: string): number | null {
		const s = String(brut).trim().replace(',', '.');
		if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
		const n = Number(s);
		return n > 0 ? n : null;
	}
	function prixDefaut(l: LignePanier): number {
		return canal === nomVinted && l.prixVinted > 0 ? l.prixVinted : l.prixBoutique;
	}
	const total = $derived.by(() => {
		let t = 0;
		for (const l of lignes) {
			const m = lireMontant(l.saisi);
			if (m === null) return null;
			t += m;
		}
		return t;
	});

	function dire(t: string, ko = false) {
		message = t;
		erreur = ko;
	}

	function appliquer(e: Etat) {
		// Reponse legere (scan, retrait, vidage) : pas de ventes du jour, on garde les precedentes.
		etat = { ...e, ventes: e.ventes ?? etat?.ventes };
		panierMax = e.panierMax ?? panierMax;
		if (!canal) canal = e.canaux?.boutique ?? 'Treize';
		const avant = new Map(lignes.map((l) => [l.id, l]));
		lignes = (e.panier ?? []).map((p) => {
			const a = avant.get(p.id);
			const l: Ligne = { ...p, saisi: '', modifie: false, erreur: false };
			if (a?.modifie) {
				l.saisi = a.saisi;
				l.modifie = true;
			} else l.saisi = String(prixDefaut(p)).replace('.', ',');
			return l;
		});
		if (!paiements.includes(paiement)) paiement = paiements.length === 1 ? paiements[0] : '';
	}

	function changerCanal(c: string) {
		canal = c;
		for (const l of lignes) if (!l.modifie) l.saisi = String(prixDefaut(l)).replace('.', ',');
		if (!paiements.includes(paiement)) paiement = paiements.length === 1 ? paiements[0] : '';
	}

	async function action(nom: string, args: unknown[] = []): Promise<Etat | null> {
		occupe = true;
		try {
			const e = await appeler<Etat>(nom, args);
			appliquer(e);
			return e;
		} catch (err) {
			traiterErreur(err);
			return null;
		} finally {
			occupe = false;
		}
	}

	function traiterErreur(err: unknown) {
		if (!(err instanceof ErreurTreize)) return dire((err as Error).message, true);
		const rep = err.reponse as { erreurs?: Record<string, string>; pieces?: { id: string; motif: string }[] };
		if (err.code === 'VALIDATION' && rep.erreurs) {
			let mauvais = false;
			for (const l of lignes) if (rep.erreurs['prix:' + l.id]) (l.erreur = true), (mauvais = true);
			return dire(rep.erreurs.paiement ? 'Choisis un moyen de paiement.' : mauvais ? 'Prix à vérifier.' : err.message, true);
		}
		if (err.code === 'NON_VENDABLE' && rep.pieces) {
			dire(err.message + ' ' + rep.pieces.map((p) => p.id + ' (' + p.motif + ')').join(', '), true);
			void action('caisseTraiter');
			return;
		}
		if (['PANIER_CHANGE', 'PANIER_VIDE', 'INTROUVABLE'].includes(err.code)) {
			dire(err.message, true);
			void action('caisseTraiter');
			return;
		}
		dire(err.message, true);
	}

	// Premier traitement a la connexion : affiche le panier en cours et les ventes du jour.
	$effect(() => {
		if (session.connecte && !demarre) {
			demarre = true;
			void action('caisseTraiter');
		}
	});

	async function envoyer(code: string) {
		dire('Lecture de ' + code + '...');
		succes = '';
		const e = await action('caisseScanner', [code]);
		if (!e) return;
		const r = (e.resultats ?? []).find((x) => x.code === code);
		if (r) {
			dire(r.message + (r.description ? ' : ' + r.description : ''), r.resultat !== 'OK');
			if (r.resultat === 'OK') navigator.vibrate?.(60);
		} else dire(code + ' : envoyé, résultat visible dans le panier.');
	}

	function surCode(brut: string) {
		const code = brut.trim().toUpperCase();
		if (!code) return;
		const maintenant = Date.now();
		if (code === dernierCode) {
			const absence = maintenant - derniereVue;
			derniereVue = maintenant;
			if (absence < SILENCE_MEME_CODE) return;
		}
		if (occupe || !session.connecte) return;
		dernierCode = code;
		derniereVue = maintenant;
		if (!FORMAT_ID.test(code)) {
			dire('QR non reconnu (pas une pièce TREIZE).', true);
			return;
		}
		void envoyer(code);
	}

	async function retirer(id: string) {
		succes = '';
		const e = await action('caisseRetirer', [id, 'leger']);
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
		succes = '';
		const e = await action('caisseVider', ['leger']);
		if (e) dire('Panier vidé.');
	}

	async function valider() {
		if (occupe) return;
		succes = '';
		let mauvais = false;
		for (const l of lignes) {
			l.erreur = lireMontant(l.saisi) === null;
			if (l.erreur) mauvais = true;
		}
		if (mauvais) return dire('Prix à vérifier.', true);
		if (!paiement) return dire('Choisis un moyen de paiement.', true);
		if (!lignes.length) return dire('Le panier est vide.', true);
		dire('Enregistrement de la vente...');
		const e = await action('caisseValider', [{ canal, paiement, lignes: lignes.map((l) => ({ id: l.id, prix: l.saisi })), cle }]);
		if (!e) return;
		cle = nouvelleCle();
		dire('');
		const v = e.vente;
		if (v) succes = (v.rejeu ? 'Cette vente était déjà enregistrée' : 'Vente enregistrée') + ' : ' + v.idVente + ' – ' + v.nb + ' pièce(s) – ' + euros(v.total);
	}

	async function annuler(id: string) {
		succes = '';
		const e = await action('caisseAnnuler', [id]);
		if (!e) return;
		dire('');
		const a = e.annulation;
		const notes = a?.notes?.length ? ' – À vérifier : ' + a.notes.join(', ') : '';
		succes = (a?.idVente ? a.idVente + ' – ' : '') + 'Vente annulée, pièce(s) remise(s) en vente : ' + (a?.remises ?? 0) + notes;
	}

	function demanderAnnulation(id: string) {
		if (occupe) return;
		if (annuleArme !== id) {
			annuleArme = id;
			if (minuteurAnnule) clearTimeout(minuteurAnnule);
			minuteurAnnule = setTimeout(() => (annuleArme = ''), 6000);
			return;
		}
		annuleArme = '';
		if (minuteurAnnule) clearTimeout(minuteurAnnule);
		void annuler(id);
	}

	function annulerAncienne() {
		if (occupe) return;
		const id = ancienneId.trim().toUpperCase();
		if (!FORMAT_VENTE.test(id)) return dire('Numéro de vente invalide, ex. VT26-10-001.', true);
		if (!ancienneArmee) {
			ancienneArmee = true;
			minuteurAncienne = setTimeout(() => (ancienneArmee = false), 6000);
			return;
		}
		ancienneArmee = false;
		if (minuteurAncienne) clearTimeout(minuteurAncienne);
		void annuler(id).then(() => (ancienneId = ''));
	}
</script>

<div class="page">
	<h2>Caisse</h2>
	<ConnexionTreize />
	{#if session.connecte}
		<ScanCamera onCode={surCode} />
		<p class="msg" class:err={erreur} role="status">{message}</p>
		{#if succes}<p class="succes" role="status">{succes}</p>{/if}

		<section>
			<h3>Panier ({lignes.length}{panierMax ? ' / ' + panierMax : ''})</h3>
			{#if !lignes.length}
				<p class="discret">Le panier est vide. Scanne une pièce.</p>
			{:else}
				<ul>
					{#each lignes as l (l.id)}
						<li class:invalide={l.erreur}>
							<span class="id">{l.id}</span>
							<input
								class="input prix"
								inputmode="decimal"
								autocomplete="off"
								aria-label={'Prix de ' + l.id}
								value={l.saisi}
								oninput={(e) => {
									l.saisi = e.currentTarget.value;
									l.modifie = true;
									l.erreur = false;
								}}
							/>
							<button class="btn sm ghost" onclick={() => retirer(l.id)} disabled={occupe} aria-label={'Retirer ' + l.id}>x</button>
							<span class="desc">{l.description}</span>
						</li>
					{/each}
				</ul>
				<p class="total"><b>Total</b> {total === null ? 'Prix à vérifier' : euros(total)}</p>

				<div class="champ">
					<span class="etiquette">Canal</span>
					<div class="choix">
						<label><input type="radio" name="canal" checked={canal === nomBoutique} onchange={() => changerCanal(nomBoutique)} /> {nomBoutique}</label>
						<label><input type="radio" name="canal" checked={canal === nomVinted} onchange={() => changerCanal(nomVinted)} /> {nomVinted}</label>
					</div>
				</div>
				<div class="champ">
					<label class="etiquette" for="paiement">Moyen de paiement</label>
					<select id="paiement" class="input" bind:value={paiement}>
						<option value="">Choisir...</option>
						{#each paiements as p (p)}<option value={p}>{p}</option>{/each}
					</select>
				</div>
				<div class="row">
					<button class="btn" onclick={valider} disabled={occupe}>Valider la vente</button>
					<button class="btn ghost" onclick={vider} disabled={occupe}>{videArme ? 'Confirmer : vider le panier' : 'Vider le panier'}</button>
				</div>
			{/if}
		</section>

		<section>
			<h3>Ventes du jour</h3>
			<p class="total"><b>{euros(etat?.ventes?.total ?? 0)}</b> – {etat?.ventes?.nb ?? 0} vente(s)</p>
			{#if !(etat?.ventes?.lignes.length)}
				<p class="discret">Aucune vente aujourd'hui.</p>
			{:else}
				<ul>
					{#each etat?.ventes?.lignes ?? [] as v (v.id)}
						<li class:annulee={v.statut !== 'Validee'}>
							<span class="id">{v.id} – {euros(v.total)}</span>
							{#if v.statut === 'Validee' && etat?.peutAnnuler}
								<button class="btn sm danger" onclick={() => demanderAnnulation(v.id)} disabled={occupe}>{annuleArme === v.id ? "Confirmer l'annulation" : 'Annuler'}</button>
							{:else}<span></span>{/if}
							<span class="desc">{v.heure} – {v.canal} – {v.paiement} – {v.nb} pièce(s){v.statut === 'Validee' ? '' : ' – ' + (v.statut === 'Annulee' ? 'annulée' : v.statut)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if etat?.peutAnnulerAncienne}
			<section>
				<h3>Annuler une vente plus ancienne</h3>
				<div class="row">
					<input class="input" placeholder="VT26-10-001" maxlength="20" autocomplete="off" bind:value={ancienneId} />
					<button class="btn danger" onclick={annulerAncienne} disabled={occupe}>{ancienneArmee ? "Confirmer l'annulation" : 'Annuler cette vente'}</button>
				</div>
			</section>
		{/if}
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
	li.invalide {
		border-color: #b3261e;
	}
	li.annulee {
		opacity: 0.6;
	}
	.prix {
		width: 90px;
		text-align: right;
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
	.champ {
		display: grid;
		gap: 4px;
		margin-bottom: 8px;
	}
	.etiquette {
		color: var(--muted);
		font-size: 13px;
	}
	.choix {
		display: flex;
		gap: 16px;
	}
	.row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
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
	.succes {
		margin: 0;
		padding: 10px 12px;
		border: 1px solid #2e7d32;
		border-radius: 10px;
		background: color-mix(in srgb, #2e7d32 10%, transparent);
	}
	.danger {
		background: #b3261e;
		border-color: #b3261e;
		color: #fff;
	}
</style>
