<script lang="ts">
	import { appeler, ErreurTreize } from '../treize';
	import { session } from '../stores/session.svelte';

	interface Categorie {
		code: string;
		libelle: string;
		groupe?: string;
	}
	interface Contexte {
		genres: string[];
		lieux: string[];
		tailles: string[];
		limites: Record<string, number>;
		photoLargeur: number;
		categories: Record<string, Categorie[]>;
		photosMax: number;
	}
	interface Photo {
		b64: string;
		apercu: string;
	}
	interface ReponseAjout {
		id: string;
	}
	interface Envoi {
		numero: number;
		b64: string;
	}

	const RAISONS: Record<string, string> = {
		obligatoire: 'Obligatoire',
		invalide: 'Valeur invalide',
		trop_long: 'Texte trop long',
		trop_grand: 'Montant trop grand',
		inconnue: 'Choix inconnu',
		inconnu: 'Choix inconnu',
		hors_limites: 'Date impossible'
	};

	function cle(): string {
		const a = new Uint8Array(16);
		crypto.getRandomValues(a);
		return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
	}
	function aujourdhui(): string {
		const d = new Date();
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}
	function vide() {
		return {
			categorie: '',
			genre: '',
			description: '',
			marque: '',
			taille: '',
			dimensions: '',
			prix_boutique: '',
			prix_vinted: '',
			prix_achat: '',
			date_achat: aujourdhui(),
			localisation: ''
		};
	}

	let ctx = $state<Contexte | null>(null);
	let famille = $state<'FRIPES' | 'BROC'>('FRIPES');
	let champs = $state(vide());
	let photos = $state<Photo[]>([]);
	let erreurs = $state<Record<string, string>>({});
	let bandeau = $state('');
	let erreurPhotos = $state('');
	let progres = $state('');
	let occupe = $state(false);
	let chargement = $state(false);
	// Meme cle tant que la piece n'est pas enregistree : un renvoi ne cree pas de doublon.
	let cleEnvoi = $state(cle());
	let succes = $state<{ id: string; envoyees: number; echecs: Envoi[] } | null>(null);

	const categories = $derived(ctx?.categories[famille] ?? []);
	const groupes = $derived.by(() => {
		const sortie: { nom: string; liste: Categorie[] }[] = [];
		for (const c of categories) {
			const nom = c.groupe ?? '';
			let g = sortie.find((x) => x.nom === nom);
			if (!g) sortie.push((g = { nom, liste: [] }));
			g.liste.push(c);
		}
		return sortie;
	});

	// Chargement des listes (genres, categories, lieux...) des que la connexion est la.
	$effect(() => {
		if (!session.connecte || ctx || chargement) return;
		chargement = true;
		appeler<Contexte>('ajoutContexte')
			.then((r) => (ctx = r))
			.catch((e: Error) => (bandeau = e.message))
			.finally(() => (chargement = false));
	});

	$effect(() => {
		void famille;
		champs.categorie = '';
	});

	function surFermeture(e: BeforeUnloadEvent) {
		if (occupe) {
			e.preventDefault();
			e.returnValue = '';
		}
	}

	// Reduit une photo : 1280 px au plus, JPEG. null si illisible.
	function reduire(fichier: File, largeur: number): Promise<Photo | null> {
		return new Promise((resolve) => {
			const url = URL.createObjectURL(fichier);
			const img = new Image();
			img.onload = () => {
				try {
					const essais: [number, number][] = [
						[largeur, 0.8],
						[Math.round(largeur * 0.8), 0.65],
						[Math.round(largeur * 0.625), 0.55]
					];
					let sortie: Photo | null = null;
					for (const [maxi, qualite] of essais) {
						const echelle = Math.min(1, maxi / Math.max(img.naturalWidth, img.naturalHeight));
						const c = document.createElement('canvas');
						c.width = Math.max(1, Math.round(img.naturalWidth * echelle));
						c.height = Math.max(1, Math.round(img.naturalHeight * echelle));
						c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
						const data = c.toDataURL('image/jpeg', qualite);
						const b64 = data.substring(data.indexOf(',') + 1);
						sortie = { b64, apercu: data };
						if (b64.length < 1_400_000) break;
					}
					resolve(sortie);
				} catch {
					resolve(null);
				} finally {
					URL.revokeObjectURL(url);
				}
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				resolve(null);
			};
			img.src = url;
		});
	}

	async function ajouterPhotos(e: Event) {
		const entree = e.currentTarget as HTMLInputElement;
		const fichiers = Array.from(entree.files ?? []);
		entree.value = '';
		erreurPhotos = '';
		if (!ctx) return;
		for (const f of fichiers) {
			if (photos.length >= ctx.photosMax) {
				erreurPhotos = 'Nombre maximal de photos atteint.';
				break;
			}
			const p = await reduire(f, ctx.photoLargeur || 1280);
			if (p) photos.push(p);
			else erreurPhotos = "Une photo n'a pas pu être lue et a été ignorée.";
		}
	}

	function controleLocal(): Record<string, string> {
		const e: Record<string, string> = {};
		if (!champs.categorie) e.categorie = 'obligatoire';
		if (famille === 'FRIPES' && !champs.genre) e.genre = 'obligatoire';
		if (!champs.description.trim()) e.description = 'obligatoire';
		if (!champs.prix_boutique.trim()) e.prix_boutique = 'obligatoire';
		return e;
	}

	async function enregistrer(ev: Event) {
		ev.preventDefault();
		if (occupe) return;
		bandeau = '';
		erreurs = controleLocal();
		if (Object.keys(erreurs).length) {
			bandeau = 'Vérifie les champs signalés en rouge.';
			return;
		}
		occupe = true;
		progres = 'Enregistrement en cours…';
		try {
			const r = await appeler<ReponseAjout>('ajoutPiece', [{ famille, ...champs, cle: cleEnvoi }]);
			const aEnvoyer = photos.map((p, i) => ({ numero: i + 1, b64: p.b64 }));
			const echecs = await envoyerPhotos(r.id, aEnvoyer);
			succes = { id: r.id, envoyees: aEnvoyer.length - echecs.length, echecs };
		} catch (e) {
			const err = e as ErreurTreize;
			if (err.code === 'VALIDATION' && err.reponse.erreurs) {
				erreurs = err.reponse.erreurs as Record<string, string>;
				bandeau = err.message;
			} else bandeau = err.message;
		} finally {
			occupe = false;
			progres = '';
		}
	}

	// Une photo a la fois, 2 nouvelles tentatives chacune. Retourne les photos non envoyees.
	async function envoyerPhotos(id: string, liste: Envoi[], total = liste.length): Promise<Envoi[]> {
		const echecs: Envoi[] = [];
		for (let i = 0; i < liste.length; i++) {
			progres = `Photo ${i + 1} / ${liste.length}`;
			let ok = false;
			for (let essai = 0; essai < 3 && !ok; essai++) {
				try {
					await appeler('ajoutPhoto', [id, liste[i].numero, liste[i].b64, i === liste.length - 1, total]);
					ok = true;
				} catch (e) {
					const code = (e as ErreurTreize).code;
					if (code === 'ACCES_REFUSE' || code === 'PHOTO_INVALIDE' || code === 'PIECE_INTROUVABLE') break;
					await new Promise((r) => setTimeout(r, 1500 * (essai + 1)));
				}
			}
			if (!ok) echecs.push(liste[i]);
		}
		return echecs;
	}

	async function reessayer() {
		if (!succes || occupe || !succes.echecs.length) return;
		occupe = true;
		const { id, envoyees, echecs } = succes;
		try {
			const reste = await envoyerPhotos(id, echecs);
			succes = { id, envoyees: envoyees + echecs.length - reste.length, echecs: reste };
		} finally {
			occupe = false;
			progres = '';
		}
	}

	function autre() {
		if (occupe) return;
		champs = vide();
		photos = [];
		erreurs = {};
		bandeau = '';
		erreurPhotos = '';
		cleEnvoi = cle();
		succes = null;
	}
