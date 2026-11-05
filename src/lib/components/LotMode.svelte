<script lang="ts">
	import { Bluetooth, CircleAlert, CircleCheck, Plug, Printer, Tag, Unplug, Usb } from 'lucide-static';
	import Icon from './Icon.svelte';
	import LabelPicker from './LabelPicker.svelte';
	import ConnectHelp from './ConnectHelp.svelte';
	import { printer } from '../stores/printer.svelte';
	import { editor } from '../stores/editor.svelte';
	import { mode } from '../stores/mode.svelte';
	import {
		buildLotDesign, celluleEnTexte, CONFIG_DEFAUT, construireRows, fusionner, resoudre, tableToDonnees, textToTable,
		type Disposition, type Donnees, type LotConfig, type LotRow, type QrMode
	} from '../design/lot';
	import { bitmapToCanvas, renderBitmap } from '../design/render';
	import type { LabelSpec } from '../printer/types';

	const KEY = 'treize-etiquettes:lot';
	const APERCU_MAX = 6;
	const LOT_TAILLE = 20;

	function lire(): string {
		try {
			return localStorage.getItem(KEY) ?? '';
		} catch {
			return '';
		}
	}
	function lireCfg(): LotConfig {
		try {
			const v = JSON.parse(localStorage.getItem(KEY + ':cfg') ?? 'null');
			if (v && typeof v.qr === 'string') return { ...CONFIG_DEFAUT, qr: v.qr, statut: typeof v.statut === 'string' ? v.statut : CONFIG_DEFAUT.statut };
		} catch {
			// Reglages illisibles : on repart des valeurs par defaut.
		}
		return { ...CONFIG_DEFAUT };
	}
	function lirePref(): Disposition {
		try {
			const v = localStorage.getItem(KEY + ':disposition');
			if (v === 'dessous' || v === 'dessus' || v === 'droite' || v === 'gauche' || v === 'aucun') return v;
		} catch {
			// Stockage indisponible.
		}
		return 'dessous';
	}
	let brut = $state(lire());
	let fichier = $state<Donnees | null>(null);
	let cfg = $state<LotConfig>(lireCfg());
		let source = $state('');
	let marge = $state(1.0);
	let qrMode = $state<QrMode>('sure');
	let disposition = $state<Disposition>(lirePref());
	let filtre = $state('');
	let statutFiltre = $state('');
	let decoches = $state<Set<string>>(new Set());
	let survol = $state(false);
	let rendu = $state(false);
	let message = $state('');
	let fait = $state(false);
	let canvases: HTMLCanvasElement[] = $state([]);

	// Les lignes viennent du fichier depose s'il y en a un, sinon du texte colle.
	const donnees = $derived<Donnees>(fichier ?? tableToDonnees(textToTable(brut)));
	const entetes = $derived(donnees.entetes);
	// Colonne du QR : celle choisie si elle existe, sinon ID, sinon la 1re colonne.
	const colQr = $derived(resoudre(entetes, cfg.qr) || resoudre(entetes, 'ID') || entetes[0] || '');
	const cfgEff = $derived<LotConfig>({ ...cfg, qr: colQr });
	const rows = $derived(construireRows(donnees, cfgEff));
	const statuts = $derived([...new Set(rows.map((r) => r.statut).filter(Boolean))].sort());
	const motifs = $derived(
		filtre
			.toLowerCase()
			.split(/[\s,;]+/)
			.filter(Boolean)
	);
	const visibles = $derived(
		rows.filter((r) => {
			if (statutFiltre && r.statut !== statutFiltre) return false;
			if (!motifs.length) return true;
			const h = (r.id + ' ' + r.statut).toLowerCase();
			return motifs.some((m) => h.includes(m));
		})
	);
	const choisies = $derived(rows.filter((r) => !decoches.has(r.id)));
	const aImprimer = $derived(choisies);
	const errors = $derived(printer.status?.errors ?? []);

	// Nouvelle liste : tout est coche, sauf les pieces deja vendues.
	let dernierJeu = '';
	$effect(() => {
		const cle = rows.map((r) => r.id + '\u0001' + r.statut).join('|');
		if (cle === dernierJeu) return;
		dernierJeu = cle;
		decoches = new Set(rows.filter((r) => /^vendu/i.test(r.statut)).map((r) => r.id));
	});

	$effect(() => {
		const v = brut;
		try {
			localStorage.setItem(KEY, v);
		} catch {
			// Stockage indisponible : le texte ne survivra pas au rechargement.
		}
	});

	$effect(() => {
		const v = JSON.stringify($state.snapshot(cfg));
		try {
			localStorage.setItem(KEY + ':cfg', v);
		} catch {
			// Stockage indisponible.
		}
	});

	$effect(() => {
		const v = disposition;
		try {
			localStorage.setItem(KEY + ':disposition', v);
		} catch {
			// Stockage indisponible.
		}
	});

	function basculer(id: string) {
		const n = new Set(decoches);
		if (n.has(id)) n.delete(id);
		else n.add(id);
		decoches = n;
	}
	function cocherVisibles(oui: boolean) {
		const n = new Set(decoches);
		for (const r of visibles) {
			if (oui) n.delete(r.id);
			else n.add(r.id);
		}
		decoches = n;
	}

	async function lireFichier(f: File) {
		message = '';
		try {
			const nom = f.name.toLowerCase();
			if (nom.endsWith('.xlsx')) {
				const { default: readXlsxFile, readSheetNames } = await import('read-excel-file');
				const feuilles = await readSheetNames(f);
				const choix = feuilles.filter((n) => /^(fripes|broc)$/i.test(n));
				const cibles = choix.length ? choix : feuilles.slice(0, 1);
				const parOnglet: Donnees[] = [];
				for (const nomFeuille of cibles) {
					const lignes = await readXlsxFile(f, { sheet: nomFeuille });
					if (!lignes.length) continue;
					const conv = lignes.map((l) => l.map((c) => celluleEnTexte(c, false)));
					// Chaque onglet est lu avec son propre en-tete (FRIPES et BROC n'ont pas les memes colonnes).
					parOnglet.push(tableToDonnees(conv));
				}
				fichier = fusionner(parOnglet);
				source = `${f.name} (${cibles.join(', ')})`;
			} else {
				fichier = tableToDonnees(textToTable(await f.text()));
				source = f.name;
			}
		} catch (e) {
			console.error(e);
			message = 'Fichier illisible : ' + (e as Error).message;
		}
	}
	function surDepot(e: DragEvent) {
		e.preventDefault();
		survol = false;
		const f = e.dataTransfer?.files?.[0];
		if (f) void lireFichier(f);
	}
	function surChoix(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (f) void lireFichier(f);
	}
	function vider() {
		fichier = null;
		source = '';
		brut = '';
	}

	function options() {
		const l = $state.snapshot(editor.label) as LabelSpec;
		const u = printer.unprintable(l);
		return { l, o: { marge, nonImprimableMm: u?.mm ?? 0, dpmm: printer.dpmm, qrMode, disposition } };
	}

	async function bitmap(row: LotRow, l: LabelSpec, o: ReturnType<typeof options>['o']) {
		const size = printer.canvasSize(l);
		return renderBitmap({ elements: buildLotDesign(row, l, o) }, l.lengthMm, l.widthMm, size.width, size.height, printer.dpmm);
	}

	// Apercu des premieres etiquettes choisies : les points exacts imprimes.
	let jeton = 0;
	$effect(() => {
		const { l, o } = options();
		const liste = $state.snapshot(aImprimer).slice(0, APERCU_MAX);
		const mon = ++jeton;
		void (async () => {
			for (let i = 0; i < liste.length; i++) {
				const bmp = await bitmap(liste[i], l, o);
				if (mon !== jeton || !canvases[i]) return;
				bitmapToCanvas(bmp, canvases[i]);
				// Facteur entier : un agrandissement fractionnaire rend l'apercu flou (l'impression, elle, est a 1 point pres).
				canvases[i].style.width = bmp.width * Math.max(1, Math.floor(640 / bmp.width)) + 'px';
			}
		})();
	});

	async function imprimer() {
		fait = false;
		message = '';
		rendu = true;
		try {
			const { l, o } = options();
			const liste = $state.snapshot(aImprimer);
			let n = 0;
			for (let i = 0; i < liste.length; i += LOT_TAILLE) {
				const pages = [];
				for (const row of liste.slice(i, i + LOT_TAILLE)) pages.push(await bitmap(row, l, o));
				rendu = false;
				message = `Impression ${n + 1}-${n + pages.length} sur ${liste.length}`;
				await printer.print(pages, l, { density: editor.density, copies: 1 });
				n += pages.length;
			}
			message = `${n} etiquette(s) imprimee(s)`;
			fait = true;
		} catch (e) {
			console.error(e);
			message = 'Erreur : ' + (e as Error).message;
		} finally {
			rendu = false;
		}
	}

	function connecter() {
		if (printer.bluetoothSupported) printer.connectBluetooth();
		else printer.connect();
	}
