import { expect, test } from '@playwright/test';

import { cerrarSesion, entrarComo, irAPestaña, PERSONAS } from './ayudas';

test('la auditoría cuenta las diferencias en los dos sentidos', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);

  const r = (await page.request.get('/api/paypal/reconcile?days=30').then((x) => x.json())) as {
    missingLocally: unknown[];
    unconfirmedLocally: unknown[];
    differences: number;
    inSync: boolean;
  };

  // Los dos sentidos significan cosas distintas y el total tiene que sumarlos.
  expect(r.differences).toBe(r.missingLocally.length + r.unconfirmedLocally.length);
  expect(r.inSync).toBe(r.differences === 0);
});

test('la pestaña de auditoría muestra la ofrenda sin confirmar del seed', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);
  await irAPestaña(page, /^auditoría$/i);

  await expect(page.getByRole('heading', { name: /auditoría contra paypal/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/sin confirmar por paypal/i)).toBeVisible();
});

test('el aviso del auditor cuadra con las filas sin referencia', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);
  await irAPestaña(page, /^libros$/i);

  const { rows } = (await page.request.get('/api/ledger').then((r) => r.json())) as {
    rows: { direction: string; inPayPal: boolean }[];
  };
  const sinConfirmar = rows.filter((r) => r.direction === 'IN' && !r.inPayPal).length;

  if (sinConfirmar > 0) {
    await expect(page.getByText(/el auditor encontró/i)).toBeVisible();
  } else {
    await expect(page.getByText(/el auditor encontró/i)).toHaveCount(0);
  }
});

test('la API de conciliación rechaza ventanas mayores a 31 días', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);

  // Transaction Search de PayPal no admite rangos mayores; pedir 90 días
  // debe fallar acá y no explotar contra PayPal.
  expect((await page.request.get('/api/paypal/reconcile?days=90')).status()).toBe(400);
});
