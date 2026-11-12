#!/usr/bin/env bash
# Vuelve el demo de producción a su estado de fábrica, entre ensayos del video.
#
#   ./reset-demo.sh            resiembra y muestra el estado
#   ./reset-demo.sh --estado   solo mira, no toca la base
#
# Resiembra corriendo `pnpm db:seed` en el servidor: ese seed borra sus propias
# tablas antes de escribir y usa una semilla fija, así que dos ensayos arrancan
# con datos idénticos. No compila ni despliega nada: el código del servidor
# queda como está.
#
# El host, el usuario y la llave NO están escritos acá: salen de .deploy.env,
# que está en .gitignore. Así el repo es público sin publicar a dónde apunta.
#
# Después de sembrar corrige dos cosas, siempre en la base, nunca en el código:
#
#   Las fechas. El seed ancla su historia en una fecha fija (26-oct-2026), pero
#   las pantallas leen el reloj real: pasado el 1-nov, "Este mes hasta ahora"
#   abre en cero y el resumen escribe "No gifts were received this week". Acá se
#   corre toda la historia en bloque para que la ofrenda más nueva caiga ayer.
#   Se mueve en días enteros, así los domingos siguen siendo domingos.
#
#   El idioma. Las personas del demo están sembradas en español y App.tsx le
#   impone al entrar el idioma de la persona, pisando ?lng=en. Acá se las pone
#   en inglés, junto con las notas de impacto, que el seed escribe en el idioma
#   del donante (si no, "Tu impacto" queda en español bajo una interfaz inglesa).
#
# El resumen semanal tampoco sobrevive al reseed: el seed no borra WeeklyBrief,
# pero crea una iglesia nueva con otro id, y el resumen está indexado por
# (churchId, weekOf) — la fila vieja queda huérfana y la pantalla del pastor
# abre sin resumen. Por eso este script lo manda escribir de nuevo: sin eso,
# cada ensayo arranca con un hueco en la toma del pastor.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOLO_ESTADO="${1:-}"

paso() { printf '\n▶  %s\n' "$1"; }
morir() { printf '✖  %s\n' "$1" >&2; exit 1; }

# ── Dónde está el demo ──────────────────────────────────────────────────────
[ -f "$RAIZ/.deploy.env" ] || morir ".deploy.env no existe. Necesita DEPLOY_HOST, DEPLOY_USER, DEPLOY_KEY, DEPLOY_APP, DEPLOY_APP_USER y API_URL."
set -a
# shellcheck disable=SC1091
source "$RAIZ/.deploy.env"
set +a

for v in DEPLOY_HOST DEPLOY_USER DEPLOY_KEY DEPLOY_APP DEPLOY_APP_USER API_URL; do
  [ -n "${!v:-}" ] || morir "Falta $v en .deploy.env"
done

# El ~ de una variable no lo expande el shell, y ssh -i '~/...' falla.
LLAVE="${DEPLOY_KEY/#\~/$HOME}"
[ -f "$LLAVE" ] || morir "No encuentro la llave que apunta DEPLOY_KEY."

SSH=(ssh -i "$LLAVE" -o BatchMode=yes -o ConnectTimeout=15 "$DEPLOY_USER@$DEPLOY_HOST")
GALLETAS="$(mktemp)"
trap 'rm -f "$GALLETAS"' EXIT

