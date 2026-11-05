<script lang="ts">
	import { pages, type PageSite } from '../stores/page.svelte';
	import { session } from '../stores/session.svelte';

	// Supprimer : niveau 2 (DIRIGEANT) et plus. Tant que l'identité est inconnue, l'onglet reste visible.
	const onglets: { cle: PageSite; texte: string; niveau: number }[] = [
		{ cle: 'etiquettes', texte: 'Étiquettes', niveau: 0 },
		{ cle: 'ajout', texte: 'Ajout', niveau: 1 },
		{ cle: 'caisse', texte: 'Caisse', niveau: 1 },
		{ cle: 'supprimer', texte: 'Supprimer', niveau: 2 }
	];
	const visibles = $derived(onglets.filter((o) => !session.identite || session.niveau >= o.niveau));
</script>

<nav aria-label="Pages">
	<b class="marque">TREIZE</b>
	{#each visibles as o (o.cle)}
		<button class="btn sm ghost" class:active={pages.courante === o.cle} aria-current={pages.courante === o.cle ? 'page' : undefined} onclick={() => pages.aller(o.cle)}>{o.texte}</button>
	{/each}
	{#if session.identite}<span class="qui">Bonjour {session.identite.prenom}</span>{/if}
</nav>

<style>
	nav {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
		background: var(--panel);
		flex-wrap: wrap;
	}
	.marque {
		letter-spacing: 0.12em;
		margin-right: 8px;
	}
	.qui {
		margin-left: auto;
		color: var(--muted);
		font-size: 13px;
	}
</style>
