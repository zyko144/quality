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
  try {
    const document = readFileSync(new URL('./NOUVEAUTES.md', import.meta.url), 'utf8');

    // Decoupe sur les titres plutot qu'une expression reguliere a echappements :
    // le numero de version contient des points, qu'il faudrait proteger, et
    // l'erreur ne se verrait qu'a l'execution — sur un message manquant.
    const sections = document.split(/^## /m).slice(1);
    const voulue = sections.find((bloc) => bloc.split('\n', 1)[0]?.trim() === version);

    return (voulue ?? '').split('\n').slice(1).join('\n').trim();
  } catch {
    // Fichier absent ou version sans section : le message ne s'affichera pas,
    // ce qui vaut mieux qu'un message vide.
    return '';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_NOTES__: JSON.stringify(notesDeVersion()),
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
