#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/huangguojie/nodelist-llm}"
BRANCH="${BRANCH:-release/videoTovideo}"
REPO_URL="${REPO_URL:-https://github.com/HaozaiGo/NodeList-LLM.git}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodelist-llm}"
DEPLOY_SKIP_PULL="${DEPLOY_SKIP_PULL:-0}"

if [ ! -d "$APP_DIR" ]; then
  mkdir -p "$APP_DIR"
fi

if [ "$DEPLOY_SKIP_PULL" != "1" ]; then
  if [ ! -d "$APP_DIR/.git" ]; then
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi

  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  cd "$APP_DIR"
fi

if [ ! -f backend/.env ]; then
  cat >&2 <<EOF
Missing backend/.env on the server.
Create $APP_DIR/backend/.env with the production environment variables before deploying.
EOF
  exit 1
fi

docker compose -p "$COMPOSE_PROJECT_NAME" up -d --build --remove-orphans
docker compose -p "$COMPOSE_PROJECT_NAME" ps

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null; then
    echo "Deployment healthy at http://127.0.0.1:8000"
    exit 0
  fi
  sleep 2
done

echo "Deployment started, but health check did not pass within 60 seconds." >&2
docker compose -p "$COMPOSE_PROJECT_NAME" logs --tail=120
exit 1
