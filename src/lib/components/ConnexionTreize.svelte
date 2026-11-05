<script lang="ts">
	import { afficherConnexion } from '../treize';
	import { session } from '../stores/session.svelte';

	let bouton: HTMLElement | undefined = $state();
	let erreur = $state('');

	// Le bouton Google n'est dessine que tant que la connexion manque.
	$effect(() => {
		if (!bouton || session.connecte) return;
		afficherConnexion(bouton).catch((e: Error) => (erreur = e.message));
	});
</script>

{#if !session.connecte}
	<div class="connexion">
		<p>Connecte-toi avec ton compte Google pour utiliser cette page.</p>
		<div bind:this={bouton}></div>
		{#if erreur || session.erreur}<p class="err">{erreur || session.erreur}</p>{/if}
	</div>
{/if}

<style>
	.connexion {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
	}
	p {
		margin: 0;
	}
	.err {
		color: #b3261e;
	}
</style>
