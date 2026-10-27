import { expect, test } from '@playwright/test';

import { cerrarSesion, entrarComo, irAPestaña, PERSONAS } from './ayudas';

/**
 * El móvil no se rediseñó a propósito: los jueces lo ven en computadora y el
 * video se graba ahí. Lo único que se defiende acá es que no se rompa — en
 * concreto, que ninguna pantalla provoque scroll horizontal, que es el
 * síntoma de que algo se desbordó.
 */
test.use({ viewport: { width: 390, height: 844 } });

async function sinScrollHorizontal(page: import('@playwright/test').Page, donde: string) {
  const desborda = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(desborda, `${donde} provoca scroll horizontal en 390px`).toBe(false);
}

test('la entrada no se desborda en móvil', async ({ page }) => {
  await cerrarSesion(page);
  await page.goto('/');
  // El panel de roles tarda en llegar; se espera por él y no por el título,
  // que en inglés dice "Explore" y hace la prueba dependiente del idioma.
  await expect(page.getByText(PERSONAS.miembro.nombre)).toBeVisible({ timeout: 30_000 });
  await sinScrollHorizontal(page, 'la pantalla de entrada');
});

test('las pantallas del miembro no se desbordan', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.miembro.nombre);
  await sinScrollHorizontal(page, 'dar');

  await irAPestaña(page, /mi impacto/i);
  await sinScrollHorizontal(page, 'mi impacto');

  await irAPestaña(page, /mis ofrendas/i);
  await sinScrollHorizontal(page, 'mis ofrendas');
});

test('las pantallas del tesorero no se desbordan', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);
  await sinScrollHorizontal(page, 'libros');

  await irAPestaña(page, /^repartos$/i);
  await page.waitForTimeout(1500);
  await sinScrollHorizontal(page, 'repartos');

  await irAPestaña(page, /actividad de la ia/i);
  await sinScrollHorizontal(page, 'actividad de la IA');
});

test('las pantallas del pastor no se desbordan', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.pastor.nombre);
  await sinScrollHorizontal(page, 'esta semana');

  await irAPestaña(page, /aprobaciones/i);
  await page.waitForTimeout(1500);
  await sinScrollHorizontal(page, 'aprobaciones');
});

test('la tabla de AG Grid hace su propio scroll, no el de la página', async ({ page }) => {
  await cerrarSesion(page);
  await entrarComo(page, PERSONAS.tesorero.nombre);
  await irAPestaña(page, /^libros$/i);
  await page.waitForTimeout(2000);

  // Una tabla ancha debe desbordarse dentro de su contenedor; si empuja la
  // página entera, el resto de la pantalla queda inservible en un teléfono.
  await sinScrollHorizontal(page, 'el libro mayor con AG Grid');
});
