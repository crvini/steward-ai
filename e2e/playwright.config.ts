import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de punta a punta de Steward AI.
 *
 * Por defecto corren contra el entorno local (`pnpm dev` levantado). Para
 * apuntar a producción: `npm run test:prod`.
 *
 * Están divididas en dos proyectos a propósito:
 *
 * - **lectura**: navegan y verifican. No crean nada en PayPal. Son las que
 *   conviene correr en cada cambio y las que podrían ir a CI.
 * - **escritura**: crean órdenes de verdad en el sandbox de PayPal. Se piden
 *   a mano (`npm run test:escritura`) porque dejan rastro en la cuenta y
 *   gastan llamadas a la API.
 *
 * Ninguna puede completar un pago: eso exige iniciar sesión con una cuenta
 * de comprador de sandbox, y no automatizamos credenciales de PayPal. Las
 * pruebas llegan hasta el momento en que el checkout toma el control.
 */
const baseURL = process.env.STEWARD_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  // Producción responde por red; local es inmediato. El tope cubre las dos.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Un solo worker a propósito. Las pruebas comparten una base sembrada y un
  // servidor de desarrollo; en paralelo aparecían fallos que no se reproducían
  // al correrlas solas. La suite tarda ~12s, así que determinismo sale barato
  // — y un fallo intermitente esconde los de verdad.
  workers: 1,
  // El arranque del SDK de PayPal fue intermitente una vez: un reintento
  // escondería justo el fallo que estas pruebas existen para detectar.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    locale: 'es-GT',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'lectura',
      testIgnore: /escritura\//,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'escritura',
      testMatch: /escritura\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
