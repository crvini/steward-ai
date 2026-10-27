#!/usr/bin/env node
/**
 * Audita las traducciones.
 *
 * Comparar inglés contra español no alcanza: las dos pueden estar alineadas y
 * aun así faltar una clave, porque muchas se arman en tiempo de ejecución a
 * partir de un enum — `t(`status.${gift.status}`)`. Cuando se agregó ACTIVE al
 * enum GiftStatus, los dos idiomas seguían "cuadrando" y la pantalla mostraba
 * `status.ACTIVE` en crudo.
 *
 * Por eso este script cruza las claves dinámicas contra las fuentes reales:
 * los enums de prisma/schema.prisma y los códigos del motor de reglas.
 *
 *   node scripts/auditar-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = 'apps/web/src';
const leer = (p) => readFileSync(p, 'utf8');

function archivos(dir, ext, acc = []) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, ext, acc);
    else if (nombre.endsWith(ext)) acc.push(ruta);
  }
  return acc;
}

function aplanar(obj, pre = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') aplanar(v, `${pre}${k}.`, out);
    else out[`${pre}${k}`] = v;
  }
  return out;
}

const enRaiz = JSON.parse(leer(`${RAIZ}/locales/en.json`));
const esRaiz = JSON.parse(leer(`${RAIZ}/locales/es.json`));
const en = aplanar(enRaiz);
const es = aplanar(esRaiz);

const existe = (clave, mapa) => existeEn(clave, mapa === en ? enRaiz : esRaiz);

/**
 * Resuelve una clave como lo hace i18next: partiendo la ruta por puntos y
 * caminando el objeto. Aplanar y comparar cadenas no sirve — una clave
 * literalmente llamada "ai.gift_proposed" dentro de `action` se aplana igual
 * que una anidada, pero i18next no la encuentra. Ese bug llegó a producción.
 */
function resuelve(clave, raiz) {
  const partes = clave.split('.');
  let nodo = raiz;
  for (const parte of partes) {
    if (nodo === null || typeof nodo !== 'object' || !(parte in nodo)) return undefined;
    nodo = nodo[parte];
  }
  return typeof nodo === 'string' ? nodo : undefined;
}

/** i18next resuelve plurales con sufijos _one/_other. */
const existeEn = (clave, raiz) =>
  resuelve(clave, raiz) !== undefined ||
  resuelve(`${clave}_one`, raiz) !== undefined ||
  resuelve(`${clave}_other`, raiz) !== undefined;

/** Los valores de un enum de Prisma, por nombre. */
function enumPrisma(nombre) {
  const esquema = leer('prisma/schema.prisma');
  const m = esquema.match(new RegExp(`enum\\s+${nombre}\\s*\\{([^}]*)\\}`));
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*/, '').trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
}

/** Los códigos que el motor de reglas puede emitir. */
function codigosDeReglas() {
  const fuente = leer('apps/api/src/rules/distribution.ts');
  const m = fuente.match(/const RULE_LABELS[^{]*\{([\s\S]*?)\n\};/);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*([A-Z_]+):/gm)].map((x) => x[1]);
}

/** Las acciones que la bitácora muestra. */
function accionesDeBitacora() {
  const fuente = leer('apps/api/src/routes/activity.ts');
  const m = fuente.match(/const INTERESTING = \[([\s\S]*?)\];/);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_.]+)'/g)].map((x) => x[1]);
}

/**
 * Cada prefijo dinámico con la lista de valores que el código puede producir.
 * Si se agrega uno nuevo acá, el script empieza a exigir su traducción.
 */
const DINAMICAS = [
  { prefijo: 'status', valores: enumPrisma('GiftStatus'), fuente: 'enum GiftStatus' },
  { prefijo: 'dist.status', valores: enumPrisma('DistributionStatus'), fuente: 'enum DistributionStatus' },
  { prefijo: 'role', valores: enumPrisma('UserRole'), fuente: 'enum UserRole' },
  { prefijo: 'rule', valores: codigosDeReglas(), fuente: 'motor de reglas' },
  { prefijo: 'activity.action', valores: accionesDeBitacora(), fuente: 'bitácora' },
];

const problemas = [];

// 1. Claves literales usadas que no existen.
const literales = new Set();
for (const f of archivos(RAIZ, '.tsx')) {
  for (const m of leer(f).matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)) literales.add(m[1]);
}
for (const clave of [...literales].sort()) {
  if (!existe(clave, en)) problemas.push(`falta en inglés: ${clave}`);
  if (!existe(clave, es)) problemas.push(`falta en español: ${clave}`);
}

// 2. Los dos idiomas con las mismas claves.
for (const k of Object.keys(en)) if (!(k in es)) problemas.push(`solo en inglés: ${k}`);
for (const k of Object.keys(es)) if (!(k in en)) problemas.push(`solo en español: ${k}`);

// 3. Lo que el script anterior no veía: cada valor que el código puede producir.
for (const { prefijo, valores, fuente } of DINAMICAS) {
  if (valores.length === 0) {
    problemas.push(`no se pudo leer la fuente de ${prefijo}.* (${fuente})`);
    continue;
  }
  for (const v of valores) {
    // Una acción como "ai.gift_proposed" se guarda con guion bajo, porque el
    // punto es el separador de rutas de i18next.
    const clave = `${prefijo}.${v.replace(/\./g, '_')}`;
    if (!existe(clave, en)) problemas.push(`falta en inglés: ${clave} (viene de ${fuente})`);
    if (!existe(clave, es)) problemas.push(`falta en español: ${clave} (viene de ${fuente})`);
  }
}

// 4. Interpolaciones que no coinciden entre idiomas.
for (const k of Object.keys(en)) {
  if (!(k in es)) continue;
  const vars = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
  if (vars(en[k]) !== vars(es[k])) {
    problemas.push(`interpolaciones distintas en ${k}: "${vars(en[k])}" vs "${vars(es[k])}"`);
  }
}

if (problemas.length) {
  console.error(`✖  ${problemas.length} problema(s) de traducción:\n`);
  for (const p of problemas) console.error(`   ${p}`);
  process.exit(1);
}

const total = Object.keys(en).length;
const dinamicas = DINAMICAS.reduce((s, d) => s + d.valores.length, 0);
console.log(
  `✓  ${total} claves alineadas en los dos idiomas, ` +
    `${literales.size} usadas literalmente y ${dinamicas} derivadas de enums y códigos reales.`,
);