</script>

<svelte:window
	ondragover={(e) => {
		e.preventDefault();
		survol = true;
	}}
	ondragleave={(e) => {
		if (!e.relatedTarget) survol = false;
	}}
	ondrop={surDepot}
/>

<div class="lot" class:survol>
	<header>
		<div class="brand"><Icon svg={Tag} size={16} /> <b>TREIZE - Etiquettes en lot</b></div>
		<button class="btn sm ghost" onclick={() => mode.choose('quick')}>Etiquette seule</button>
	</header>

	<main>
		<section class="card">
			{#if printer.connected && printer.model}
				<div class="row">
					<span class="pill ok">{printer.model.name}</span>
					<button class="btn sm icon ghost" onclick={() => printer.disconnect()} aria-label="Deconnecter"><Icon svg={Unplug} size={15} /></button>
				</div>
			{:else if printer.state === 'connecting'}
				<div>Connexion...</div>
			{:else if printer.supported || printer.bluetoothSupported}
				<div class="row">
					{#if printer.bluetoothSupported}<button class="btn primary" onclick={() => printer.connectBluetooth()}><Icon svg={Bluetooth} size={16} /> Bluetooth</button>{/if}
					{#if printer.supported}<button class="btn" onclick={() => printer.connect()}><Icon svg={Usb} size={16} /> USB</button>{/if}
				</div>
				<ConnectHelp />
			{:else}
				<div class="note err"><Icon svg={CircleAlert} size={15} /> Ce navigateur ne gere ni Bluetooth ni USB. Utilise Chrome ou Edge.</div>
			{/if}
			{#if printer.error && !printer.connected}<div class="note err"><Icon svg={CircleAlert} size={15} /> {printer.error}</div>{/if}
		</section>

		<section class="card">
			<h3>Etiquette (ruban)</h3>
			<LabelPicker />
			<div class="row reglages">
				<label>
					QR
					<select class="input" bind:value={qrMode}>
						<option value="sure">Standard (correction M, zone libre)</option>
						<option value="max">Grand (modules les plus gros)</option>
					</select>
				</label>
				<label>
					ID
					<select class="input" bind:value={disposition}>
						<option value="dessous">Sous le QR (ruban 16 mm et plus)</option>
						<option value="dessus">Au-dessus du QR (ruban 16 mm et plus)</option>
						<option value="droite">A droite du QR</option>
						<option value="gauche">A gauche du QR</option>
						<option value="aucun">Pas d'ID : QR seul</option>
					</select>
				</label>
				<label>Marge (mm) <input class="input" type="number" min="0" max="4" step="0.1" bind:value={marge} /></label>
			</div>
		</section>

		<section class="card">
			<h3>Pieces</h3>
			<div class="depot">
				Depose un fichier ici (.xlsx, .csv, .tsv) ou
				<label class="btn sm"><input type="file" accept=".xlsx,.csv,.tsv,.txt" onchange={surChoix} hidden /> Choisir un fichier</label>
				{#if source}<span class="pill">{source}</span> <button class="btn sm ghost" onclick={vider}>Effacer</button>{/if}
			</div>
			{#if !fichier}
				<p class="aide">Ou colle les lignes depuis Sheets, avec la ligne d'en-tete (noms de colonnes). L'etiquette porte le QR et le numero d'ID.</p>
				<textarea class="input" rows="5" bind:value={brut} placeholder={'ID\tDESCRIPTION\tPRIX_BOUTIQUE\nFRI-VES-0001\tManteau laine vert\t59,00 EUR'}></textarea>
			{/if}
		</section>

		{#if entetes.length}
			<section class="card">
				<h3>Colonnes</h3>
				<div class="row reglages">
					<label>
						Colonne de l'ID (QR et numero)
						<select class="input" value={colQr} onchange={(e) => (cfg.qr = e.currentTarget.value)}>
							{#each entetes as h (h)}<option value={h}>{h}</option>{/each}
						</select>
					</label>
					<label>
						Colonne du statut (filtre)
						<select class="input" value={resoudre(entetes, cfg.statut)} onchange={(e) => (cfg.statut = e.currentTarget.value)}>
							<option value="">Aucune</option>
							{#each entetes as h (h)}<option value={h}>{h}</option>{/each}
						</select>
					</label>
				</div>
				{#if !rows.length}<div class="note err"><Icon svg={CircleAlert} size={15} /> Aucune valeur dans la colonne « {colQr} ».</div>{/if}
			</section>
		{/if}

		{#if rows.length}
			<section class="card">
				<h3>Selection : {choisies.length} sur {rows.length}</h3>
				<div class="row filtres">
					<input class="input" placeholder="Filtrer : ID, mots (separes par espace ou virgule)" bind:value={filtre} />
					{#if statuts.length}
						<select class="input" bind:value={statutFiltre}>
							<option value="">Tous les statuts</option>
							{#each statuts as s (s)}<option value={s}>{s}</option>{/each}
						</select>
					{/if}
				</div>
				<div class="row">
					<button class="btn sm" onclick={() => cocherVisibles(true)}>Cocher les {visibles.length} visibles</button>
					<button class="btn sm" onclick={() => cocherVisibles(false)}>Decocher les visibles</button>
				</div>
				<div class="liste">
					{#each visibles as r (r.id)}
						<label class="ligne" class:off={decoches.has(r.id)}>
							<input type="checkbox" checked={!decoches.has(r.id)} onchange={() => basculer(r.id)} />
							<span class="idc">{r.id}</span>
							{#if r.statut}<span class="pill">{r.statut}</span>{/if}
						</label>
					{/each}
				</div>
			</section>

			<section class="card">
				<h3>Apercu {aImprimer.length > APERCU_MAX ? `(${APERCU_MAX} premieres)` : ''}</h3>
				<div class="apercu">
					{#each aImprimer.slice(0, APERCU_MAX) as row, i (row.id)}
						<canvas bind:this={canvases[i]} aria-label={row.id}></canvas>
					{/each}
				</div>
			</section>
		{/if}
	</main>

	<footer>
		{#each errors as msg (msg)}<div class="note err"><Icon svg={CircleAlert} size={15} /> {msg}</div>{/each}
		{#if message}<div class="note" class:ok={fait}>{#if fait}<Icon svg={CircleCheck} size={15} />{/if} {message}</div>{/if}
		{#if printer.state === 'printing'}
			<button class="btn big" onclick={() => printer.cancel()}>Impression en cours - Annuler</button>
		{:else}
			<button class="btn primary big" onclick={printer.connected ? imprimer : connecter} disabled={printer.connected && (!aImprimer.length || rendu || errors.length > 0)}>
				<Icon svg={printer.connected ? Printer : Plug} size={18} />
				{printer.connected ? `Imprimer ${aImprimer.length} etiquette(s)` : 'Connecter l\'imprimante'}
			</button>
		{/if}
	</footer>
</div>

<style>
	.lot {
		max-width: 760px;
		margin: 0 auto;
		min-height: 100%;
		display: flex;
		flex-direction: column;
		outline: 3px dashed transparent;
		outline-offset: -6px;
	}
	.lot.survol {
		outline-color: var(--accent, #e8552b);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
	}
	.brand {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
	}
	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
	}
	.row {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.reglages label,
	.depot {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 13px;
		flex-wrap: wrap;
	}
	.reglages .input[type='number'] {
		width: 80px;
	}
	.aide {
		margin: 0;
		font-size: 12px;
		opacity: 0.75;
	}
	textarea {
		width: 100%;
		font-family: monospace;
		font-size: 12px;
		resize: vertical;
	}
	.filtres .input {
		flex: 1;
		min-width: 160px;
	}
	.liste {
		max-height: 320px;
		overflow-y: auto;
		border: 1px solid var(--line);
		border-radius: 8px;
	}
	.ligne {
		display: grid;
		grid-template-columns: 20px 1fr auto;
		gap: 8px;
		align-items: center;
		padding: 6px 10px;
		font-size: 13px;
		border-bottom: 1px solid var(--line);
		cursor: pointer;
	}
	.ligne.off {
		opacity: 0.45;
	}
	.idc {
		font-weight: 600;
		font-family: monospace;
	}
	.apercu {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	canvas {
		border: 1px solid var(--line);
		background: #fff;
		max-width: 100%;
		image-rendering: pixelated;
	}
	footer {
		position: sticky;
		bottom: 0;
		padding: 12px 16px;
		background: var(--panel);
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.note {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 13px;
	}
	.note.err {
		color: var(--err, #b3261e);
	}
	.big {
		padding: 12px;
		justify-content: center;
	}
</style>
