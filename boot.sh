#!/bin/sh
# Boots the whole thing in one container:
#   1. the OVARA deployment directory (policy, proxy config, keys) if it is not there yet
#   2. a PayPal sandbox access token for OVARA's environment (refreshed by the API later)
#   3. `ovara run`: gateway (:8080) and executor proxy (:9443), both loopback only
#   4. the API, which starts the agent and the wrapped PayPal MCP server itself
set -eu
: "${OVARA_DIR:=/srv/ovara}"
: "${PORT:=10000}"

./ovara/setup.sh "$OVARA_DIR"

if [ -n "${PAYPAL_CLIENT_ID:-}" ] && [ -n "${PAYPAL_CLIENT_SECRET:-}" ]; then
  PAYPAL_ACCESS_TOKEN="$(curl -s -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" -d grant_type=client_credentials \
      https://api-m.sandbox.paypal.com/v1/oauth2/token | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')"
  export PAYPAL_ACCESS_TOKEN
  [ -n "$PAYPAL_ACCESS_TOKEN" ] || echo "boot: no PayPal token (check PAYPAL_CLIENT_ID/SECRET); PayPal calls will fail at the proxy" >&2
else
  echo "boot: PAYPAL_CLIENT_ID/SECRET not set; running without PayPal credentials" >&2
fi

ovara run -dir "$OVARA_DIR" &
OVARA_PID=$!
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:8080/healthz >/dev/null 2>&1 && break
  sleep 1
done

cd api && exec node dist/server.js
