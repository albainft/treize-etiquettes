<script lang="ts">
	import { onDestroy } from 'svelte';
	import { appeler, ErreurTreize, MESSAGES } from '../treize';
	import { session } from '../stores/session.svelte';
	import ConnexionTreize from './ConnexionTreize.svelte';

	interface Fiche {
		id: string;
		categorie: string;
		description: string;
		prix: string;
		statut: string;
		refus?: string;
	}

	let saisie = $state('');
	let commentaire = $state('');
	let fiche = $state<Fiche | null>(null);
	let message = $state('');
	let erreur = $state(false);
	let occupe = $state(false);
	let arme = $state(false);
	let minuteur: ReturnType<typeof setTimeout> | null = null;

	function desarmer() {
		arme = false;
		if (minuteur) clearTimeout(minuteur);
		minuteur = null;
	}
	onDestroy(desarmer);

	function dire(texte: string, ko = false) {
		message = texte;
		erreur = ko;
	}

	async function chercher() {
		const id = saisie.trim().toUpperCase();
		desarmer();
		fiche = null;
		if (!id) return dire('Saisis un identifiant.', true);
		dire('Recherche...');
		occupe = true;
		try {
			const r = await appeler<Fiche>('suppressionApercu', [id]);
			fiche = r;
			if (r.refus) {
				dire(MESSAGES[r.refus] ?? 'Refus : ' + r.refus, true);
			} else dire('');
		} catch (e) {
			dire((e as Error).message, true);
		} finally {
			occupe = false;
		}
	}

	async function supprimer() {
		if (!fiche || fiche.refus) return;
		if (!arme) {
			arme = true;
			minuteur = setTimeout(desarmer, 6000);
			return;
		}
		const id = fiche.id;
		desarmer();
		dire('Suppression...');
		occupe = true;
		try {
			const r = await appeler<{ direction?: string }>('supprimerPiece', [id, commentaire.trim()]);
			fiche = null;
			saisie = '';
			commentaire = '';
			const suite = r.direction === 'OK' || r.direction === 'ABSENT' ? '' : " Attention : la ligne n'a pas pu être retirée de DIRECTION, prévenir le propriétaire.";
			dire(id + ' supprimée.' + suite, !!suite);
		} catch (e) {
			dire((e as ErreurTreize).message, true);
		} finally {
			occupe = false;
		}
	}
</script>

<div class="page">
	<h2>Supprimer une pièce</h2>
	<ConnexionTreize />
	{#if session.connecte}
		<div class="row">
			<input class="input" placeholder="Identifiant, ex. FRI-VES-0001" bind:value={saisie} onkeydown={(e) => e.key === 'Enter' && chercher()} disabled={occupe} />
			<button class="btn" onclick={chercher} disabled={occupe}>Chercher</button>
		</div>
		{#if fiche}
			<dl class="fiche">
				<dt>Identifiant</dt><dd>{fiche.id}</dd>
				<dt>Catégorie</dt><dd>{fiche.categorie}</dd>
				<dt>Description</dt><dd>{fiche.description}</dd>
				<dt>Prix</dt><dd>{fiche.prix}</dd>
				<dt>Statut</dt><dd>{fiche.statut}</dd>
			</dl>
			{#if !fiche.refus}
				<label class="field">
					<span>Commentaire (facultatif, 200 caractères)</span>
					<textarea class="input" maxlength="200" rows="3" bind:value={commentaire} placeholder="Motif : doublon, erreur de saisie..."></textarea>
				</label>
				<button class="btn danger" onclick={supprimer} disabled={occupe}>
					{arme ? 'Confirmer la suppression de ' + fiche.id : 'Supprimer cette pièce'}
				</button>
			{/if}
		{/if}
		<p class="msg" class:err={erreur} role="status">{message}</p>
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
	.fiche {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 4px 12px;
		margin: 0;
		padding: 12px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		word-break: break-word;
	}
	.danger {
		background: #b3261e;
		border-color: #b3261e;
		color: #fff;
	}
	.msg {
		margin: 0;
		min-height: 1.4em;
	}
	.msg.err {
		color: #b3261e;
	}
</style>
