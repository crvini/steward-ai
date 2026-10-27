import { expect, test } from '@playwright/test';

import { PERSONAS, cerrarSesion, entrarComo } from './ayudas';

/**
 * Regresión del fallo que más costó encontrar.
 *
 * El botón de PayPal se quedaba en "Cargando PayPal…" para siempre, de forma
 * intermitente. La causa era la carrera del script asíncrono: se esperaba
 * sólo el evento `paypal-web-sdk-loaded`, que suele dispararse ANTES de que
 * React monte, así que el listener se registraba tarde y no se enteraba nunca
 * — aunque `window.paypal` ya existiera. Ahora se sondea el global.
 *
 * Una sola carga buena no probaba nada: por eso esta prueba recarga varias
 * veces. Si alguien vuelve a depender sólo del evento, esto se cae.
 */
test('el botón de PayPal queda listo en cada carga, no a veces', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);

  const INTENTOS = 5;
  for (let i = 1; i <= INTENTOS; i++) {
    await page.reload();

    const boton = page.locator('paypal-button');
    await expect(boton, `el botón no quedó visible en la carga ${i} de ${INTENTOS}`).toBeVisible({
      timeout: 25_000,
    });

    // Y que no se haya quedado el texto de carga colgado detrás.
    await expect(page.getByText(/cargando paypal/i)).toHaveCount(0);
  }
});

test('sin sesión, la API no deja registrar una ofrenda a nombre de nadie', async ({ request }) => {
  const res = await request.post('/api/gifts', {
    data: { fundId: 'lo-que-sea', amountCents: 100 },
  });

  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ error: 'not_signed_in' });
});

test('el webhook rechaza lo que no venga firmado por PayPal', async ({ request }) => {
  const res = await request.post('/api/webhooks/paypal', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      id: `WH-E2E-${Date.now()}`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'FALSO', amount: { value: '999.00', currency_code: 'USD' } },
    },
  });

  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ error: 'signature_not_verified' });
});

test('un cert_url que no es de PayPal tampoco pasa', async ({ request }) => {
  const res = await request.post('/api/webhooks/paypal', {
    headers: {
      'Content-Type': 'application/json',
      'paypal-auth-algo': 'SHA256withRSA',
      // Host que sólo se parece al de PayPal.
      'paypal-cert-url': 'https://paypal.com.atacante.example/cert',
      'paypal-transmission-id': 't1',
      'paypal-transmission-sig': 's1',
      'paypal-transmission-time': new Date().toISOString(),
    },
    data: { id: `WH-E2E-CERT-${Date.now()}`, event_type: 'PAYMENT.CAPTURE.COMPLETED' },
  });

  expect(res.status()).toBe(401);
});

test('los webhooks de suscripción tampoco pasan sin firma', async ({ request }) => {
  for (const tipo of [
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'PAYMENT.SALE.COMPLETED',
  ]) {
    const res = await request.post('/api/webhooks/paypal', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        id: `WH-E2E-${tipo}-${Date.now()}`,
        event_type: tipo,
        resource: { id: 'FALSO', amount: { value: '999.00', currency_code: 'USD' } },
      },
    });
    expect(res.status(), `${tipo} debería rechazarse`).toBe(401);
  }
});

test('/health responde sano con los tres servicios', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);

  const salud = (await res.json()) as {
    status: string;
    services: Record<string, { ok: boolean; detail: string }>;
  };

  expect(salud.status).toBe('ok');
  for (const [nombre, servicio] of Object.entries(salud.services)) {
    expect(servicio.ok, `${nombre} no está sano: ${servicio.detail}`).toBe(true);
  }

  // Nunca debe filtrar material de credenciales.
  const texto = JSON.stringify(salud);
  expect(texto).not.toMatch(/sk-ant-|EOtm|client_secret/i);
});
