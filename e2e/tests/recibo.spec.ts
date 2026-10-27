import { expect, test } from '@playwright/test';

import { PERSONAS, cerrarSesion, entrarComo, ofrendaCompletada } from './ayudas';

/**
 * El recibo es el momento emocional del producto y donde la promesa de
 * transparencia se vuelve concreta: la comisión de PayPal y el neto que
 * realmente recibe la iglesia salen de datos reales, no de una promesa.
 */
test('el recibo muestra monto, fondo y el desglose de comisión y neto', async ({
  page,
  request,
}) => {
  const ofrenda = await ofrendaCompletada(request);
  test.skip(!ofrenda, 'no hay ninguna ofrenda completada en los datos de prueba');

  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);

  // El recibo se rehidrata desde sessionStorage tras una recarga, que es
  // justamente lo que la versión anterior no hacía.
  await page.evaluate((id) => sessionStorage.setItem('steward:lastGiftId', id), ofrenda!.id);
  await page.reload();

  await expect(page.getByRole('heading', { name: /gracias/i })).toBeVisible();

  const recibo = page.locator('section', { hasText: /gracias/i }).first();
  await expect(recibo.getByText(/tu ofrenda/i).first()).toBeVisible();
  await expect(recibo.getByText(/comisión de paypal/i)).toBeVisible();
  await expect(recibo.getByText(/recibido por la iglesia/i)).toBeVisible();

  // El neto tiene que ser menor que el bruto: si alguien invierte el cálculo,
  // esto lo detecta.
  const datos = (await request.get(`/api/gifts/${ofrenda!.id}`).then((r) => r.json())) as {
    amountCents: number;
    feeCents: number | null;
    netCents: number | null;
  };
  expect(datos.netCents).not.toBeNull();
  expect(datos.netCents!).toBeLessThan(datos.amountCents);
  expect(datos.netCents! + datos.feeCents!).toBe(datos.amountCents);
});

test('"Dar otra vez" vuelve al formulario', async ({ page, request }) => {
  const ofrenda = await ofrendaCompletada(request);
  test.skip(!ofrenda, 'no hay ninguna ofrenda completada en los datos de prueba');

  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);
  await page.evaluate((id) => sessionStorage.setItem('steward:lastGiftId', id), ofrenda!.id);
  await page.reload();

  await page.getByRole('button', { name: /dar otra vez/i }).click();
  await expect(page.getByRole('heading', { name: /dar a un fondo/i })).toBeVisible();
});