</script>

<svelte:window onbeforeunload={surFermeture} />

<div class="page">
	<h2>Ajouter une pièce</h2>
	{#if bandeau}<div class="bandeau" role="alert">{bandeau}</div>{/if}

	{#if session.connecte && succes}
		<section class="succes">
			<h3>Pièce enregistrée</h3>
			<div class="identifiant">{succes.id}</div>
			{#if succes.envoyees > 0}<div class="info">{succes.envoyees} photo(s) envoyée(s)</div>{/if}
			{#if succes.echecs.length}
				<div class="bandeau">{succes.echecs.length} photo(s) non envoyée(s). La pièce est enregistrée : réessaie les photos.</div>
				<button class="btn" onclick={reessayer} disabled={occupe}>Réessayer les photos</button>
			{/if}
			<p class="discret" aria-live="polite">{progres}</p>
			<button class="btn primary" onclick={autre} disabled={occupe}>Ajouter une autre pièce</button>
		</section>
	{:else if session.connecte && ctx}
		<form onsubmit={enregistrer} novalidate>
			<div class="choix" role="radiogroup" aria-label="Type">
				<label><input type="radio" bind:group={famille} value="FRIPES" /><span>Fripes</span></label>
				<label><input type="radio" bind:group={famille} value="BROC" /><span>Broc</span></label>
			</div>

			{#if famille === 'FRIPES'}
				<label class="field" class:invalide={erreurs.genre}>
					<span>Univers</span>
					<select class="input" bind:value={champs.genre}>
						<option value="">Choisir…</option>
						{#each ctx.genres as g (g)}<option value={g}>{g}</option>{/each}
					</select>
					{#if erreurs.genre}<small class="err">{RAISONS[erreurs.genre] ?? erreurs.genre}</small>{/if}
				</label>
			{/if}

			<label class="field" class:invalide={erreurs.categorie}>
				<span>Catégorie</span>
				<select class="input" bind:value={champs.categorie}>
					<option value="">Choisir…</option>
					{#each groupes as g (g.nom)}
						{#if g.nom}
							<optgroup label={g.nom}>{#each g.liste as c (c.code)}<option value={c.code}>{c.libelle}</option>{/each}</optgroup>
						{:else}
							{#each g.liste as c (c.code)}<option value={c.code}>{c.libelle}</option>{/each}
						{/if}
					{/each}
				</select>
				{#if erreurs.categorie}<small class="err">{RAISONS[erreurs.categorie] ?? erreurs.categorie}</small>{/if}
			</label>

			<label class="field" class:invalide={erreurs.description}>
				<span>Description</span>
				<input class="input" type="text" maxlength={ctx.limites.description ?? 200} autocomplete="off" bind:value={champs.description} />
				{#if erreurs.description}<small class="err">{RAISONS[erreurs.description] ?? erreurs.description}</small>{/if}
			</label>

			<div class="grid2">
				<label class="field" class:invalide={erreurs.marque}>
					<span>Marque (facultatif)</span>
					<input class="input" type="text" maxlength={ctx.limites.marque ?? 60} autocomplete="off" bind:value={champs.marque} />
					{#if erreurs.marque}<small class="err">{RAISONS[erreurs.marque] ?? erreurs.marque}</small>{/if}
				</label>
				{#if famille === 'FRIPES'}
					<label class="field" class:invalide={erreurs.taille}>
						<span>Taille (facultatif)</span>
						<input class="input" type="text" list="liste-tailles" autocomplete="off" bind:value={champs.taille} />
						<datalist id="liste-tailles">{#each ctx.tailles as t (t)}<option value={t}></option>{/each}</datalist>
						{#if erreurs.taille}<small class="err">{RAISONS[erreurs.taille] ?? erreurs.taille}</small>{/if}
					</label>
				{:else}
					<label class="field" class:invalide={erreurs.dimensions}>
						<span>Dimensions (facultatif)</span>
						<input class="input" type="text" maxlength={ctx.limites.dimensions ?? 60} autocomplete="off" bind:value={champs.dimensions} />
						{#if erreurs.dimensions}<small class="err">{RAISONS[erreurs.dimensions] ?? erreurs.dimensions}</small>{/if}
					</label>
				{/if}
			</div>

			<div class="grid2">
				<label class="field" class:invalide={erreurs.prix_boutique}>
					<span>Prix boutique (€)</span>
					<input class="input" type="text" inputmode="decimal" autocomplete="off" bind:value={champs.prix_boutique} />
					{#if erreurs.prix_boutique}<small class="err">{RAISONS[erreurs.prix_boutique] ?? erreurs.prix_boutique}</small>{/if}
				</label>
				<label class="field" class:invalide={erreurs.prix_vinted}>
					<span>Prix Vinted (€, facultatif)</span>
					<input class="input" type="text" inputmode="decimal" autocomplete="off" bind:value={champs.prix_vinted} />
					{#if erreurs.prix_vinted}<small class="err">{RAISONS[erreurs.prix_vinted] ?? erreurs.prix_vinted}</small>{/if}
				</label>
			</div>

			<div class="grid2">
				<label class="field" class:invalide={erreurs.prix_achat}>
					<span>Prix d'achat (€, facultatif)</span>
					<input class="input" type="text" inputmode="decimal" autocomplete="off" bind:value={champs.prix_achat} />
					{#if erreurs.prix_achat}<small class="err">{RAISONS[erreurs.prix_achat] ?? erreurs.prix_achat}</small>{/if}
				</label>
				<label class="field" class:invalide={erreurs.date_achat}>
					<span>Date d'achat (facultatif)</span>
					<input class="input" type="date" max={aujourdhui()} bind:value={champs.date_achat} />
					{#if erreurs.date_achat}<small class="err">{RAISONS[erreurs.date_achat] ?? erreurs.date_achat}</small>{/if}
				</label>
			</div>

			<label class="field" class:invalide={erreurs.localisation}>
				<span>Emplacement (facultatif)</span>
				<select class="input" bind:value={champs.localisation}>
					<option value="">Choisir…</option>
					{#each ctx.lieux as l (l)}<option value={l}>{l}</option>{/each}
				</select>
				{#if erreurs.localisation}<small class="err">{RAISONS[erreurs.localisation] ?? erreurs.localisation}</small>{/if}
			</label>

			<div class="field">
				<span>Photos ({photos.length} / {ctx.photosMax})</span>
				<label class="btn" class:disabled={photos.length >= ctx.photosMax}>
					<input type="file" accept="image/*" multiple hidden onchange={ajouterPhotos} disabled={photos.length >= ctx.photosMax} />
					Ajouter des photos
				</label>
				<div class="photos">
					{#each photos as p, i (p.apercu)}
						<div class="vignette">
							<img src={p.apercu} alt="" />
							<button type="button" class="btn sm icon" aria-label="Retirer la photo" onclick={() => photos.splice(i, 1)}>x</button>
						</div>
					{/each}
				</div>
				{#if erreurPhotos}<small class="err">{erreurPhotos}</small>{/if}
			</div>

			<button class="btn primary" type="submit" disabled={occupe}>Enregistrer la pièce</button>
			<p class="discret" aria-live="polite">{progres}</p>
		</form>
	{:else if session.connecte}
		<p class="discret">Chargement…</p>
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
	h2,
	h3 {
		margin: 0;
	}
	h2 {
		font-size: 18px;
	}
	form {
		display: grid;
		gap: 12px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.choix {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.choix input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.choix span {
		display: block;
		text-align: center;
		padding: 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel);
		font-weight: 600;
		cursor: pointer;
	}
	.choix input:checked + span {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	.choix input:focus-visible + span {
		outline: 3px solid var(--accent-soft);
	}
	.invalide .input {
		border-color: #b3261e;
	}
	.err {
		color: #b3261e;
	}
	.bandeau {
		padding: 10px 12px;
		border-radius: 8px;
		background: #fdecea;
		color: #b3261e;
	}
	.info {
		padding: 10px 12px;
		border-radius: 8px;
		background: var(--accent-soft);
	}
	.discret {
		margin: 0;
		color: var(--muted);
		min-height: 1.4em;
	}
	.photos {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.vignette {
		position: relative;
		aspect-ratio: 1 / 1;
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}
	.vignette img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.vignette button {
		position: absolute;
		top: 4px;
		right: 4px;
	}
	.succes {
		display: grid;
		gap: 12px;
	}
	.identifiant {
		font-size: 26px;
		font-weight: 700;
		word-break: break-all;
	}
	.btn.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
