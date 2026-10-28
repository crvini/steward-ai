import { expect, test } from '@playwright/test';

import { PERSONAS, cerrarSesion, entrarComo } from './ayudas';

/**
 * El agente propone; nunca cobra. Estas pruebas defienden esa frontera, que
 * es el argumento central del proyecto.
 */
test.beforeEach(async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);
});

test('el chat es lo primero que ve el donante, con su advertencia', async ({ page }) => {
  const tarjeta = page.locator('section', { hasText: /dar a un fondo/i }).first();

  await expect(tarjeta.getByPlaceholder(/escribí qué te gustaría dar/i)).toBeVisible();
  // Que no se cobra nada hasta confirmar tiene que estar escrito, no implícito.
  await expect(tarjeta.getByText(/solo puede proponer/i)).toBeVisible();
});

test('una intención completa produce una propuesta que hay que confirmar', async ({ page }) => {
  const tarjeta = page.locator('section', { hasText: /dar a un fondo/i }).first();

  // La intención tiene que ser completa: sin frecuencia el agente pregunta
  // en vez de adivinar, que es justo lo que se le pidió hacer.
  await tarjeta
    .getByPlaceholder(/escribí qué te gustaría dar/i)
    .fill('Quiero dar $50 una sola vez para misiones');
  await tarjeta.getByRole('button', { name: /enviar/i }).click();

  // El modelo tarda; por eso el margen es amplio.
  const propuesta = page.getByTestId('ai-proposal');
  await expect(propuesta).toBeVisible({ timeout: 45_000 });

  // Intl mete un espacio duro antes de la moneda, así que se normaliza en vez
  // de comparar la cadena exacta.
  const texto = (await propuesta.innerText()).replace(/\u00a0/g, ' ');
  expect(texto).toMatch(/50[.,]00/);
  expect(texto).toMatch(/Missions/);
  expect(texto).toMatch(/Una vez/);
  expect(texto).toMatch(/todavía no se ha cobrado nada/i);

  // Y lo esencial: proponer no creó ninguna ofrenda.
  const { gifts } = (await page.request.get('/api/gifts?limit=5').then((r) => r.json())) as {
    gifts: { status: string; createdAt: string }[];
  };
  const recientes = gifts.filter((g) => Date.now() - Date.parse(g.createdAt) < 60_000);
  expect(recientes, 'una propuesta no debe crear una ofrenda').toHaveLength(0);
});

test('sin sesión no se puede hablar con el agente', async ({ page, request }) => {
  await cerrarSesion(page);
  const res = await request.post('/api/ai/giving', {
    data: { messages: [{ role: 'user', content: 'hola' }] },
  });
  expect(res.status()).toBe(401);
});

test('la API rechaza conversaciones abusivas', async ({ page }) => {
  // Un historial enorme o un mensaje gigante son control de costo, no estilo.
  const demasiados = Array.from({ length: 25 }, () => ({ role: 'user', content: 'hola' }));
  expect((await page.request.post('/api/ai/giving', { data: { messages: demasiados } })).status()).toBe(400);

  const gigante = [{ role: 'user', content: 'x'.repeat(5000) }];
  expect((await page.request.post('/api/ai/giving', { data: { messages: gigante } })).status()).toBe(400);

  expect((await page.request.post('/api/ai/giving', { data: { messages: [] } })).status()).toBe(400);
});

test('una intención incompleta hace que pregunte, no que adivine', async ({ page }) => {
  const tarjeta = page.locator('section', { hasText: /dar a un fondo/i }).first();

  // Sin monto: adivinar una cifra sería inaceptable en una app de donaciones.
  await tarjeta.getByPlaceholder(/escribí qué te gustaría dar/i).fill('Quiero dar para misiones');
  await tarjeta.getByRole('button', { name: /enviar/i }).click();

  // Llega una respuesta...
  await expect(tarjeta.locator('.bg-neutral-100').last()).not.toBeEmpty({ timeout: 45_000 });
  // ...pero no una propuesta.
  await expect(page.getByTestId('ai-proposal')).toHaveCount(0);
});

test('el chat sigue el final y la propuesta queda a la vista', async ({ page }) => {
  const tarjeta = page.locator('section', { hasText: /dar a un fondo/i }).first();
  const entrada = tarjeta.getByPlaceholder(/escribí qué te gustaría dar/i);

  // Dos intercambios para que el hilo crezca más que su alto máximo.
  for (const texto of ['Hola', 'Quiero dar $50 una sola vez para misiones']) {
    await entrada.fill(texto);
    await tarjeta.getByRole('button', { name: /enviar/i }).click();
    await page.waitForTimeout(6000);
  }

  const hilo = tarjeta.locator('.overflow-y-auto').first();
  const { alFinal } = await hilo.evaluate((el) => ({
    // Sin auto-scroll el hilo se quedaba arriba y la respuesta no se veía.
    alFinal: el.scrollHeight - el.scrollTop - el.clientHeight < 40,
  }));
  expect(alFinal, 'el hilo del chat no siguió al último mensaje').toBe(true);

  await expect(page.getByTestId('ai-proposal')).toBeInViewport({ timeout: 10_000 });
});

test('un monto por encima del tope se rechaza, el tope exacto no', async ({ page }) => {
  // Con un fondo inexistente a propósito: así se comprueba el límite sin
  // crear una ofrenda de verdad, que ensuciaría a las demás pruebas.
  // El monto se valida antes de buscar el fondo, así que el código dice
  // cuál de los dos falló.
  const pedir = (amountCents: number) =>
    page.request
      .post('/api/gifts', { data: { fundId: 'fondo-que-no-existe', amountCents } })
      .then((r) => r.status());

  // $10,000 es exactamente el tope: pasa la validación y muere en el fondo.
  expect(await pedir(1_000_000)).toBe(404);
  // Un centavo más y ni siquiera llega ahí.
  expect(await pedir(1_000_001)).toBe(400);
});

test('el campo recupera el foco para poder seguir escribiendo', async ({ page }) => {
  const tarjeta = page.locator('section', { hasText: /dar a un fondo/i }).first();
  const entrada = tarjeta.getByPlaceholder(/escribí qué te gustaría dar/i);

  await entrada.fill('Hola');
  await tarjeta.getByRole('button', { name: /enviar/i }).click();
  await expect(entrada).toBeEnabled({ timeout: 30_000 });

  // Sin devolver el foco, el siguiente mensaje se teclea en el vacío: el
  // campo se deshabilita mientras responde y al deshabilitarse lo pierde.
  await expect(entrada).toBeFocused();

  await page.keyboard.type('Quiero dar $25 una sola vez para misiones');
  await expect(entrada).toHaveValue(/25/);
});
