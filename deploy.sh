#!/usr/bin/env bash
# Despliega Steward AI al droplet de e-Ministry.
#
#   ./deploy.sh            despliega
#   ./deploy.sh --probar   solo los chequeos, no toca el servidor
#
# Por qué el frontend se compila ACÁ y no allá: el droplet tiene un núcleo,
# 1.9 GB y nginx corre con un worker en ese mismo núcleo. Vite se lo come
# entero y los saludos TLS del sitio de la iglesia empiezan a morir. El
# backend sí se compila allá: tsc solo es mucho más liviano que un bundle.
set -euo pipefail

KEY="$HOME/.ssh/eministry_deploy"
HOST="root@159.65.240.211"
APP="/home/deploy/apps/steward-ai"
REPO="https://github.com/crvini/steward-ai.git"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOLO_PROBAR="${1:-}"

paso() { printf '\n▶  %s\n' "$1"; }

paso "Que compile antes de subir nada"
pnpm typecheck
pnpm test
echo "✅  Compila y los tests pasan."

paso "Que no quede nada sin pushear"
# El servidor hace git pull: un commit local sin subir significa que allá se
# despliega código viejo y el deploy "no hace nada" sin decir por qué.
if [ -n "$(git -C "$RAIZ" status --porcelain)" ]; then
  echo "⚠️   Hay cambios sin commitear:"
  git -C "$RAIZ" status --short
  read -r -p "    ¿Seguir igual? [s/N] " ok
  [ "$ok" = "s" ] || exit 1
fi
if [ -n "$(git -C "$RAIZ" log --branches --not --remotes --oneline)" ]; then
  echo "✖  Hay commits sin pushear. Corré 'git push' primero:"
  git -C "$RAIZ" log --branches --not --remotes --oneline
  exit 1
fi

paso "Compilando el frontend acá"
pnpm build:web
[ -f "$RAIZ/apps/web/dist/index.html" ] || { echo "✖  El build del web no produjo index.html"; exit 1; }

if [ "$SOLO_PROBAR" = "--probar" ]; then
  echo -e "\n✅  Chequeos OK. No se tocó el servidor (--probar)."
  exit 0
fi

paso "Backend: git pull, deps, prisma y build en el servidor"
ssh -i "$KEY" "$HOST" "su - deploy -c '
set -e
cd $APP
# git clone falla si la carpeta no está vacía, y acá ya vive el .env (que
# está en .gitignore, así que el reset --hard no lo toca).
if [ ! -d .git ]; then
  git init -q -b main
  git remote add origin $REPO
fi
git fetch -q origin main
git reset -q --hard origin/main
pnpm install --frozen-lockfile --silent
pnpm db:generate
pnpm db:deploy
pnpm build:api
'"

paso "Frontend: subiendo el bundle ya compilado"
# --delete deja la carpeta idéntica al build: sin esto los assets viejos con
# hash se acumulan para siempre.
rsync -az --delete -e "ssh -i $KEY" "$RAIZ/apps/web/dist/" "$HOST:$APP/web/"
ssh -i "$KEY" "$HOST" "chown -R deploy:deploy $APP/web"

paso "Reiniciando el proceso"
ssh -i "$KEY" "$HOST" "su - deploy -c '
cd $APP
pm2 describe steward-api >/dev/null 2>&1 \
  && pm2 restart steward-api --update-env \
  || pm2 start apps/api/dist/index.js --name steward-api --cwd $APP
pm2 save
'"

paso "Comprobando que responda de verdad"
# Un reload sin errores no significa que el sitio funcione: hay que pedirle
# una página y mirar el código.
sleep 3
for u in https://api-steward.e-ministry.online/health https://steward.e-ministry.online/; do
  code=$(curl -sS -o /dev/null -m 30 -w '%{http_code}' "$u" || echo 000)
  printf '   %-52s HTTP %s\n' "$u" "$code"
  [ "$code" = "200" ] || { echo "✖  $u no respondió 200."; exit 1; }
done

echo -e "\n✅  Steward AI desplegado."
