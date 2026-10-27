# Steward AI by E-Ministry — Spec para Claude Code

> Documento de arranque del proyecto para el **PayPal AI Hackathon 2026** (Devpost).
> Fecha límite: **12 de noviembre de 2026, 2:00 PM hora de Guatemala** (12:00 PM PT).
> Instrucción para Claude Code: lee este documento completo antes de escribir código. Todo el código, comentarios, README y textos de la interfaz van en **inglés**, con la interfaz traducible a español (i18n).

---

## 0. Primera tarea para Claude Code (hacer en este orden)

> El usuario ya creó la carpeta del proyecto y un archivo `.env` con sus llaves reales (PayPal sandbox y Anthropic). **No leas, imprimas, copies ni modifiques los valores del `.env`.** Si una variable falta, avisa por su nombre y sigue con lo demás.

1. Inicializar un repositorio git nuevo llamado `steward-ai` en la carpeta actual, que será **público** en GitHub. Confirmar que `.env` está en `.gitignore` **antes** del primer commit.
2. Agregar `LICENSE` con licencia **MIT** (copyright: "E-Ministry / Vinicio Cruz").
3. Crear el monorepo con la estructura de la sección 6 (pnpm workspaces).
4. Crear `.gitignore` (node_modules, `.env`, dist, coverage) y `.env.example` con las variables de la sección 7, **sin valores reales**.
5. Crear un `README.md` inicial con el nombre del proyecto, una frase de qué hace y la sección "Getting started" (se completa después).
6. Crear este mismo archivo como `docs/SPEC.md` y un `CLAUDE.md` corto en la raíz que apunte a `docs/SPEC.md`.
7. Primer commit: `chore: initial project scaffold`.
8. Antes de diseñar la integración, revisar como referencia la plantilla oficial `paypaldev/hackathon-paypal-ag-grid-boilerplate` en GitHub (NO copiar su stack si choca con el nuestro; solo tomar patrones de integración de PayPal y AG Grid).
9. Al terminar el scaffold, **continuar con el primer bloque del plan (sección 8, 26–28 oct)**:
   - Prisma schema + migración + seed de la iglesia ficticia.
   - Cliente de PayPal en el servidor (token OAuth con `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`).
   - Ofrenda única de punta a punta: botón JS SDK v6 → crear orden en el servidor → capturar en el servidor → registrar `Gift` y `Transaction` → mostrarla en una tabla simple.
   - Un endpoint `/health` que confirme conexión a la base de datos, a PayPal sandbox y a la API de Anthropic (sin exponer llaves).
10. Al final de cada bloque: correr lint, typecheck y tests, hacer commit y darme un resumen corto de lo hecho y lo que sigue.

**Reglas que no se rompen:**
- Nunca subir llaves, tokens ni `.env` al repositorio.
- Nunca copiar código de otros repos privados de E-Ministry. Este proyecto es nuevo y abierto.
- Commits pequeños y frecuentes con mensajes claros (el historial con fechas demuestra que se construyó durante el concurso).

---

## 1. Requisitos del concurso (no negociables)

- Usar **de forma real** al menos una tecnología de PayPal (sandbox gratis).
- Usar **IA** de forma real (cualquier modelo o plataforma).
- **Funcionar**: los jueces deben poder usarlo en un demo hospedado o con instrucciones claras. No se aceptan maquetas.
- Repositorio **público** con licencia OSI (MIT), README con instrucciones de instalación y explicación clara de cómo se usa PayPal y la IA.
- Video demo **público en YouTube, menos de 3 minutos**.
- Criterios de evaluación (mismo peso): implementación técnica, diseño, impacto potencial, innovación, presentación.
- Premios a los que apuntamos: **Best Use of PayPal + AI**, **Most Impactful**, **Best Use of Agentic Commerce**, y el premio de patrocinador **Best Use of AG Grid**.

---

## 2. El producto

**Steward AI** es un asistente de generosidad con IA para iglesias: el dinero entra, se reparte con aprobación humana y cada donante ve el fruto de su ofrenda.

**Frase corta:** *Generosity with transparency — from the moment someone gives to the moment they see the fruit.*

### Problema
Iglesias pequeñas y medianas (sobre todo en Latinoamérica) manejan diezmos, ofrendas y fondos designados con efectivo, transferencias sueltas y Excel. El tesorero pierde horas cuadrando, el dinero para misiones o ayuda tarda semanas en llegar, y los donantes casi nunca saben qué logró su ofrenda.

### Diferenciadores (importante: hay competencia parecida)
En el concurso ya hay proyectos de colectas grupales con pagos transparentes y varios "guardianes" de gasto para agentes de IA. Steward AI se diferencia por:

