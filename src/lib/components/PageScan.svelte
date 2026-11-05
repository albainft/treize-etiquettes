<script lang="ts">
	import { onDestroy } from 'svelte';
	import jsQR from 'jsqr';
	import ConnexionTreize from './ConnexionTreize.svelte';

	// Bloc A de la caisse : lecture d'un QR par la camera. Aucune ecriture, aucun appel serveur.
	const FORMAT_ID = /^(FRI|BRO)-[A-Z0-9]+(-[A-Z0-9]+)?-\d{4}$/;

	let video: HTMLVideoElement;
	let flux: MediaStream | null = null;
	let actif = $state(false);
	let message = $state('');
	let erreur = $state(false);
	let lu = $state('');
	let valide = $state(false);
	let moteur = $state('');
	let nbLectures = $state(0);
	let boucle = 0;
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	type Detecteur = { detect(s: CanvasImageSource): Promise<{ rawValue: string }[]> };
	let natif: Detecteur | null = null;

	function dire(t: string, ko = false) {
		message = t;
		erreur = ko;
	}

	function retenir(texte: string) {
		const t = texte.trim().toUpperCase();
		if (!t) return;
		lu = t;
		valide = FORMAT_ID.test(t);
		nbLectures++;
	}

	function decoderImage(img: ImageData): string | null {
		const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
		return r ? r.data : null;
	}

	async function tour() {
		if (!actif || !video || video.readyState < 2) {
			boucle = requestAnimationFrame(tour);
			return;
		}
		try {
			let texte: string | null = null;
			if (natif) {
				const r = await natif.detect(video);
				if (r.length) texte = r[0].rawValue;
			} else {
				const w = video.videoWidth;
				const h = video.videoHeight;
				const echelle = Math.min(1, 800 / Math.max(w, h));
				canvas.width = Math.round(w * echelle);
				canvas.height = Math.round(h * echelle);
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				texte = decoderImage(ctx.getImageData(0, 0, canvas.width, canvas.height));
			}
			if (texte) retenir(texte);
		} catch {
			// image non lisible : on reessaie
		}
		boucle = window.setTimeout(() => requestAnimationFrame(tour), 120) as unknown as number;
	}

	async function demarrer() {
		dire('');
		lu = '';
		try {
			const BD = (window as unknown as { BarcodeDetector?: new (o: object) => Detecteur }).BarcodeDetector;
			natif = BD ? new BD({ formats: ['qr_code'] }) : null;
			moteur = natif ? 'BarcodeDetector (natif)' : 'jsQR';
			flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
			video.srcObject = flux;
			await video.play();
			actif = true;
			boucle = requestAnimationFrame(tour);
		} catch (e) {
			const n = (e as Error).name;
			dire(n === 'NotAllowedError' ? 'Camera refusee : autorise-la dans les reglages du navigateur.' : n === 'NotFoundError' ? 'Aucune camera trouvee.' : 'Camera indisponible : ' + (e as Error).message, true);
		}
	}

	function arreter() {
		actif = false;
		cancelAnimationFrame(boucle);
		clearTimeout(boucle);
		flux?.getTracks().forEach((t) => t.stop());
		flux = null;
		if (video) video.srcObject = null;
	}
	onDestroy(arreter);

	// Secours et essai sans camera : lecture d'une photo ou d'une capture d'ecran.
	async function depuisFichier(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!f) return;
		moteur = 'jsQR (fichier)';
		const bmp = await createImageBitmap(f);
		canvas.width = bmp.width;
		canvas.height = bmp.height;
		ctx.drawImage(bmp, 0, 0);
		const t = decoderImage(ctx.getImageData(0, 0, canvas.width, canvas.height));
		if (t) {
			retenir(t);
			dire('');
		} else dire('Aucun QR lisible dans cette image.', true);
	}
</script>

<div class="page">
	<h2>Scan (essai)</h2>
	<ConnexionTreize />
	<p class="aide">Cette page lit seulement le QR d'une etiquette. Elle n'ajoute rien au panier et ne vend rien.</p>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} playsinline muted class:cache={!actif}></video>
	<div class="row">
		{#if !actif}
			<button class="btn" onclick={demarrer}>Demarrer la camera</button>
		{:else}
			<button class="btn" onclick={arreter}>Arreter</button>
		{/if}
		<label class="btn ghost fichier">Lire une image<input type="file" accept="image/*" onchange={depuisFichier} hidden /></label>
	</div>
	{#if lu}
		<dl class="fiche" class:ok={valide} class:ko={!valide}>
			<dt>Lu</dt>
			<dd>{lu}</dd>
			<dt>Format</dt>
			<dd>{valide ? 'Identifiant TREIZE valide' : 'Pas un identifiant TREIZE'}</dd>
			<dt>Lecteur</dt>
			<dd>{moteur} ({nbLectures} lecture{nbLectures > 1 ? 's' : ''})</dd>
		</dl>
	{/if}
	<p class="msg" class:err={erreur} role="status">{message}</p>
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
	.aide {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
	}
	video {
		width: 100%;
		border-radius: 10px;
		background: #000;
		aspect-ratio: 4 / 3;
		object-fit: cover;
	}
	video.cache {
		display: none;
	}
	.row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.fichier {
		cursor: pointer;
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
	.fiche.ok {
		border-color: #2e7d32;
	}
	.fiche.ko {
		border-color: #b3261e;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		word-break: break-all;
	}
	.msg {
		margin: 0;
		min-height: 1.4em;
	}
	.msg.err {
		color: #b3261e;
	}
</style>