api() { curl -sS -m 60 -b "$GALLETAS" -c "$GALLETAS" "$@"; }
# node en vez de jq: jq no viene en una Mac limpia y node ya es requisito del proyecto.
leer() { node -e '
  let crudo = "";
  process.stdin.on("data", (c) => (crudo += c)).on("end", () => {
    let d; try { d = JSON.parse(crudo); } catch { console.log("??  La API no devolvió JSON: " + crudo.slice(0, 120)); process.exit(0); }
    process.stdout.write(eval(process.argv[1]));
  });
' "$1"; }

# ── Resembrar ───────────────────────────────────────────────────────────────
if [ "$SOLO_ESTADO" != "--estado" ]; then
  paso "Resembrando la base del demo"
  "${SSH[@]}" "su - $DEPLOY_APP_USER -c 'cd $DEPLOY_APP && pnpm db:seed'" \
    | sed 's/^/   /' \
    || morir "El seed falló en el servidor. Nada quedó a medias: el seed corre en una sola pasada y borra antes de escribir."

  paso "Poniendo la historia en fecha y el demo en inglés"
  # El SQL viaja en un archivo y corre allá: así la contraseña de la base sale
  # del .env del servidor y nunca pasa por acá ni por la línea de comandos.
  AJUSTE="$(mktemp)"
  cat > "$AJUSTE" <<'REMOTO'
set -euo pipefail
cd "$1"
set -a; . ./.env; set +a
# psql no acepta el ?schema=public que Prisma sí necesita.
psql "${DATABASE_URL%%\?*}" -v ON_ERROR_STOP=1 -qAt <<'SQL'
BEGIN;

-- Cuántos días hay que correr la historia para que la ofrenda más nueva caiga
-- ayer. Ayer y no hoy: las del seed están a las 12:00 UTC, y si cayeran hoy
-- quedarían en el futuro para quien resiembre de madrugada.
CREATE TEMP TABLE _corrimiento AS
SELECT ((now() AT TIME ZONE 'UTC')::date
        - (max("occurredAt") AT TIME ZONE 'UTC')::date - 1) AS dias
FROM "Transaction" WHERE direction = 'IN';

UPDATE "Transaction" SET "occurredAt" = "occurredAt" + (SELECT dias FROM _corrimiento) * interval '1 day';
UPDATE "Gift" SET "createdAt"   = "createdAt"   + (SELECT dias FROM _corrimiento) * interval '1 day',
                  "completedAt" = "completedAt" + (SELECT dias FROM _corrimiento) * interval '1 day';
UPDATE "Distribution" SET "createdAt"           = "createdAt"           + (SELECT dias FROM _corrimiento) * interval '1 day',
                          "treasurerApprovedAt" = "treasurerApprovedAt" + (SELECT dias FROM _corrimiento) * interval '1 day',
                          "pastorApprovedAt"    = "pastorApprovedAt"    + (SELECT dias FROM _corrimiento) * interval '1 day',
                          "executedAt"          = "executedAt"          + (SELECT dias FROM _corrimiento) * interval '1 day';
UPDATE "ImpactUpdate" SET "approvedAt" = "approvedAt" + (SELECT dias FROM _corrimiento) * interval '1 day',
                          "sentAt"     = "sentAt"     + (SELECT dias FROM _corrimiento) * interval '1 day';

-- Nulo + intervalo es nulo, así que lo que el seed dejó sin fecha sigue sin fecha.

UPDATE "User" SET locale = 'en';
-- El texto en inglés es el que el seed ya escribe para los donantes en inglés;
-- no es una traducción nueva.
UPDATE "ImpactUpdate" SET locale = 'en', body =
  'Your gift joined the Missions fund, which distributed $550.00 this month: $300.00 to the Ruiz Family in the Guatemala Highlands and $250.00 to Kofi Mensah in West Africa. Thank you for keeping this work going.'
WHERE locale <> 'en';

SELECT '   historia corrida ' || dias || ' días; última ofrenda '
       || to_char((now() AT TIME ZONE 'UTC')::date - 1, 'YYYY-MM-DD') FROM _corrimiento;
COMMIT;
SQL
REMOTO
  scp -q -i "$LLAVE" -o BatchMode=yes "$AJUSTE" "$DEPLOY_USER@$DEPLOY_HOST:/tmp/steward-ajuste.sh"
  rm -f "$AJUSTE"
  "${SSH[@]}" "chown $DEPLOY_APP_USER /tmp/steward-ajuste.sh && su - $DEPLOY_APP_USER -c 'bash /tmp/steward-ajuste.sh $DEPLOY_APP'; rm -f /tmp/steward-ajuste.sh" \
    || morir "No se pudo ajustar la base. El SQL va en una transacción: si falló, no quedó a medias."
fi

# ── Qué va a ver la cámara ──────────────────────────────────────────────────
paso "Estado del demo"

# Entra como el pastor, no como el tesorero: el resumen semanal es suyo, y la
# pantalla de auditoría muestra quién lo escribió. Firmado por el tesorero se
# lee raro justo en el plano donde se explica quién aprueba qué.
PASTOR="$(api "$API_URL/api/session/roles" | leer 'd.featured.find(u=>u.role==="PASTOR").id')"
[ -n "$PASTOR" ] || morir "La API no devolvió las personas del demo. ¿Está arriba?"
api -X POST -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$PASTOR\"}" "$API_URL/api/session" >/dev/null

printf '   %s\n' "$(api "$API_URL/health" | leer '
  "salud        " + (d.status === "ok" ? "✅ " : "⚠️  ") +
  Object.entries(d.services).map(([k, v]) => k + (v.ok ? " ok" : " CAÍDO")).join(", ")')"

api "$API_URL/api/distributions" | leer '
  d.distributions.map((x) => {
    const total = (x.totalCents / 100).toFixed(2);
    const estado = { TREASURER_APPROVED: "espera al pastor", EXECUTED: "ejecutado",
                     PROPOSED: "espera al tesorero" }[x.status] ?? x.status.toLowerCase();
    const lineas = x.items.map((i) => "        · $" + (i.amountCents / 100).toFixed(2) + "  " + i.recipient).join("\n");
    return "   reparto      " + x.fund + " $" + total + " — " + estado + "\n" + lineas;
  }).join("\n") + "\n"'

# El reparto que espera al pastor es el momento del video: hay que ver que la
# regla rechace la línea, no solo que el reparto exista.
PENDIENTE="$(api "$API_URL/api/distributions" | leer 'd.distributions.find(x=>x.status==="TREASURER_APPROVED")?.id ?? ""')"
if [ -n "$PENDIENTE" ]; then
  printf '   %s\n' "$(api "$API_URL/api/distributions/$PENDIENTE" | leer '
    const malas = d.verdict.lines.filter((l) => !l.ok);
    "reglas       " + (malas.length
      ? "✅  bloquea " + malas.length + ": " +
        malas.map((l) => l.recipientName + " — " + l.violations.map((v) => v.code).join(", ")).join("; ")
      : "⚠️   no bloquea ninguna línea") +
    "\n   a pagar      $" + (d.verdict.payableCents / 100).toFixed(2) +
    " de $" + (d.verdict.lines.reduce((s, l) => s + l.amountCents, 0) / 100).toFixed(2) + " propuestos"')"
fi

RESUMEN="$(api "$API_URL/api/brief" | leer 'd.brief ? "sí" : "no"')"
if [ "$RESUMEN" = "no" ] && [ "$SOLO_ESTADO" != "--estado" ]; then
  printf '   resumen      falta el de esta semana, pidiéndolo...\n'
  api -X POST -H 'Content-Type: application/json' -d '{"locale":"en"}' "$API_URL/api/brief" >/dev/null || true
fi
printf '   %s\n' "$(api "$API_URL/api/brief" | leer '
  d.brief ? "resumen      ✅  escrito, semana del " + d.brief.weekOf.slice(0, 10) +
            " (" + d.brief.body.split(/\s+/).length + " palabras)"
          : "resumen      ⚠️   no hay resumen de esta semana"')"

api -X DELETE "$API_URL/api/session" >/dev/null

printf '\n   Abrir el demo en inglés:  %s/?lng=en\n' "${WEB_URL:-https://steward.e-ministry.online}"
printf '   (el ?lng=en pisa el idioma que el navegador haya recordado)\n'
echo -e "\n✅  Demo listo."
