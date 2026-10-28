import { expect, test, type Page } from '@playwright/test';

import { cerrarSesion, entrarComo, PERSONAS } from './ayudas';

/**
 * Revisión bilingüe de cada pantalla.
 *
 * Existe porque comparar los dos archivos de idioma no alcanza: pueden estar
 * perfectamente alineados y aun así faltar una clave que el código arma en
 * tiempo de ejecución. Pasó de verdad — la tabla mostró `status.ACTIVE` en
 * crudo cuando se agregó ese valor al enum, y los dos idiomas "cuadraban".
 *
 * Acá se recorre cada pestaña de cada rol en los dos idiomas y se busca lo
 * que un usuario vería: una clave sin traducir en pantalla.
 */

const PESTAÑAS: Record<string, { persona: string; pestañas: RegExp[] }> = {
  miembro: {
    persona: PERSONAS.miembro.nombre,
    pestañas: [/^(dar|give)$/i, /(mi impacto|my impact)/i, /(mis ofrendas|my gifts)/i],
  },
  tesorero: {
    persona: PERSONAS.tesorero.nombre,
    pestañas: [
      /^(libros|books)$/i,
      /^(repartos|distributions)$/i,
      /^(auditoría|audit)$/i,
      /(borradores|impact drafts)/i,
      /(actividad de la ia|ai activity)/i,
    ],
  },
  pastor: {
    persona: PERSONAS.pastor.nombre,
    pestañas: [
      /(esta semana|this week)/i,
      /(aprobaciones|approvals)/i,
      /^(auditoría|audit)$/i,
      /(actividad de la ia|ai activity)/i,
    ],
  },
};

/**
 * i18next imprime la clave cruda cuando falta la traducción, así que una
 * línea como "status.ACTIVE" o "dist.keys.title" es el síntoma exacto.
 */
async function clavesCrudasEnPantalla(page: Page): Promise<string[]> {
  const texto = await page.locator('body').innerText();
  return texto
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z_][a-zA-Z0-9_]*){1,4}$/.test(t))
    // Un identificador de PayPal o un correo no es una clave de traducción.
    .filter((t) => !t.includes('@') && !/\.(com|online|example|org)$/.test(t));
}

async function cambiarIdioma(page: Page, lng: 'en' | 'es') {
  await page.getByRole('button', { name: new RegExp(`^${lng}$`, 'i') }).click();
  await page.waitForTimeout(400);
}

for (const [rol, { persona, pestañas }] of Object.entries(PESTAÑAS)) {
  for (const idioma of ['es', 'en'] as const) {
    test(`${rol} en ${idioma}: ninguna pantalla muestra una clave sin traducir`, async ({
      page,
    }) => {
      await cerrarSesion(page);
      await entrarComo(page, persona);
      await cambiarIdioma(page, idioma);

      for (const pestaña of pestañas) {
        await page.getByRole('button', { name: pestaña }).first().click();
        // Las que llaman a PayPal o a la base tardan un poco en pintar.
        await page.waitForTimeout(2500);

        const crudas = await clavesCrudasEnPantalla(page);
        expect(
          crudas,
          `${rol}/${idioma}, pestaña ${pestaña}: claves sin traducir en pantalla`,
        ).toEqual([]);
      }
    });
  }
}

test('la entrada se puede cambiar de idioma sin entrar', async ({ page }) => {
  await cerrarSesion(page);
  await page.goto('/');
  await page.waitForTimeout(1500);

  // El selector tiene que estar en la primera pantalla: alguien con el
  // navegador en español que quiera leer en inglés no debería tener que
  // entrar primero para poder cambiarlo.
  await cambiarIdioma(page, 'en');
  await expect(page.getByRole('heading', { name: /explore .* as/i })).toBeVisible();
  expect(await clavesCrudasEnPantalla(page)).toEqual([]);

  await cambiarIdioma(page, 'es');
  await expect(page.getByRole('heading', { name: /explorá .* como/i })).toBeVisible();
  expect(await clavesCrudasEnPantalla(page)).toEqual([]);
});
