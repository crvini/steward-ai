/**
 * Types and Zod schemas shared by the API and the web app.
 *
 * Keep this package runtime-light: Zod only. Anything that needs Prisma, Express
 * or React belongs in the app that uses it.
 */
export * from './domain.js';
