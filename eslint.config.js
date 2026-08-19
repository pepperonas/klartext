// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'fixtures/**', 'app/public/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Der ganze Punkt dieser App: keine stillen any-Loecher im Krypto-Pfad.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // innerHTML ist in dieser App verboten (Trusted Types, siehe THREAT-MODEL.md).
      'no-restricted-properties': ['error',
        { object: 'document', property: 'write', message: 'verboten' },
        { property: 'innerHTML', message: 'innerHTML ist verboten — Trusted Types. Nutze textContent / createElement.' },
        { property: 'outerHTML', message: 'outerHTML ist verboten — siehe innerHTML.' },
      ],
      'no-restricted-globals': ['error',
        { name: 'localStorage', message: 'Kein Schluesselmaterial und keine Passphrase ausserhalb des Vaults.' },
        { name: 'sessionStorage', message: 'Kein Schluesselmaterial und keine Passphrase ausserhalb des Vaults.' },
      ],
    },
  },
  {
    // Der Anwendungscode laeuft im Browser. Ein `node:`-Import waere dort ein
    // Laufzeitfehler — und ein Hinweis darauf, dass jemand Serverlogik
    // hereingezogen hat, wo keine hingehoert.
    files: ['app/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['node:*'], message: 'Kein Node-API im Browser-Code.' }],
      }],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        // Node-Seite der Werkzeugskripte …
        console: 'readonly', process: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', URL: 'readonly', Buffer: 'readonly',
        // … und die Browser-Seite: die Rueckrufe von page.evaluate() und
        // addInitScript() stehen zwar in dieser Datei, laufen aber im Browser.
        document: 'readonly', globalThis: 'readonly', navigator: 'readonly',
        location: 'readonly', WebSocket: 'readonly', EventSource: 'readonly',
        getComputedStyle: 'readonly', btoa: 'readonly', atob: 'readonly',
        OffscreenCanvas: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
        window: 'readonly',
      },
    },
  },
);
