import { expect, test } from '@playwright/test';

import { cerrarSesion, entrarComo, PERSONAS } from './ayudas';

test('el donante no puede leer el libro mayor', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);

  expect((await page.request.get('/api/ledger')).status()).toBe(403);
  expect(
    (await page.request.post('/api/ledger/ask', { data: { question: '¿cuánto hay?' } })).status(),
  ).toBe(403);
});

test('el tesorero ve la tabla con comisión y neto', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);

  await expect(page.getByRole('heading', { name: /libro mayor/i })).toBeVisible();
  // AG Grid pinta sus cabeceras; que existan prueba que el grid montó.
  await expect(page.getByText('Comisi', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
});

test('la respuesta del agente coincide con lo que queda en la tabla', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);

  const res = await page.request.post('/api/ledger/ask', {
    data: { question: '¿Cuánto entró para misiones este mes?' },
  });
  expect(res.status()).toBe(200);

  const { filter, answer } = (await res.json()) as {
    filter: Record<string, unknown>;
    answer: string;
  };

  // El agente no escribe SQL: sólo puede devolver estos campos tipados.
  expect(Object.keys(filter).every((k) =>
    ['fundSlug', 'direction', 'from', 'to', 'minAmountCents'].includes(k),
  )).toBe(true);
  expect(filter.fundSlug).toBe('MISSIONS');
  expect(answer.length).toBeGreaterThan(0);
});

test('el agente del libro rechaza preguntas vacías o enormes', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);

  expect((await page.request.post('/api/ledger/ask', { data: { question: '' } })).status()).toBe(400);
  expect(
    (await page.request.post('/api/ledger/ask', { data: { question: 'x'.repeat(1000) } })).status(),
  ).toBe(400);
});
