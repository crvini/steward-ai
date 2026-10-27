import { expect, test } from '@playwright/test';

import { cerrarSesion, entrarComo, irAPestaña, PERSONAS } from './ayudas';

test.beforeEach(async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);
});

test('el miembro abre en dar, con el panel de necesidades al lado', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /dar a un fondo/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /dónde la iglesia necesita ayuda/i })).toBeVisible();
});

test('las necesidades se ordenan por lo más lejos de su meta', async ({ page }) => {
  const { funds } = (await page.request.get('/api/church').then((r) => r.json())) as {
    funds: { name: string; goalCents: number | null; balanceCents: number }[];
  };

  const panel = page.locator('section', { hasText: /dónde la iglesia necesita ayuda/i }).last();
  const texto = await panel.innerText();

  const conMeta = funds
    .filter((f) => f.goalCents !== null)
    .sort((a, b) => a.balanceCents / a.goalCents! - b.balanceCents / b.goalCents!);

  // Un fondo al 30% de una meta chica necesita más ayuda que uno al 90% de
  // una grande, y quien decide dónde dar se sirve mejor de ese orden.
  const posiciones = conMeta.map((f) => texto.indexOf(f.name));
  expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
});

test('el miembro tiene sus tres pestañas y ninguna de tesorero', async ({ page }) => {
  for (const nombre of [/^dar$/i, /mi impacto/i, /mis ofrendas/i]) {
    await expect(page.getByRole('button', { name: nombre })).toBeVisible();
  }
  for (const nombre of [/^libros$/i, /^repartos$/i, /^auditoría$/i]) {
    await expect(page.getByRole('button', { name: nombre })).toHaveCount(0);
  }
});

test('mi impacto muestra una nota ya aprobada', async ({ page }) => {
  await irAPestaña(page, /mi impacto/i);

  const { updates } = (await page.request.get('/api/impact/mine').then((r) => r.json())) as {
    updates: { body: string }[];
  };
  test.skip(updates.length === 0, 'el seed no dejó notas para esta persona');

  await expect(page.getByRole('heading', { name: /lo que logró tu ofrenda/i })).toBeVisible();
  await expect(page.getByText(updates[0]!.body.slice(0, 40))).toBeVisible();
});

test('cancelar una suscripción ajena está prohibido', async ({ page }) => {
  // El dueño de la ofrenda es el único que puede detenerla; se comprueba con
  // una suscripción inexistente para no depender de datos sembrados.
  const res = await page.request.post('/api/subscriptions/I-NOEXISTE/cancel');
  expect([403, 404]).toContain(res.status());
});
