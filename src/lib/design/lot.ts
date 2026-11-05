/** Mode Lot : une liste de pieces devient une etiquette par ligne : le QR et le numero d'ID. */
import qrcode from 'qrcode-generator';
import { newId, type DesignElement, type Rotation, type TextElement, type QrElement } from './model';
import type { LabelSpec } from '../printer/types';

/** Un fichier ou un texte colle : la 1re ligne donne les noms de colonnes. */
export interface Donnees {
	entetes: string[];
	lignes: Record<string, string>[];
}

export interface LotConfig {
	/** Colonne dont la valeur est encodee dans le QR et imprimee sous forme de numero. */
	qr: string;
	/** Colonne du statut, pour le filtre (vide : pas de filtre par statut). */
	statut: string;
}

export const CONFIG_DEFAUT: LotConfig = { qr: 'ID', statut: 'STATUT' };

export interface LotRow {
	id: string;
	statut: string;
}

/** Comparaison de noms de colonnes : sans accents, sans casse, sans ponctuation. */
export const cle = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function split(line: string, sep: string): string[] {
	return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
}

/** Texte colle ou fichier texte (CSV, TSV) vers un tableau de cellules. */
export function textToTable(raw: string): string[][] {
	const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
	if (!lines.length) return [];
	const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
	return lines.map((l) => split(l, sep));
}

/** Tableau de cellules vers des donnees : la 1re ligne est l'en-tete. Noms vides ou doubles rendus uniques. */
export function tableToDonnees(table: string[][]): Donnees {
	if (table.length < 1) return { entetes: [], lignes: [] };
	const vus = new Map<string, number>();
	const entetes = table[0].map((h, i) => {
		let nom = String(h ?? '').trim() || `COLONNE ${i + 1}`;
		const n = (vus.get(nom) ?? 0) + 1;
		vus.set(nom, n);
		if (n > 1) nom = `${nom} (${n})`;
		return nom;
	});
	const lignes = table.slice(1).map((c) => {
		const rec: Record<string, string> = {};
		entetes.forEach((h, j) => (rec[h] = String(c[j] ?? '').trim()));
		return rec;
	});
	return { entetes, lignes };
}

/** Plusieurs onglets : colonnes en commun regroupees par nom, les autres ajoutees a la suite. */
export function fusionner(liste: Donnees[]): Donnees {
	const entetes: string[] = [];
	const lignes: Record<string, string>[] = [];
	for (const d of liste) {
		for (const h of d.entetes) if (!entetes.includes(h)) entetes.push(h);
		lignes.push(...d.lignes);
	}
	return { entetes, lignes };
}

/** Nom exact de colonne pour un nom approximatif (ID, id, Prix boutique...), ou chaine vide. */
export function resoudre(entetes: string[], nom: string): string {
	const k = cle(nom);
	return k ? (entetes.find((h) => cle(h) === k) ?? '') : '';
}

/** Donnees + colonne d'ID vers des pieces. Une valeur de QR n'apparait qu'une fois. */
export function construireRows(d: Donnees, cfg: LotConfig): LotRow[] {
	const colQr = resoudre(d.entetes, cfg.qr);
	if (!colQr) return [];
	const colStatut = resoudre(d.entetes, cfg.statut);
	const rows: LotRow[] = [];
	const vus = new Set<string>();
	for (const rec of d.lignes) {
		const id = (rec[colQr] ?? '').trim();
		if (!id || vus.has(id)) continue;
		vus.add(id);
		rows.push({ id, statut: colStatut ? (rec[colStatut] ?? '') : '' });
	}
	return rows;
}

/** Cellule Excel (nombre, date, texte) en texte ; un prix numerique devient "59,00 EUR". */
export function celluleEnTexte(v: unknown, estPrix: boolean): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'number') return estPrix ? v.toFixed(2).replace('.', ',') + ' €' : String(v);
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	return String(v);
}

export type QrMode = 'sure' | 'max';

function modules(valeur: string, ecc: 'L' | 'M'): number {
	const q = qrcode(0, ecc);
	q.addData(valeur || ' ');
	q.make();
	return q.getModuleCount();
}

/**
 * Taille du QR en mm et niveau de correction. La taille est un multiple entier de points par module
 * (pas de modules de largeur inegale a l'impression).
 * - sure : correction M, au moins 1 module libre de chaque cote dans la zone imprimable (le ruban blanc fait le reste) ;
 * - max : correction L (moins de modules), modules les plus gros possible dans la zone imprimable.
 */
export function tailleQr(valeur: string, dispoMm: number, largeurMaxMm: number, dpmm: number, qrMode: QrMode) {
	const ecc = qrMode === 'max' ? 'L' : 'M';
	const n = modules(valeur, ecc);
	const dispoPts = Math.min(dispoMm, largeurMaxMm) * dpmm;
	const k = Math.max(1, Math.floor(qrMode === 'max' ? (dispoPts - 1) / n : dispoPts / (n + 2)));
	// +0.25 point : evite qu'un arrondi flottant fasse perdre un point par module au rendu.
	return { ecc: ecc as 'L' | 'M', mm: (n * k + 0.25) / dpmm, pointsParModule: k, modules: n };
}

function text(x: number, y: number, w: number, h: number, value: string, bold: boolean, align: 'left' | 'center' | 'right' = 'left'): TextElement {
	return {
		id: newId(),
		type: 'text',
		x,
		y,
		w,
		h,
		rotation: 0,
		text: value,
		font: 'Inter',
		size: 8,
		bold,
		italic: false,
		align,
		valign: 'middle',
		fit: true,
		lineHeight: 1.1
	};
}