1. **Contabilidad por fondos designados** (Diezmo general, Misiones, Ayuda/Benevolencia, Construcción). Cada dólar sabe a qué fondo pertenece, de la entrada a la salida.
2. **Doble aprobación (two-key approval)**: ningún reparto sale sin la firma del tesorero **y** del pastor. Es una práctica real de control financiero en iglesias, y aquí la aplica el sistema.
3. **Motor de reglas determinístico antes de PayPal**: la IA solo **propone**; reglas en código validan límites por monto, destinatarios permitidos y saldo del fondo. La IA nunca puede aprobar ni saltarse una regla.
4. **Ciclo de impacto**: el donante recibe un reporte personal de lo que logró su ofrenda, basado en lo que realmente se repartió.
5. **Bilingüe (EN/ES)** desde el día uno, pensado para iglesias latinas que las plataformas gringas no atienden.

---

## 3. Alcance

### Mínimo indispensable (MVP) — en este orden de prioridad
1. **Dar conversando (Give by chat)**
   - El miembro escribe: "I want to give $50 a month to missions" / "Quiero dar $50 al mes para misiones".
   - El agente extrae: monto, fondo, frecuencia (única o mensual). Si falta algo, pregunta.
   - Muestra una tarjeta de confirmación. Solo al confirmar:
     - **Única** → crea una orden con Orders API y abre el checkout con JS SDK v6.
     - **Mensual** → crea una suscripción con Subscriptions API.
   - Webhooks registran el pago en la base de datos y lo asignan al fondo.

2. **Repartir con aprobación (Distribute with approval)**
   - El tesorero abre "Distributions". El agente revisa el saldo de cada fondo y los destinatarios registrados (misioneros, fondo de ayuda) y **propone** un plan de reparto con una explicación corta.
   - El motor de reglas valida cada línea (límite por monto, destinatario en lista blanca, saldo suficiente). Las líneas que fallan se marcan en rojo y no se pueden aprobar.
   - Tesorero ajusta y aprueba → Pastor aprueba → se ejecuta con **Payouts API** (con `sender_batch_id` único para idempotencia).
   - Webhooks de Payouts actualizan el estado de cada pago.

3. **Panel del tesorero (Treasurer dashboard)** con **AG Grid**
   - Tabla de transacciones (entradas y salidas) con filtros por fondo, fecha y estado.
   - Saldo por fondo y gráficas simples (AG Charts si alcanza).
   - Caja de preguntas en lenguaje natural: "How much came in for missions this month?" → el agente consulta la base de datos con herramientas tipadas (nunca SQL libre generado por la IA) y responde con texto + filtra la tabla.

4. **Reportes de impacto (Impact updates)**
   - Después de un reparto, la IA redacta un reporte corto y personal para cada donante del fondo ("Your gift this month helped…").
   - El tesorero los revisa y aprueba antes de "enviarlos" (en el demo basta con marcarlos como enviados y mostrar la vista del donante).

### Si sobra tiempo
- Facturas para eventos con Invoicing API (ej. retiro de jóvenes).
- Constancia anual de donaciones en PDF.
- Canal de WhatsApp (solo mencionarlo como "What's next").

### Fuera de alcance
- Apps móviles, multi-moneda, multi-iglesia completa (dejar el modelo listo para multi-tenant, pero el demo es una sola iglesia).

---

## 4. Integración de PayPal (sandbox)

| Herramienta | Uso en Steward AI |
|---|---|
| **JavaScript SDK v6** | Botón y checkout para ofrendas únicas |
| **Orders API v2** | Crear y capturar órdenes (create en el servidor, capture en el servidor) |
| **Subscriptions API** | Diezmos/ofrendas mensuales |
| **Payouts API v1** | Repartir fondos a misioneros y fondos de ayuda |
| **Webhooks** | `PAYMENT.CAPTURE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `PAYMENT.SALE.COMPLETED`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED/FAILED` |
| **Transaction Search** | Conciliar lo registrado contra PayPal en el panel |
| **Agent Toolkit / MCP** | Exponer acciones de PayPal como herramientas del agente (verificar nombre del paquete y uso actual en docs.paypal.ai antes de instalar) |

**Notas técnicas:**
- **Moneda: USD.** PayPal no maneja quetzales; todo el demo en USD.
- **Montos variables en suscripciones:** los planes tienen precio fijo. Usar un plan por fondo con precio unitario de $1.00 y `quantity` = monto elegido, o crear el plan al vuelo. Elegir lo más simple que funcione en sandbox y documentarlo.
- **Verificar firma de webhooks** con el endpoint `verify-webhook-signature` antes de procesar.
- **Idempotencia:** guardar IDs de PayPal y no procesar dos veces el mismo evento.
- Cuentas sandbox: una Business (la iglesia) y varias Personal (donantes y misioneros receptores de Payouts). Si alguna función falla con las cuentas de país GT, crear una cuenta Business de país US solo para el demo.

---

