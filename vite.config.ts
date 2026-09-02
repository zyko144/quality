import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// La version vient du paquet : la recopier dans le code la laisserait
// diverger au premier oubli.
const { version } = createRequire(import.meta.url)('./package.json') as { version: string };

/**
 * Les nouveautes de cette version, prises dans `NOUVEAUTES.md`.
 *
 * Embarquees dans le binaire plutot que demandees au reseau : le message doit
 * s'afficher au premier lancement apres une mise a jour, y compris quand
 * celle-ci est arrivee par une installation manuelle — auquel cas
 * l'application n'a jamais parle au serveur de publication.
 *
 * L'atelier de publication lit le meme fichier pour le texte de la release.
 * Une seule source, donc pas de divergence possible entre ce que la page
 * annonce et ce que l'application raconte.
 */
function notesDeVersion(): string {
  return toutesLesNotes().find((entree) => entree.version === version)?.notes ?? '';
}

/**
 * TOUTES les sections de `NOUVEAUTES.md`, de la plus recente a la plus ancienne.
 *
 * Embarquer la seule version courante avait une consequence qu'on ne voit pas
 * en la posant : qui saute trois versions n'apprend jamais ce que les deux
 * intermediaires ont apporte. Or c'est le cas le plus frequent — on laisse
 * passer une mise a jour, puis deux, et le jour ou l'on redemarre on ne voit
 * que la derniere.
 *
 * Les vingt dernieres suffisent largement : au-dela personne ne lit, et le
 * poids embarque cesse d'etre negligeable.
 */
function toutesLesNotes(): { version: string; notes: string }[] {
  try {
    const document = readFileSync(new URL('./NOUVEAUTES.md', import.meta.url), 'utf8');

    // Decoupe sur les titres plutot qu'une expression reguliere a echappements :
    // le numero de version contient des points, qu'il faudrait proteger, et
    // l'erreur ne se verrait qu'a l'execution — sur un message manquant.
    return document
      .split(/^## /m)
      .slice(1)
      .map((bloc) => ({
        version: bloc.split('\n', 1)[0]?.trim() ?? '',
        notes: bloc.split('\n').slice(1).join('\n').trim(),
      }))
      .filter((entree) => VERSION_ATTENDUE.test(entree.version) && entree.notes.length > 0)
      .slice(0, 20);
  } catch {
    // Fichier absent : le message ne s'affichera pas, ce qui vaut mieux qu'un
    // message vide.
    return [];
  }
}

/** Un numero de version, et rien d'autre : les titres libres sont ecartes. */
const VERSION_ATTENDUE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export default defineConfig({
  plugins: [
    react(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_NOTES__: JSON.stringify(notesDeVersion()),
    // L'historique, pour que qui saute trois versions les voie toutes les trois.
    __APP_HISTORIQUE__: JSON.stringify(toutesLesNotes()),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  build: {
    target: 'es2022',
    // Le client Supabase et React changent bien moins souvent que le code de
    // l'application : les isoler garde leur cache valide entre deux deploiements.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
