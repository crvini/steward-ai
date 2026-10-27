import { expect, test } from '@playwright/test';

import { cerrarSesion, entrarComo, PERSONAS } from './ayudas';

/**
 * Los guardarraíles del reparto. No llaman a la IA a propósito: son baratas,
 * rápidas y defienden la propiedad que de verdad importa — que ningún camino
 * llegue a PayPal sin dos firmas.
 */
test('un donante no puede ver ni proponer repartos', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);

  expect((await page.request.get('/api/distributions')).status()).toBe(403);
  expect(
    (await page.request.post('/api/distributions/propose', { data: { fundId: 'x' } })).status(),
  ).toBe(403);
});

test('sin sesión no hay acceso a repartos', async ({ page, request }) => {
  await cerrarSesion(page);
  expect((await request.get('/api/distributions')).status()).toBe(401);
});

test('el pastor ve los repartos pero no puede proponer', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.pastor.nombre);

  expect((await page.request.get('/api/distributions')).status()).toBe(200);
  // Proponer es trabajo del tesorero; el pastor es la segunda llave.
  expect(
    (await page.request.post('/api/distributions/propose', { data: { fundId: 'x' } })).status(),
  ).toBe(403);
});

test('el tesorero ve la pantalla de repartos, el donante no', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);
  await expect(page.getByRole('heading', { name: /^repartos$/i })).toBeVisible();

  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);
  await expect(page.getByRole('heading', { name: /^repartos$/i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /dar a un fondo/i })).toBeVisible();
});

test('un reparto ya ejecutado no se puede volver a ejecutar ni aprobar', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);

  const { distributions } = (await page.request
    .get('/api/distributions')
    .then((r) => r.json())) as { distributions: { id: string; status: string }[] };

  const ejecutado = distributions.find((d) => d.status === 'EXECUTED');
  test.skip(!ejecutado, 'no hay ningún reparto ejecutado en los datos de prueba');

  // Idempotente: responde 200 pero avisa que ya estaba hecho, sin pagar otra vez.
  const otraVez = await page.request.post(`/api/distributions/${ejecutado!.id}/execute`);
  expect(otraVez.status()).toBe(200);
  expect(await otraVez.json()).toMatchObject({ alreadyExecuted: true });

  // Y ya no admite más firmas.
  const aprobar = await page.request.post(`/api/distributions/${ejecutado!.id}/approve`);
  expect(aprobar.status()).toBe(409);
});
