import { expect, test } from '@playwright/test';

import { PERSONAS, cerrarSesion, entrarComo } from './ayudas';

test('la interfaz cambia entre español e inglés', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);

  await page.getByRole('button', { name: /^en$/i }).click();
  await expect(page.getByRole('heading', { name: /give to a fund/i })).toBeVisible();

  await page.getByRole('button', { name: /^es$/i }).click();
  await expect(page.getByRole('heading', { name: /dar a un fondo/i })).toBeVisible();
});

test('no queda ninguna clave de traducción sin traducir en pantalla', async ({ page }) => {
  await cerrarSesion(page);
  await page.goto('/');

  // i18next imprime la clave cruda cuando falta la traducción: "give.title".
  const texto = (await page.locator('body').innerText()).trim();
  const sospechosas = texto
    .split('\n')
    .filter((l) => /^[a-z]+(\.[a-zA-Z]+){1,3}$/.test(l.trim()));

  expect(sospechosas, `claves sin traducir: ${sospechosas.join(', ')}`).toHaveLength(0);
});
