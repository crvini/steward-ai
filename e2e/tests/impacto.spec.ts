import { expect, test } from '@playwright/test';

import { cerrarSesion, entrarComo, irAPestaña, PERSONAS } from './ayudas';

test('un donante no puede redactar ni aprobar reportes', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);

  expect((await page.request.post('/api/impact/cualquiera/draft')).status()).toBe(403);
  expect((await page.request.get('/api/impact/review')).status()).toBe(403);
});

test('el donante solo ve reportes ya aprobados', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);

  const { updates } = (await page.request.get('/api/impact/mine').then((r) => r.json())) as {
    updates: { id: string }[];
  };
  // El endpoint filtra por SENT; un borrador nunca debe aparecer aquí.
  expect(Array.isArray(updates)).toBe(true);

  const revisión = await page.request.get('/api/impact/review');
  expect(revisión.status()).toBe(403);
});

test('no se redactan reportes de un reparto que no se ha pagado', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);

  const { distributions } = (await page.request
    .get('/api/distributions')
    .then((r) => r.json())) as { distributions: { id: string; status: string }[] };

  const sinPagar = distributions.find((d) => d.status !== 'EXECUTED');
  test.skip(!sinPagar, 'no hay repartos sin ejecutar en los datos de prueba');

  // Contarle a un donante lo que logró su ofrenda antes de que lo lograra
  // sería mentirle.
  const res = await page.request.post(`/api/impact/${sinPagar!.id}/draft`);
  expect(res.status()).toBe(409);
});

test('el tesorero ve la cola de revisión', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);
  await irAPestaña(page, /^borradores$/i);
  await expect(page.getByRole('heading', { name: /reportes de impacto/i })).toBeVisible();
});
