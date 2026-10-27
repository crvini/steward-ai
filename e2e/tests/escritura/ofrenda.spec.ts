import { expect, test } from '@playwright/test';

import { PERSONAS, cerrarSesion, entrarComo } from './../ayudas';

/**
 * Crea una orden DE VERDAD en el sandbox de PayPal. Por eso vive en el
 * proyecto "escritura" y no corre por defecto.
 *
 * Llega hasta que el checkout de PayPal toma el control. Completar el pago
 * exige iniciar sesión con una cuenta de comprador del sandbox, y no
 * automatizamos credenciales de PayPal: eso se prueba a mano.
 */
test('dar abre el checkout de PayPal con una orden recién creada', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);

  const peticionOrden = page.waitForResponse(
    (r) => r.url().includes('/api/gifts') && r.request().method() === 'POST',
  );

  await page.locator('paypal-button').waitFor({ state: 'visible', timeout: 25_000 });
  await page.locator('paypal-button').click();

  const respuesta = await peticionOrden;
  expect(respuesta.status()).toBe(201);

  const cuerpo = (await respuesta.json()) as { giftId: string; orderId: string };
  expect(cuerpo.orderId).toMatch(/^[A-Z0-9]{10,}$/);

  // La ofrenda queda registrada como pendiente hasta que el comprador pague.
  const ofrenda = await page
    .request.get(`/api/gifts/${cuerpo.giftId}`)
    .then((r) => r.json() as Promise<{ status: string; captureId: string | null }>);

  expect(ofrenda.status).toBe('PENDING');
  expect(ofrenda.captureId).toBeNull();
});