/** Ou s'affiche le numero d'ID par rapport au QR (ou pas du tout). */
export type Disposition = 'dessous' | 'dessus' | 'droite' | 'gauche' | 'droiteV' | 'gaucheV' | 'aucun';

/** Hauteur minimale (mm) pour mettre l'ID sous le QR ; en dessous, le texte serait trop petit : l'ID passe a cote. */
export const HAUTEUR_MIN_DESSOUS = 16;


export interface LotOptions {
	disposition: Disposition;
	/** Marge autour du contenu (mm). */
	marge: number;
	/** Bande non imprimable de chaque cote de l'axe court (mm). */
	nonImprimableMm: number;
	dpmm: number;
	qrMode: QrMode;
}

/**
 * Elements d'une etiquette, dans le repere du design (lengthMm x widthMm).
 * L'etiquette est composee a l'horizontale ; si elle est en portrait, tout est tourne de 90 degres.
 */
export function buildLotDesign(row: LotRow, label: LabelSpec, o: LotOptions): DesignElement[] {
	const W = label.lengthMm;
	const rotated = label.lengthMm < label.widthMm;
	const vw = rotated ? label.widthMm : label.lengthMm;
	const vh = rotated ? label.lengthMm : label.widthMm;
	const marge = Math.max(o.marge, 0.3);
	const dispo = Math.max(1, vh - 2 * o.nonImprimableMm);
	const haut = Math.max(marge, o.nonImprimableMm);
	const h = Math.max(1, vh - 2 * haut);
	const out: DesignElement[] = [];
	// Sous ou sur le QR : il faut de la hauteur ; sur un ruban etroit l'ID passe a droite.
	const vertical = o.disposition === 'dessous' || o.disposition === 'dessus';
	const disp: Disposition = vertical && vh < HAUTEUR_MIN_DESSOUS ? 'droite' : o.disposition;
	const qrEl = (x: number, y: number, s: number, ecc: 'L' | 'M') =>
		({ id: newId(), type: 'qr', x, y, w: s, h: s, rotation: 0, value: row.id, ecc }) as QrElement;
	if (disp === 'aucun') {
		const q = tailleQr(row.id, dispo, vw - 2 * marge, o.dpmm, o.qrMode);
		out.push(qrEl((vw - q.mm) / 2, (vh - q.mm) / 2, q.mm, q.ecc));
	} else if (disp === 'dessous' || disp === 'dessus') {
		// QR centre, numero d'ID centre au-dessus ou en dessous (le texte se reduit pour tenir en largeur).
		const hTexte = Math.min(6, Math.max(3.5, vh * 0.22));
		const ecart = 0.8;
		const q = tailleQr(row.id, Math.max(1, h - hTexte - ecart), vw - 2 * marge, o.dpmm, o.qrMode);
		const y0 = (vh - (q.mm + ecart + hTexte)) / 2;
		const yTexte = disp === 'dessous' ? y0 + q.mm + ecart : y0;
		const yQr = disp === 'dessous' ? y0 : y0 + hTexte + ecart;
		out.push(qrEl((vw - q.mm) / 2, yQr, q.mm, q.ecc));
		out.push(text(marge, yTexte, vw - 2 * marge, hTexte, row.id, true, 'center'));
	} else if (disp === 'droiteV' || disp === 'gaucheV') {
		// ID vertical (lu de bas en haut) a cote du QR, sur toute la hauteur utile ; le groupe est centre.
		const q = tailleQr(row.id, dispo, vw * 0.6, o.dpmm, o.qrMode);
		const epaisseur = Math.min(6, Math.max(1, vw - 2 * marge - q.mm - 1.2));
		const x0 = (vw - (q.mm + 1.2 + epaisseur)) / 2;
		const xQr = disp === 'droiteV' ? x0 : x0 + epaisseur + 1.2;
		const cxTexte = disp === 'droiteV' ? x0 + q.mm + 1.2 + epaisseur / 2 : x0 + epaisseur / 2;
		// Position du QR calee sur un point d'impression : pas de modules de largeur inegale.
		const snap = (v: number) => Math.round(v * o.dpmm) / o.dpmm;
		out.push(qrEl(snap(xQr), snap((vh - q.mm) / 2), q.mm, q.ecc));
		// Pour un quart de tour, x, y, w, h decrivent l'encombrement apres rotation (epaisseur x hauteur).
		const t = text(cxTexte - epaisseur / 2, (vh - h) / 2, epaisseur, h, row.id, true, 'center');
		t.rotation = 270;
		out.push(t);
	} else {
		// A droite ou a gauche du QR, sur toute la hauteur utile.
		const q = tailleQr(row.id, dispo, vw * 0.45, o.dpmm, o.qrMode);
		const largeurTexte = Math.max(1, vw - 2 * marge - q.mm - 1.2);
		if (disp === 'droite') {
			out.push(qrEl(marge, (vh - q.mm) / 2, q.mm, q.ecc));
			out.push(text(marge + q.mm + 1.2, (vh - h) / 2, largeurTexte, h, row.id, true));
		} else {
			out.push(qrEl(vw - marge - q.mm, (vh - q.mm) / 2, q.mm, q.ecc));
			out.push(text(marge, (vh - h) / 2, largeurTexte, h, row.id, true, 'right'));
		}
	}
	if (!rotated) return out;
	// Repere de lecture -> etiquette : (vx, vy) -> (W - vy, vx), rotation +90.
	return out.map((el) => {
		const cx = el.x + el.w / 2;
		const cy = el.y + el.h / 2;
		return { ...el, x: W - cy - el.h / 2, y: cx - el.w / 2, w: el.h, h: el.w, rotation: ((el.rotation + 90) % 360) as Rotation };
	});
}
