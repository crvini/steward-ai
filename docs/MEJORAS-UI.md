# Mejoras de la interfaz — guía de trabajo

> Documento de trabajo para Claude Code y para Vinicio. Complementa
> `docs/SPEC.md` (que manda) con el detalle de **qué falta en la pantalla**
> y en qué orden conviene hacerlo.
>
> Recordá: el código, los comentarios y **los textos de la interfaz van en
> inglés**, con traducción al español vía `react-i18next`. Este documento es
> interno, por eso está en español.

Última actualización: 27 de octubre de 2026, tras el primer pago real de
punta a punta en producción.

---

## 1. Qué funciona hoy (verificado, no supuesto)

`https://steward.e-ministry.online` · API en `https://api-steward.e-ministry.online`

- Ofrenda única completa: botón JS SDK v6 → orden en el servidor → checkout →
  captura en el servidor → `Gift` + `Transaction` + `AuditLog`.
- Webhooks reales de PayPal entregados y con **firma verificada**.
- Idempotencia comprobada: la captura directa y el webhook reportaron la
  misma captura y quedó **una sola fila** en el libro.
- Se guarda comisión y neto (`feeCents`, `netCents`) e identidad del pagador.
- `/health` comprueba PostgreSQL, PayPal y Anthropic de verdad.
- EN/ES con detección automática del idioma del navegador.

**Lo que NO existe todavía:** autenticación, dashboard del tesorero con AG
Grid, chat del agente, suscripciones, distribuciones, reportes de impacto.
La pantalla actual es una sola página de donante con una tabla simple.

---

## 2. Prioridad #1 — Confirmación de pago de verdad

**El problema.** Al capturar, lo único que aparece es una línea de texto:
*"Ofrenda capturada. Referencia de PayPal: 66788774349857811"*. Se pierde al
recargar, no dice a qué fondo fue ni cuánto, y el donante no se lleva nada.
Es el momento más emotivo del demo y hoy parece un log.

**Qué construir** — `apps/web/src/GiftReceipt.tsx`, una tarjeta que reemplaza
el formulario al confirmarse el pago:

- Encabezado claro: *"Thank you, {nombre}"* con una marca de verificación.
- **Monto y fondo en grande**, que es lo que la persona quiere ver.
- Fecha y hora en el idioma activo.
- Referencia de PayPal en tipografía monoespaciada, con botón de copiar.
- Desglose: monto bruto, comisión de PayPal, **neto que recibe la iglesia**.
  Ya tenemos esos datos (`feeCents`, `netCents`) y mostrarlos es exactamente
  la transparencia que el proyecto promete. Ninguna plataforma de donaciones
  lo enseña; es un diferenciador barato y honesto.
- Frase de impacto del fondo: *"Your gift joins $1,490 given to Benevolence
  this month."*
- Dos acciones: **Give again** (vuelve al formulario) y **Download receipt**.
- Debe sobrevivir una recarga: guardar el id de la última ofrenda en
  `sessionStorage` y rehidratar desde `GET /api/gifts/:id`.

**Hace falta en el backend:** un `GET /api/gifts/:id` que devuelva la ofrenda
con su transacción, fondo y donante. Hoy solo existe el listado.

**Nota de alcance:** el recibo por correo es tentador pero **no lo hagas
todavía**. El spec lo deja para "si sobra tiempo", y en el droplet el correo
sale por la API de Zoho (DigitalOcean bloquea SMTP). Primero la pantalla.

---

## 3. Prioridad #2 — Estados vacíos, errores y carga

La página asume que todo responde. Falta:

- **Carga inicial:** hoy no se ve nada hasta que `/api/church` contesta.
  Poner esqueletos en las tarjetas de fondo y en la tabla.
- **API caída:** el error se muestra como una franja roja con el mensaje
  crudo. Debería decir qué pasó y ofrecer reintentar.
- **Tabla vacía:** existe el texto pero nunca se ve. Comprobarlo.
- **Monto inválido:** hoy se puede escribir `0` o un monto enorme y el error
  recién llega del servidor. Validar en la tarjeta antes de abrir PayPal.

---

## 4. Prioridad #3 — Lo que el plan pide a continuación

Por orden del cronograma de `docs/SPEC.md` §8:

1. **Autenticación simple por rol** (quedó pendiente del bloque 26–28).
   Sin esto no hay panel del tesorero ni doble aprobación. Un selector de
   usuario demo basta: los jueces necesitan entrar sin fricción.
2. **Suscripciones mensuales** (29 oct – 2 nov) — el selector "única /
   mensual" ya debería existir en la tarjeta de dar.
3. **Chat del agente** con tarjeta de confirmación antes de ejecutar nada.
4. **Panel del tesorero con AG Grid** (6–7 nov) — es premio de patrocinador,
   no lo dejes para el final. La tabla simple de hoy se reemplaza; ver
   `docs/REFERENCES.md` para el patrón de AG Grid v33 (registro modular y
   Theming API, nada de los CSS viejos).
5. **Reportes de impacto** y vista del donante.

---

## 5. Diseño visual

Hoy es Tailwind por defecto: funcional y soso. Para los criterios de
*diseño* y *presentación* del concurso conviene:

- Una paleta propia en vez de los grises de fábrica. El tema es la
  generosidad en una iglesia: cálido, no corporativo frío.
- Tipografía con jerarquía real; los montos son el dato protagonista.
- Las tarjetas de fondo podrían mostrar una barra de progreso o la tendencia
  del mes, no solo un número suelto.
- **Modo oscuro no es prioridad** para este demo. El video se graba en claro.
- Las capturas para Devpost son 3:2: comprobá que la página se vea bien en
  esa proporción, no solo en pantalla ancha.

---

## 6. Reglas que no se rompen

Valen para cualquier cambio en la interfaz:

- **El dinero son centavos enteros.** Nunca un `float`. La conversión vive
  solo en `apps/api/src/money.ts`, que está cubierto por tests.
- **La IA propone, el código decide.** Ninguna pantalla debe dejar que el
  agente ejecute un pago. Las distribuciones necesitan las dos aprobaciones
  y pasar el motor de reglas.
- **Todo texto de la interfaz pasa por `t()`.** Si agregás una cadena, va a
  `en.json` **y** a `es.json` en el mismo commit.
- **El navegador nunca ve el secreto de PayPal.** Solo el client token, que
  el servidor emite y expira en minutos.
- **Nunca toques `.env`.** Ni el local ni el del servidor. Para producción
  está `steward-secreto` en el droplet.

---

## 7. Cómo trabajar

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed   # base local en Docker, puerto 5434
pnpm dev                                        # api :4000 · web :5173
pnpm lint && pnpm typecheck && pnpm test        # antes de cualquier commit
./deploy.sh                                     # a producción (compila el web acá)
```

**Antes de dar algo por bueno:** cargá la página y miralo. Un build que
compila no significa que la pantalla funcione — el botón de PayPal estuvo
colgado tres iteraciones mientras todo compilaba en verde. Y si tocás algo
del arranque del SDK, probá **varias recargas seguidas**: ese bug era
intermitente y una sola carga buena no probaba nada.
