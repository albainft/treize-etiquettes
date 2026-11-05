<script lang="ts">
	import { onDestroy } from 'svelte';
	import jsQR from 'jsqr';

	// Camera + decodage QR. Emet chaque texte lu (le filtrage des repetitions est fait par la page).
	let { onCode }: { onCode: (texte: string) => void } = $props();

	let video: HTMLVideoElement;
	let flux: MediaStream | null = null;
	let actif = $state(false);
	let message = $state('');
	let moteur = $state('');
	let minuteur = 0;
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	type Detecteur = { detect(s: CanvasImageSource): Promise<{ rawValue: string }[]> };
	let natif: Detecteur | null = null;

	async function tour() {
		if (!actif) return;
		if (video && video.readyState >= 2) {
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
					const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
					const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
					if (r) texte = r.data;
				}
				if (texte) onCode(texte);
			} catch {
				// image non lisible : on reessaie au tour suivant
			}
		}
		minuteur = window.setTimeout(() => requestAnimationFrame(tour), 120);
	}

	async function demarrer() {
		message = '';
		try {
			const BD = (window as unknown as { BarcodeDetector?: new (o: object) => Detecteur }).BarcodeDetector;
			natif = BD ? new BD({ formats: ['qr_code'] }) : null;
			moteur = natif ? 'natif' : 'jsQR';
			flux = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
				audio: false
			});
			video.srcObject = flux;
			await video.play();
			actif = true;
			requestAnimationFrame(tour);
		} catch (e) {
			const n = (e as Error).name;
			message =
				n === 'NotAllowedError'
					? 'Caméra refusée : autorise-la dans les réglages du navigateur.'
					: n === 'NotFoundError'
						? 'Aucune caméra trouvée.'
						: 'Caméra indisponible : ' + (e as Error).message;
		}
	}

	function arreter() {
		actif = false;
		clearTimeout(minuteur);
		flux?.getTracks().forEach((t) => t.stop());
		flux = null;
		if (video) video.srcObject = null;
	}
	onDestroy(arreter);

	// Secours : lecture d'une photo ou d'une capture d'ecran.
	async function depuisFichier(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		if (!f) return;
		const bmp = await createImageBitmap(f);
		canvas.width = bmp.width;
		canvas.height = bmp.height;
		ctx.drawImage(bmp, 0, 0);
		const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
		message = r ? '' : 'Aucun QR lisible dans cette image.';
		if (r) onCode(r.data);
		input.value = '';
	}
</script>

<div class="camera">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} playsinline muted class:cache={!actif}></video>
	<div class="row">
		{#if !actif}
			<button class="btn" onclick={demarrer}>Démarrer la caméra</button>
		{:else}
			<button class="btn" onclick={arreter}>Arrêter la caméra</button>
		{/if}
		<label class="btn ghost fichier">Lire une image<input type="file" accept="image/*" onchange={depuisFichier} hidden /></label>
		{#if actif}<span class="moteur">lecteur : {moteur}</span>{/if}
	</div>
	{#if message}<p class="err" role="status">{message}</p>{/if}
</div>

<style>
	.camera {
		display: grid;
		gap: 8px;
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
		align-items: center;
	}
	.fichier {
		cursor: pointer;
	}
	.moteur {
		color: var(--muted);
		font-size: 12px;
	}
	.err {
		margin: 0;
		color: #b3261e;
	}
</style>