## 5. Diseño del agente de IA

- **Proveedor: Anthropic (Claude).** Usar el SDK oficial `@anthropic-ai/sdk` con **tool use**, o el proveedor de Anthropic del Vercel AI SDK si simplifica el streaming del chat. Revisar la documentación actual en docs.claude.com antes de implementar.
- **Modelos:**
  - `ANTHROPIC_MODEL_MAIN` (por defecto `claude-sonnet-5-5`): agente principal — intención de dar, propuestas de reparto, preguntas del tesorero.
  - `ANTHROPIC_MODEL_FAST` (por defecto `claude-haiku-5-5`): tareas simples y repetitivas — reportes de impacto, traducciones cortas.
- Encapsular todo en `apps/api/src/ai/` con un cliente único, para que el resto del código no dependa del SDK directamente.
- Usar **prompt caching** en el system prompt del agente y respuestas en streaming en el chat del donante.
- Limitar `max_tokens` por llamada y registrar el uso de tokens por petición en el log del servidor (sin contenido sensible).
- **Herramientas del agente (tipadas con Zod):**
  - `parseGivingIntent` → { amount, fund, frequency }
  - `createOneTimeGift`, `createRecurringGift` (requieren confirmación del usuario en la UI antes de ejecutarse)
  - `getFundBalances`, `listRecipients`
  - `proposeDistribution` → devuelve un plan; **no ejecuta**
  - `queryTransactions` → filtros tipados (fondo, rango de fechas, tipo); nunca SQL libre
  - `draftImpactUpdate` → texto para revisión humana
- **Guardrails:**
  - La IA nunca llama directamente a Payouts. Solo el endpoint `/distributions/:id/execute` lo hace, y solo si el plan tiene las dos aprobaciones y pasa el motor de reglas.
  - Límites configurables: monto máximo por pago, máximo por lote, lista blanca de destinatarios.
  - Registrar en una tabla `AuditLog` cada propuesta, aprobación, rechazo y ejecución (quién, cuándo, qué).
  - La IA solo recibe los datos mínimos (nombre y monto); nunca datos de tarjeta (PayPal los maneja).
  - Tono pastoral y respetuoso; el agente no presiona para dar más.

---

## 6. Stack y estructura

- **Frontend:** React + Vite + TypeScript + Tailwind CSS, AG Grid (Community), react-i18next (EN/ES).
- **Backend:** Node.js + Express + TypeScript, Prisma, PostgreSQL, Zod.
- **Tests:** Vitest para el motor de reglas y los handlers de webhooks como mínimo.
- **Deploy:** Render (patrocinador, preferido) o Railway. Subdominio sugerido: `steward.e-ministry.online`.
- **CI:** GitHub Actions con lint, typecheck y tests.

```
steward-ai/
├── apps/
│   ├── web/                 # React + Vite (donor chat, treasurer dashboard)
│   └── api/                 # Express API, PayPal + AI services, webhooks
├── packages/
│   └── shared/              # Tipos y esquemas Zod compartidos
├── prisma/                  # schema.prisma, migraciones, seed
├── docs/
│   ├── SPEC.md
│   └── SUBMISSION.md        # Checklist y textos para Devpost
├── .github/workflows/ci.yml
├── .env.example
├── LICENSE                  # MIT
├── CLAUDE.md
└── README.md
```

### Modelo de datos (Prisma, punto de partida)
- `Church` (id, name, currency)
- `User` (id, churchId, name, email, role: DONOR | TREASURER | PASTOR)
- `Fund` (id, churchId, name, description)
- `Gift` (id, donorId, fundId, amount, frequency, status, paypalOrderId?, paypalSubscriptionId?)
- `Transaction` (id, fundId, direction: IN | OUT, amount, paypalRef, occurredAt)
- `Recipient` (id, churchId, name, paypalEmail, fundId, maxPerPayout, active)
- `Distribution` (id, fundId, status: PROPOSED | TREASURER_APPROVED | APPROVED | EXECUTED | FAILED, aiRationale, treasurerApprovedBy?, pastorApprovedBy?, paypalBatchId?)
- `DistributionItem` (id, distributionId, recipientId, amount, status, paypalItemId?)
- `ImpactUpdate` (id, donorId, distributionId, body, status: DRAFT | APPROVED | SENT)
- `AuditLog` (id, actor, action, entity, entityId, payload, createdAt)
- `WebhookEvent` (id, paypalEventId UNIQUE, type, processedAt)

### Datos de prueba (seed)
Iglesia ficticia **"Iglesia Esperanza / Hope Church"** con 4 fondos, 8 donantes, 3 receptores (2 misioneros + fondo de ayuda) y ~2 meses de transacciones de ejemplo, para que el panel se vea lleno desde el primer momento.

---

## 7. Variables de entorno (`.env.example`)

