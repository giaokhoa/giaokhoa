#!/usr/bin/env bash
set -euo pipefail

# CI projects are disposable and must never overlap the developer's volumes.
[[ "$GITHUB_ACTIONS" == true && -n "$GITHUB_RUN_ID" ]]
export COMPOSE_PROJECT_NAME="gk-ci-dev-$GITHUB_RUN_ID"
test_project="gk-ci-test-$GITHUB_RUN_ID"
stub="gk-ci-stub-$GITHUB_RUN_ID"

dev() { docker compose -p "$COMPOSE_PROJECT_NAME" -f .devcontainer/compose.yml -f infra/compose.dev.yaml "$@"; }
test_stack() { docker compose -p "$test_project" -f infra/compose.test.yaml "$@"; }
cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then
    dev logs --tail 100 || true
    test_stack logs --tail 100 || true
  fi
  docker rm -f "$stub" >/dev/null 2>&1 || true
  test_stack down -v --remove-orphans || true
  dev down --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT

echo 'Validate Compose and Caddy'
dev config -q
test_stack config -q
dev config --format json | jq -e '
  (.services.keycloak.ports // [] | length) == 0 and
  (.services.gateway.networks.default.aliases | index("giaokhoa.localhost") != null) and
  (.services.gateway.networks.default.aliases | index("auth.giaokhoa.localhost") != null)
'
docker run --rm -v "$PWD/infra/gateway/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile

echo 'Start isolated stacks'
dev up -d app-db keycloak-db keycloak gateway mailpit
test_stack up -d

echo 'Check actual Keycloak OIDC metadata'
for attempt in $(seq 1 60); do
  if curl --noproxy '*' -fsS --max-time 5 -H 'Host: auth.giaokhoa.localhost:8081' \
      http://127.0.0.1:8081/realms/master/.well-known/openid-configuration > /tmp/dev-issuer.json \
    && curl --noproxy '*' -fsS --max-time 5 -H 'Host: auth.test.giaokhoa.localhost:18081' \
      http://127.0.0.1:18081/realms/master/.well-known/openid-configuration > /tmp/test-issuer.json; then
    break
  fi
  sleep 3
done
jq -e '.issuer == "http://auth.giaokhoa.localhost:8081/realms/master"' /tmp/dev-issuer.json
jq -e '.issuer == "http://auth.test.giaokhoa.localhost:18081/realms/master"' /tmp/test-issuer.json

echo 'Check PostgreSQL, volumes and isolated data'
dev exec -T app-db psql -U giaokhoa -d giaokhoa -Atc 'select current_database()' | grep -qx giaokhoa
test_stack exec -T test-app-db psql -U giaokhoa_test -d giaokhoa_test -Atc 'select current_database()' | grep -qx giaokhoa_test
dev exec -T keycloak-db psql -U keycloak -d keycloak -Atc 'select current_database()' | grep -qx keycloak
test_stack exec -T test-keycloak-db psql -U keycloak_test -d keycloak_test -Atc 'select current_database()' | grep -qx keycloak_test
docker network inspect "$COMPOSE_PROJECT_NAME"_default "$test_project"_default >/dev/null
docker volume inspect "$COMPOSE_PROJECT_NAME"_app_data "$COMPOSE_PROJECT_NAME"_keycloak_data \
  "$test_project"_test_app_data "$test_project"_test_keycloak_data >/dev/null
dev exec -T app-db psql -U giaokhoa -d giaokhoa -v ON_ERROR_STOP=1 -c 'create table ci_dev_probe (id int)'
test_stack exec -T test-app-db psql -U giaokhoa_test -d giaokhoa_test \
  -Atc "select to_regclass('public.ci_dev_probe') is null" | grep -qx t
test_stack exec -T test-app-db psql -U giaokhoa_test -d giaokhoa_test -v ON_ERROR_STOP=1 -c 'create table ci_test_probe (id int)'
dev exec -T app-db psql -U giaokhoa -d giaokhoa \
  -Atc "select to_regclass('public.ci_test_probe') is null" | grep -qx t
docker run --rm --network "$test_project"_default curlimages/curl:8.16.0 \
  --noproxy '*' -fsS --max-time 15 \
  http://test-keycloak:18081/realms/master/.well-known/openid-configuration \
  | jq -e '.issuer == "http://auth.test.giaokhoa.localhost:18081/realms/master"'

echo 'Check Mailpit SMTP/API'
python3 - <<'PY'
from email.message import EmailMessage
from smtplib import SMTP
m = EmailMessage()
m['From'] = 'ci@example.invalid'
m['To'] = 'recipient@example.invalid'
m['Subject'] = 'infra-smoke'
m.set_content('test')
with SMTP('127.0.0.1', 11025, timeout=10) as s:
    s.send_message(m)
PY
for attempt in $(seq 1 20); do
  if curl --noproxy '*' -fsS http://127.0.0.1:18025/api/v1/messages \
    | jq -e '[.messages[]? | select(.Subject == "infra-smoke")] | length > 0'; then
    break
  fi
  sleep 1
done
curl --noproxy '*' -fsS http://127.0.0.1:18025/api/v1/messages \
  | jq -e '[.messages[]? | select(.Subject == "infra-smoke")] | length > 0'

echo 'Check Caddy routing against local stub upstreams'
# shortcut: routing only; full Authorization Code/logout tokens require OIDC implementation.
cat > "$RUNNER_TEMP/infra-stub.py" <<'PY'
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from time import sleep
class Handler(BaseHTTPRequestHandler):
    def do_GET(self): self.reply()
    def do_POST(self): self.reply()
    def reply(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"spring" if self.server.server_port == 8080 else b"next")
    def log_message(self, *args): pass
for port in (8080, 3001):
    Thread(target=ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever, daemon=True).start()
while True: sleep(3600)
PY
docker run -d --name "$stub" --network "$COMPOSE_PROJECT_NAME"_default --network-alias app \
  -v "$RUNNER_TEMP/infra-stub.py:/stub.py:ro" python:3.13-alpine python /stub.py
response=''
for attempt in $(seq 1 30); do
  response=$(curl --noproxy '*' -fsS --max-time 5 -H 'Host: giaokhoa.localhost:3000' \
    http://127.0.0.1:3000/ 2>/dev/null) && [[ "$response" == next ]] && break
  sleep 2
done
[[ "$response" == next ]]
for path in /api/session /oauth2/authorization/keycloak /login/oauth2/code/keycloak /logout/connect/back-channel/keycloak; do
  response=$(curl --noproxy '*' -fsS --max-time 8 -X POST -H 'Host: giaokhoa.localhost:3000' \
    "http://127.0.0.1:3000$path")
  [[ "$response" == spring ]] || { echo "Wrong upstream: $path"; exit 1; }
done

echo 'Check callback from Keycloak network namespace using DNS, not curl localhost special case'
keycloak_id=$(dev ps -q keycloak)
docker run --rm --network "container:$keycloak_id" python:3.13-alpine python -c '
import socket, urllib.request
address=socket.gethostbyname("giaokhoa.localhost")
print("Callback DNS:", address)
assert not address.startswith("127."), "Callback resolved to loopback"
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
assert opener.open("http://giaokhoa.localhost:3000/", timeout=10).read() == b"next"
'
echo 'Infrastructure smoke passed'
