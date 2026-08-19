import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // RSA-4096 und Argon2 sind absichtlich teuer. Die Voreinstellung von 5 s
    // reicht dafuer nicht — und ein Test, der an der Uhr scheitert statt an der
    // Sache, ist schlimmer als kein Test.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
