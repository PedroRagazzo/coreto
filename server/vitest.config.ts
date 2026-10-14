import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    // Os testes de integração compartilham um banco e o apagam a cada arquivo: um arquivo por vez.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
