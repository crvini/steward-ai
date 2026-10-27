import { expect, test } from '@playwright/test';

import { PERSONAS, cerrarSesion, entrarComo, irAPestaña, modoManual } from './ayudas';

test.beforeEach(async ({ page }) => {
  await cerrarSesion(page);
});

test('la pantalla de entrada ofrece las tres personas, sin contraseña', async ({ page }) => {
  await page.goto('/');

  for (const { nombre } of Object.values(PERSONAS)) {
    // El nombre va junto al rol en una sola línea ("Maria Lopez, miembro"),
    // así que no se puede pedir coincidencia exacta.
    await expect(page.getByText(new RegExp(nombre))).toBeVisible();
  }

  // Si un juez tuviera que escribir algo, ya perdimos.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  // Debe decir, sin ambigüedad, que no se mueve dinero real. Aparece en dos
  // párrafos del aviso, así que basta con que haya al menos uno visible.
  await expect(page.getByText(/no se mueve dinero real|no real money moves/i)).toBeVisible();
});

test('entrar como miembro deja la tarjeta de dar lista', async ({ page }) => {
  await entrarComo(page, PERSONAS.miembro.nombre);
  await modoManual(page);

  const tarjeta = page.locator('section', { hasText: /dar a un fondo/i }).first();
  await expect(tarjeta.getByRole('heading', { name: /dar a un fondo/i })).toBeVisible();

  // El donante es quien inició sesión: se muestra fijo, no como desplegable
  // que se pueda cambiar desde el navegador.
  await expect(tarjeta.getByText(PERSONAS.miembro.nombre, { exact: true })).toBeVisible();
  await expect(tarjeta.locator('select')).toHaveCount(1); // solo el de fondo
});

test('se puede cambiar de rol sin salir', async ({ page }) => {
  await entrarComo(page, PERSONAS.miembro.nombre);

  const selector = page.getByRole('combobox').first();
  await selector.selectOption({ label: `${PERSONAS.tesorero.nombre} · Tesorero` });

  // El valor seleccionado es la verdad; el texto vive dentro de un <option>,
  // que el navegador considera oculto.
  await expect(selector).toHaveValue(/.+/);
  await expect(
    selector.locator('option:checked'),
  ).toHaveText(`${PERSONAS.tesorero.nombre} · Tesorero`);

  // Y la sesión del servidor cambió de verdad, no solo el desplegable.
  const sesion = await page.request.get('/api/session').then((r) => r.json());
  expect(sesion.user.role).toBe(PERSONAS.tesorero.rol);
});

test('salir devuelve a la pantalla de entrada', async ({ page }) => {
  await entrarComo(page, PERSONAS.miembro.nombre);
  await page.getByRole('button', { name: /salir/i }).click();

  await expect(page.getByRole('heading', { name: /explorá .* como/i })).toBeVisible();
});

test('la sesión sobrevive una recarga', async ({ page }) => {
  await entrarComo(page, PERSONAS.miembro.nombre);
  await page.reload();

  await expect(page.getByRole('heading', { name: /dar a un fondo/i })).toBeVisible();
});