```
# PayPal (sandbox)
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENV=sandbox
PAYPAL_WEBHOOK_ID=

# AI (Anthropic)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL_MAIN=claude-sonnet-5-5
ANTHROPIC_MODEL_FAST=claude-haiku-5-5

# App
DATABASE_URL=
API_URL=http://localhost:4000
WEB_URL=http://localhost:5173
SESSION_SECRET=

# Guardrails
MAX_PAYOUT_ITEM_USD=500
MAX_PAYOUT_BATCH_USD=2000
```

---

## 8. Plan de trabajo (hasta el 12 de noviembre)

| Fechas | Entregable |
|---|---|
| 26–28 oct | Scaffold, Prisma + seed, autenticación simple por rol, ofrenda única de punta a punta (botón SDK v6 → orden → captura → webhook → tabla) |
| 29 oct – 2 nov | Suscripciones mensuales, chat de dar con el agente y tarjeta de confirmación |
| 3–5 nov | Distribuciones: propuesta de la IA, motor de reglas, doble aprobación, Payouts y sus webhooks |
| 6–7 nov | Panel del tesorero con AG Grid + preguntas en lenguaje natural |
| 8 nov | Reportes de impacto + vista del donante |
| 9 nov | i18n EN/ES, pulido visual, estados de carga y error |
| 10 nov | Deploy, seed en producción, README final, tests y CI en verde |
| 11 nov | Grabar video (<3 min), capturas 3:2, llenar Devpost |
| 12 nov (mañana) | Revisión final y **Submit** |

---

## 9. README final (requisitos de los jueces)

Debe incluir:
1. Qué es y el problema (3–4 líneas) + captura principal.
2. **How we use PayPal** (tabla de la sección 4, solo lo que realmente se usó).
3. **How we use AI** (Claude de Anthropic: qué modelo hace qué, herramientas del agente, guardrails).
4. Arquitectura (diagrama simple).
5. **Getting started** en 3 pasos: clonar, configurar `.env`, `pnpm install && pnpm db:seed && pnpm dev`.
6. Credenciales de prueba para los jueces (usuarios demo de la app y cuentas sandbox de comprador).
7. Sponsor tools usadas (AG Grid, Render).
8. Licencia MIT.

---

## 10. Guion del video (<3 min)

- **0:00–0:20** Problema: tesorero con Excel y efectivo; el donante nunca sabe qué pasó con su ofrenda.
- **0:20–1:00** Dar por chat: un miembro pide dar mensual a misiones → confirma → suscripción en PayPal sandbox.
- **1:00–1:50** Repartir: la IA propone el reparto, una línea falla por regla (se ve en rojo), tesorero ajusta y aprueba, pastor aprueba, Payouts ejecuta.
- **1:50–2:30** Panel AG Grid: pregunta en lenguaje natural, la tabla se filtra, saldo por fondo; reporte de impacto aprobado y vista del donante.
- **2:30–3:00** Impacto, seguridad (dos llaves, reglas, auditoría) y siguiente paso: módulo de la plataforma E-Ministry.

---

## 11. Checklist de entrega en Devpost

- [ ] Repo público con LICENSE MIT, README completo y CI en verde
- [ ] Demo hospedado funcionando con datos de prueba
- [ ] Video público en YouTube, menos de 3 minutos
- [ ] 4–6 capturas 3:2
- [ ] "Built with" actualizado a lo que realmente se usó (incluir `anthropic` y `claude`)
- [ ] Límite de gasto configurado en la llave de Anthropic para el demo público
- [ ] Explicación del requisito técnico (PayPal + IA) en el formulario
- [ ] Instrucciones y credenciales de prueba para los jueces
- [ ] Sponsor tools marcadas (AG Grid, Render)
- [ ] Secciones "Challenges", "Accomplishments" y "What we learned" con lo que realmente pasó
- [ ] Submit antes del 12 de noviembre a las 2:00 PM (hora de Guatemala)

---

## Apéndice A — Desviaciones del spec original (registro de cambios)

Este apéndice registra los puntos donde la implementación se aparta del documento
original, con la razón. El resto del documento se mantiene tal cual se escribió.

| Fecha | Sección | Cambio | Razón |
|---|---|---|---|
| 2026-10-26 | 5, 7 | _(revertido)_ Se consideró cambiar los IDs de modelo de Anthropic, pero `claude-sonnet-5-5` y `claude-haiku-5-5` **sí existen** — verificado contra `GET /v1/models` el 26 de octubre de 2026. Se mantienen los del spec. | — |
| 2026-10-26 | 6 | PostgreSQL se levanta con Docker Compose (`postgres:16`) en el puerto **5434** | Evita chocar con la instalación local de PostgreSQL 14 en 5432 y con otro contenedor que ya ocupa 5433 y hace el setup reproducible para los jueces. Aprobado por el usuario. |
