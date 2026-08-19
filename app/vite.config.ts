import { defineConfig, type Plugin } from 'vite';

import { alsCss } from './src/design/tokens.ts';

/**
 * Macht aus src/design/tokens.ts echtes CSS.
 *
 * Der Umweg ueber ein virtuelles Modul haelt die Tokens als einzige Quelle und
 * liefert sie trotzdem als statische Datei aus: wuerde man sie zur Laufzeit per
 * JavaScript auf `:root` schreiben, saehe man beim Laden kurz die ungestylte
 * Seite.
 */
function tokenPlugin(): Plugin {
  const id = 'virtual:tokens.css';
  const aufgeloest = `\0${id}`;
  return {
    name: 'klartext-tokens',
    resolveId: (quelle) => (quelle === id ? aufgeloest : null),
    load: (angefragt) => (angefragt === aufgeloest ? alsCss() : null),
  };
}

export default defineConfig({
  plugins: [tokenPlugin()],
  build: {
    target: 'es2022',
    // Der Krypto-Worker soll ein eigener, erkennbarer Chunk bleiben — das ist
    // die Grundlage der Zusicherung "openpgp liegt nicht im Haupt-Bundle".
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
    sourcemap: false,
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/krypto-worker-[hash].js',
        chunkFileNames: 'assets/krypto-[name]-[hash].js',
      },
    },
  },
});
