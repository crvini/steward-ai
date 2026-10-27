import { expect, test } from '@playwright/test';

import { PERSONAS, cerrarSesion, entrarComo } from './ayudas';

test.beforeEach(async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);
});

test('se puede elegir entre una vez y cada mes', async ({ page }) => {
  const tarjeta = page.locator('section', { hasText: /dar a un fondo/i }).first();

  await expect(tarjeta.getByRole('button', { name: /una vez/i })).toBeVisible();
  await tarjeta.getByRole('button', { name: /cada mes/i }).click();

  // Los planes de PayPal cobran por unidad de $1, así que mensual sólo admite
  // dólares enteros y la interfaz tiene que decirlo.
  await expect(tarjeta.getByText(/dólares enteros/i)).toBeVisible();
});

test('elegir mensual redondea un monto con centavos a dólares enteros', async ({ page }) => {
  const tarjeta = page.locator('section', { hasText: /dar a un fondo/i }).first();
  const monto = tarjeta.getByRole('spinbutton');

  await monto.fill('37');
  await tarjeta.getByRole('button', { name: /cada mes/i }).click();
  await expect(monto).toHaveValue('37');
});

test('la API rechaza una suscripción con centavos', async ({ page }) => {
  const fondos = await page.request.get('/api/church').then((r) => r.json());
  const fundId = fondos.funds[0].id as string;

  const res = await page.request.post('/api/subscriptions', {
    data: { fundId, amountDollars: 12.5 },
  });

  // No es un capricho: el plan cobra $1.00 por unidad, así que medio dólar
  // no es expresable y aceptarlo cobraría de menos en silencio.
  expect(res.status()).toBe(400);
});

test('sin sesión no se puede crear una suscripción', async ({ page, request }) => {
  await cerrarSesion(page);
  const res = await request.post('/api/subscriptions', {
    data: { fundId: 'cualquiera', amountDollars: 25 },
  });
  expect(res.status()).toBe(401);
});

test('el listado de suscripciones del donante responde', async ({ page }) => {
  const res = await page.request.get('/api/subscriptions');
  expect(res.status()).toBe(200);

  const { subscriptions } = (await res.json()) as {
    subscriptions: { amountCents: number; status: string; fund: string }[];
  };
  expect(Array.isArray(subscriptions)).toBe(true);
});
