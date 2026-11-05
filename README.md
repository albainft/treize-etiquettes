# TREIZE - Etiquettes en lot

Impression d'etiquettes (QR de l'ID + description + prix) sur imprimante Supvan / Katasymbol, par lot, depuis un fichier Excel ou CSV.

Ouvrir : https://albainft.github.io/treize-etiquettes/

1. Chrome ou Edge (Safari ne gere pas le Bluetooth web).
2. Clique Bluetooth et choisis l'imprimante (nom T0...). Ferme l'application Katasymbol sur les autres appareils.
3. Depose un fichier .xlsx, .csv ou .tsv (ou colle des lignes depuis Sheets, 1re ligne = noms de colonnes). Choisis la colonne de l'ID (elle donne le QR et le numero imprime) et, si tu veux filtrer, la colonne du statut.
4. Coche les pieces a imprimer (les pieces Vendu sont decochees au depart), verifie l'apercu, imprime.

Le site ne contient aucune donnee : les fichiers restent dans le navigateur et ne sont envoyes nulle part.

Base : [khromov/supvan-katasymbol-printer-web-ui](https://github.com/khromov/supvan-katasymbol-printer-web-ui) (licence MIT, conservee), avec un mode Lot ajoute (`src/lib/design/lot.ts`, `src/lib/components/LotMode.svelte`).
