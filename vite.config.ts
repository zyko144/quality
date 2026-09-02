import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
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
  plugins: [
    react(),

    /*
     * L'application s'installe sur un telephone.
     *
     * Il a existe un second projet, `mobile/`, qui reecrivait a la main six
     * ecrans sur vingt et une fonctionnalites. Il a ete supprime, et ce n'est
     * pas une economie de place : deux copies d'une meme application divergent,
     * toujours, et c'est la copie la plus pauvre qui recoit les corrections en
     * dernier — ou jamais. Celle-ci n'avait ni amis, ni moderation, ni
     * recherche, ni parametres.
     *
     * L'application de bureau est deja faite pour les petits ecrans, et
     * eprouvee sur un telephone : `responsive.mobile.spec.ts` et
     * `drawer.mobile.spec.ts` tournent sur un Pixel 7. Il ne manquait que de
     * quoi la poser sur l'ecran d'accueil.
     */
    VitePWA({
      // Le service ouvrier se met a jour tout seul. Sans cela, un telephone
      // garde la version installee indefiniment, et l'on corrige des defauts
      // que personne ne recoit.
      registerType: 'autoUpdate',
      manifest: {
        name: 'Echow',
        short_name: 'Echow',
        description: 'Echow — la discussion d’equipe en temps reel.',
        lang: 'fr',
        theme_color: '#6366f1',
        background_color: '#0f0f12',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        /*
         * Le paquet depasse la limite par defaut de deux megaoctets.
         *
         * Sans cette ligne, le fichier principal est ecarte du cache en
         * silence : l'application s'installe, puis reste blanche hors ligne —
         * le pire des deux mondes, puisqu'elle promet alors ce qu'elle ne tient
         * pas.
         */
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            /*
             * Le reseau d'abord pour les donnees.
             *
             * Une conversation servie depuis le cache serait une conversation
             * perimee, et rien ne le dirait. Le cache n'est ici qu'un filet
             * pour les cinq minutes qui suivent une coupure.
             */
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ],
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
