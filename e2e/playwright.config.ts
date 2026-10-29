import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: 'tests',
  // Todos os testes dividem um servidor e um banco; cada um cria as próprias contas com nomes únicos.
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Microfone falso (um tom) e sem pedido de permissão: dá para entrar numa chamada sem ninguém por trás.
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [
    {
      name: 'chromium',
      // Localmente, `E2E_BROWSER=msedge` (ou `chrome`) usa o navegador já instalado, sem baixar nada.
      use: { ...devices['Desktop Chrome'], ...(process.env.E2E_BROWSER ? { channel: process.env.E2E_BROWSER } : {}) },
    },
  ],
  webServer: {
    command: 'npx tsx e2e/start-server.ts',
    cwd: '..',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
