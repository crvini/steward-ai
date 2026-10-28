import { expect, test } from '@playwright/test';

import { cerrarSesion, entrarComo, PERSONAS } from './ayudas';

test('el donante no puede ver estadísticas ni el resumen', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);

  expect((await page.request.get('/api/stats')).status()).toBe(403);
  expect((await page.request.get('/api/brief')).status()).toBe(403);
  expect((await page.request.post('/api/brief')).status()).toBe(403);
});

test('el pastor abre en su semana, con el resumen y sus reglas', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.pastor.nombre);

  await expect(page.getByRole('heading', { name: /buenos días/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /este mes hasta ahora/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /tus reglas/i })).toBeVisible();
});

test('los topes que muestra el pastor son los que el motor aplica', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.pastor.nombre);

  const stats = (await page.request.get('/api/stats').then((r) => r.json())) as {
    limits: { maxPerItemCents: number; maxPerBatchCents: number };
  };

  // La pantalla no puede afirmar un tope distinto del que el código hace
  // cumplir, así que se compara contra lo que el servidor reporta.
  const panel = page.locator('section', { hasText: /tus reglas/i }).last();
  const texto = (await panel.innerText()).replace(/ /g, ' ');
  const porPago = (stats.limits.maxPerItemCents / 100).toLocaleString('es', {
    minimumFractionDigits: 2,
  });
  expect(texto).toContain(porPago);
});

test('las estadísticas cuadran con el libro mayor', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);

  const stats = (await page.request.get('/api/stats').then((r) => r.json())) as {
    unconfirmed: { count: number; cents: number };
  };
  const { rows } = (await page.request.get('/api/ledger').then((r) => r.json())) as {
    rows: { inPayPal: boolean; direction: string; amount: number }[];
  };

  const sinConfirmar = rows.filter((r) => r.direction === 'IN' && !r.inPayPal);
  expect(stats.unconfirmed.count).toBe(sinConfirmar.length);
  expect(stats.unconfirmed.cents).toBe(
    Math.round(sinConfirmar.reduce((s, r) => s + r.amount, 0) * 100),
  );
});

test('el resumen sale en el idioma en que se lee la app, no en el guardado', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.pastor.nombre);

  // El pastor tiene locale 'es' guardado; si cambia a inglés y pide un
  // resumen nuevo, esperaría leerlo en inglés.
  const res = await page.request.post('/api/brief', { data: { locale: 'en' } });
  expect(res.status()).toBe(201);

  const { brief } = (await res.json()) as { brief: { body: string } };
  // Heurística simple pero suficiente: palabras funcionales que solo
  // aparecen en uno de los dos idiomas.
  expect(brief.body).toMatch(/\b(the|this|week|gifts?|received)\b/i);
  expect(brief.body).not.toMatch(/\b(semana|ofrendas?|recibieron)\b/i);
});

test('la API rechaza un idioma que no soportamos', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.pastor.nombre);
  expect((await page.request.post('/api/brief', { data: { locale: 'fr' } })).status()).toBe(400);
});
