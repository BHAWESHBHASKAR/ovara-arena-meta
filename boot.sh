#!/bin/sh
# Boots the whole thing in one container:
#   1. the OVARA deployment directory (policy, proxy config, keys) if it is not there yet
#   2. a check that OVARA has the PayPal client credentials (it mints the tokens)
#   3. `ovara run`: gateway (:8080) and executor proxy (:9443), both loopback only
#   4. the API, which starts the agent and the wrapped PayPal MCP server itself
set -eu
: "${OVARA_DIR:=/srv/ovara}"
: "${PORT:=10000}"

./ovara/setup.sh "$OVARA_DIR"

# OVARA mints the PayPal sandbox token itself from PAYPAL_CLIENT_ID/SECRET (an
# oauth2 binding in proxy.json) and mints a new one before each expires, so
# nothing here holds a token and nothing needs a restart when one runs out.
if [ -z "${PAYPAL_CLIENT_ID:-}" ] || [ -z "${PAYPAL_CLIENT_SECRET:-}" ]; then
  echo "boot: PAYPAL_CLIENT_ID/SECRET not set; PayPal calls will fail at the proxy" >&2
fi

ovara run -dir "$OVARA_DIR" &
OVARA_PID=$!
# the gateway is up once it answers at all (401 without a token is fine)
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/v1/approval/pending)" != "000" ] && break
  sleep 1
done

cd api && exec node dist/server.js
