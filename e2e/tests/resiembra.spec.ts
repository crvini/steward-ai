import { expect, test } from '@playwright/test';

import { cerrarSesion } from './ayudas';

/**
 * El demo se resiembra de vez en cuando y eso cambia todos los ids. Una
 * pestaña abierta de antes todavía tiene los viejos, así que el primer clic
 * fallaba con "user_not_found" — un código crudo que no le dice nada a un
 * juez y lo deja pensando que el demo está roto.
 *
 * Ahora la página se recupera sola, volviendo a pedir los roles y buscando a
 * la misma persona por su correo, que sí sobrevive a una resiembra.
 */
test('un id viejo no rompe la entrada: se recupera por correo', async ({ page }) => {
  await cerrarSesion(page);
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Se envenenan los ids que la página tiene en memoria, como si los datos
  // se hubieran resembrado desde que se cargó.
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(typeof input === 'string' ? input : (input as Request).url);
      const res = await original(input, init);
      if (!url.includes('/api/session/roles')) return res;
      const data = await res.clone().json();
      // Una sola vez: la siguiente petición devuelve los ids buenos.
      window.fetch = original;
      const romper = (u: { id: string }) => ({ ...u, id: 'cmvq-id-que-ya-no-existe' });
      return new Response(
        JSON.stringify({
          ...data,
          featured: data.featured.map(romper),
          users: data.users.map(romper),
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    };
  });

  await page.reload();
  await page.getByRole('button', { name: /Maria Lopez/ }).click();

  // Entra igual, sin que el juez tenga que recargar.
  await expect(page.getByRole('heading', { name: /dar a un fondo/i })).toBeVisible({
    timeout: 30_000,
  });
});

test('un error de la API se muestra como frase, nunca como código', async ({ page }) => {
  await cerrarSesion(page);
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Se fuerza un 404 permanente para ver qué lee la persona.
  await page.route('**/api/session', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'user_not_found' }),
    });
  });

  await page.getByRole('button', { name: /Maria Lopez/ }).click();

  await expect(page.getByText(/user_not_found/)).toHaveCount(0);
  await expect(page.getByText(/los datos se resembraron|demo data was refreshed/i)).toBeVisible({
    timeout: 20_000,
  });
});
