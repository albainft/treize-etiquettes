/** Mode Lot : une liste de pieces (ID, description, prix) devient une etiquette par ligne : QR de l'ID + texte. */
import qrcode from 'qrcode-generator';
import { newId, type DesignElement, type Rotation, type TextElement, type QrElement } from './model';
import type { LabelSpec } from '../printer/types';

export interface LotRow {
	id: string;
	description: string;
	prix: string;
	statut: string;
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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

/**
 * Tableau de cellules vers des pieces.
 * Avec une ligne d'en-tete contenant ID : colonnes ID, DESCRIPTION, MARQUE, TAILLE, PRIX_BOUTIQUE (ou PRIX), STATUT.
 * Sans en-tete : 1re colonne ID, 2e description, 3e prix.
 * Les lignes d'un meme ID ne comptent qu'une fois.
 */
export function tableToRows(table: string[][]): LotRow[] {
	if (!table.length) return [];
	let idx = { id: 0, description: 1, marque: -1, taille: -1, prix: 2, statut: -1 };
	let start = 0;
	const head = table[0].map((c) => strip(String(c ?? '')));
	if (head.includes('ID')) {
		const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
		idx = {
			id: head.indexOf('ID'),
			description: find('DESCRIPTION', 'DESIGNATION'),
			marque: find('MARQUE'),
			taille: find('TAILLE'),
			prix: find('PRIXBOUTIQUE', 'PRIX'),
			statut: find('STATUT')
		};
		start = 1;
	}
	const rows: LotRow[] = [];
	const vus = new Set<string>();
	for (let i = start; i < table.length; i++) {
		const c = table[i];
		const id = String(c[idx.id] ?? '').trim();
		if (!id || vus.has(id)) continue;
		vus.add(id);
		const get = (k: number) => (k >= 0 ? String(c[k] ?? '').trim() : '');
		const taille = get(idx.taille);
		const parts = [get(idx.description), get(idx.marque), taille ? 'T.' + taille : ''];
		rows.push({ id, description: parts.filter(Boolean).join(' '), prix: get(idx.prix), statut: get(idx.statut) });
	}
	return rows;
}

export const parseLot = (raw: string): LotRow[] => tableToRows(textToTable(raw));

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

function text(x: number, y: number, w: number, h: number, value: string, bold: boolean): TextElement {
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
		align: 'left',
		valign: 'middle',
		fit: true,
		lineHeight: 1.1
	};
}

export interface LotOptions {
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
	const q = tailleQr(row.id, dispo, vw * 0.45, o.dpmm, o.qrMode);
	const s = q.mm;
	const h = Math.max(1, vh - 2 * Math.max(marge, o.nonImprimableMm));
	const out: DesignElement[] = [];
	const qr: QrElement = { id: newId(), type: 'qr', x: marge, y: (vh - s) / 2, w: s, h: s, rotation: 0, value: row.id, ecc: q.ecc };
	out.push(qr);
	const tx = marge + s + 1.2;
	const tw = Math.max(1, vw - marge - tx);
	const lignes: [string, boolean, number][] = [[row.id, true, 0.32]];
	if (row.description) lignes.push([row.description, false, 0.4]);
	if (row.prix) lignes.push([row.prix, true, 0.28]);
	const total = lignes.reduce((a, l) => a + l[2], 0);
	let y = (vh - h) / 2;
	for (const [t, bold, part] of lignes) {
		const hh = (h * part) / total;
		out.push(text(tx, y, tw, hh, t, bold));
		y += hh;
	}
	if (!rotated) return out;
	// Repere de lecture -> etiquette : (vx, vy) -> (W - vy, vx), rotation +90.
	return out.map((el) => {
		const cx = el.x + el.w / 2;
		const cy = el.y + el.h / 2;
		return { ...el, x: W - cy - el.h / 2, y: cx - el.w / 2, w: el.h, h: el.w, rotation: ((el.rotation + 90) % 360) as Rotation };
	});
}
