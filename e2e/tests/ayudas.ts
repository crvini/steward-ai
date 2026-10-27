import type { Page, APIRequestContext } from '@playwright/test';

/** Las tres personas que la pantalla de entrada ofrece, en orden. */
export const PERSONAS = {
  miembro: { nombre: 'Maria Lopez', rol: 'DONOR' },
  tesorero: { nombre: 'Daniel Ruiz', rol: 'TREASURER' },
  pastor: { nombre: 'Pastor Samuel Ortiz', rol: 'PASTOR' },
} as const;

/** Entra eligiendo una de las tarjetas de la pantalla inicial. */
export async function entrarComo(page: Page, nombre: string) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(nombre) }).click();
  // El encabezado solo existe una vez dentro.
  await page.getByRole('combobox').first().waitFor();
}

/** Deja la pestaña sin sesión y sin recibo guardado. */
export async function cerrarSesion(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
    sessionStorage.clear();
  });
}

/** Una ofrenda completada cualquiera, para probar la vista de recibo. */
export async function ofrendaCompletada(request: APIRequestContext) {
  const res = await request.get('/api/gifts?limit=50');
  const { gifts } = (await res.json()) as {
    gifts: { id: string; status: string; amountCents: number }[];
  };
  return gifts.find((g) => g.status === 'COMPLETED');
}

/**
 * Cambia la tarjeta de dar al formulario manual.
 *
 * El chat es el modo por defecto desde el Bloque C, así que los controles
 * manuales (donante, fondo, frecuencia, monto) están ocultos hasta que se
 * pide "Elegir".
 */
export async function modoManual(page: Page) {
  await page.getByRole('button', { name: /^elegir$/i }).click();
}
