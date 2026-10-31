#!/bin/sh
# Prepares an OVARA deployment directory: `ovara init`, then the PayPal rules and
# credentials in front of the defaults. Idempotent; run at image build or first boot.
set -eu
DIR="${1:-/srv/ovara}"
mkdir -p "$DIR"
[ -f "$DIR/policy.json" ] || ovara init "$DIR" >/dev/null
python3 - "$DIR" <<'PY'
import json, sys, os
d = sys.argv[1]; here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else "/opt/ovara-pay/ovara"
here = os.environ.get("OVARA_PAY_CONF", "/opt/ovara-pay/ovara")
pol = json.load(open(f"{d}/policy.json")); add = json.load(open(f"{here}/policy.paypal.json"))["rules"]
mine = {(r["action_type"], r["resource"]) for r in add}
pol["rules"] = add + [r for r in pol["rules"] if (r["action_type"], r.get("resource")) not in mine]
json.dump(pol, open(f"{d}/policy.json", "w"), indent=2)
px = json.load(open(f"{d}/proxy.json")); over = json.load(open(f"{here}/proxy.paypal.json"))
px["escalate_timeout_sec"] = over["escalate_timeout_sec"]
px["credentials"] = [c for c in (px.get("credentials") or []) if "paypal" not in c.get("host", "")] + over["credentials"]
json.dump(px, open(f"{d}/proxy.json", "w"), indent=2)
PY
# The PayPal server's tool definitions, pinned by the operator once (30 Oct 2026,
# @paypal/mcp 1.8.1, the tool list in the Dockerfile). Shipped so a fresh
# deployment does not wait on a pin approval; OVARA still asks if a definition
# differs from the pinned hash.
mkdir -p "$DIR/var"
[ -f "$DIR/var/mcp_pins.json" ] || cp "${OVARA_PAY_CONF:-/opt/ovara-pay/ovara}/mcp_pins.paypal.json" "$DIR/var/mcp_pins.json"
echo "ovara ready in $DIR"
