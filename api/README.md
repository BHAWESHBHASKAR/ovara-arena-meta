# api

The API, the agent loop and the scenarios. The contract is `docs/design.md`; this file covers how to run it.

```
npm install
npm test            # unit tests (node:test): arguments_sha256, <think> stripping, feed, rule drafting helpers
npm run build       # tsc -> dist/server.js
npm run dev         # tsx watch src/server.ts
node dist/server.js
```

It needs a running `ovara run -dir $OVARA_DIR` (gateway on 127.0.0.1:8080, proxy on 127.0.0.1:9443) whose own environment holds `PAYPAL_ACCESS_TOKEN`; `boot.sh` does that in the container. The API starts the PayPal MCP server itself, as `ovara mcp wrap -dir $OVARA_DIR -name paypal -- $PAYPAL_MCP_CMD` inside `ovara env`, so the server sees OVARA's placeholder token and its HTTPS goes through the proxy, which adds the real one.

## Environment

| Variable | Default | What |
|---|---|---|
| `OVARA_DIR` | `/srv/ovara` | the OVARA deployment directory (`config.json`, `policy.json`, `proxy.json`, `var/`). The operator token is read from `config.json`. |
| `OVARA_BIN` | `ovara` | the `ovara` binary (`env`, `mcp wrap`, `approve -remember`, `log -verify-only`) |
| `OVARA_GATEWAY_URL` | `http://127.0.0.1:8080` | the gateway's REST API |
| `OVARA_PAY_CONF` | `../ovara` | where `policy.paypal.json` is; rules listed there show as `origin: "paypal"` |
| `STATE_DIR` | `$OVARA_DIR/ovara-pay` | the API's own files: `seed.json` (sandbox ids), `policy-state.json` (profile, drafts), `runs/<task>.json` (each run's feed, the source for `replay.json`) |
| `PORT` | `10000` | HTTP port: `/api/*` and the console from `../web/dist` (a one-line placeholder if it is not built) |
| `API_TOKEN` | none | if set, every `/api/*` write needs `Authorization: Bearer <API_TOKEN>`; reads stay open |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | none | sandbox app credentials. The API uses them only for the seed step and for the "OVARA off" run; the wrapped MCP server never gets them. |
| `PAYPAL_ACCESS_TOKEN` | none | used by the API only when the client id and secret are absent. The `ovara run` process needs it in its own environment for the proxy. |
| `PAYPAL_MCP_CMD` | `npx -y @paypal/mcp --tools=all` | the PayPal MCP server command, split on spaces. The image sets it to the globally installed package. |
| `META_API_KEY` | none | Meta Model API key for the models |
| `META_BASE_URL` | `https://api.meta.ai/v1` | |
| `AGENT_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | the agent |
| `DRAFTER_MODEL` | `nvidia/Nemotron-3-Ultra-550b-a55b` | the rule drafter |
| `DAILY_TASKS` | `60` | tasks accepted per UTC day; the 61st gets HTTP 429 |
| `TASK_TOKEN_CAP` | `200000` | model tokens per task; a task over it stops. The 16 PayPal tool schemas go with every step, about 10k tokens a step, so a 12-step task stays under it. |
| `MAX_STEPS` | `12` | model turns per task |

## Spend

Measured on the `shift` scenario (8 model turns, one tool call per turn): about 89k tokens in total, nearly all of it input (the tool schemas). With `DAILY_TASKS=60` and the token cap, the worst case is 60 x 200k = 12M tokens a day; check the current Meta Model API price for the models before you raise either number.

## Sandbox data

On first boot the API creates, in the PayPal sandbox: an overdue invoice (Tailspin Toys), an open one (Contoso), an open one for Northwind whose note is the injected instruction from the design, and two identical Northwind orders (the double billing). `GET /api/seed` shows the ids.

The orders need a sandbox buyer once: PayPal does not let a merchant capture an order without the buyer's approval, and the sandbox app has no card processing (`PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`). Open each `approve_url` from `GET /api/seed`, log in with a sandbox personal account, approve, then `POST /api/seed`: it captures approved orders and keeps the capture ids. Until then the `refund` scenario runs, but there is no capture to refund.

## Not in the contract

- `GET /api/seed`, `POST /api/seed`: the sandbox ids, and a re-run of the seed step.
- `GET /api/feed?task_id=...`: the feed of one task.
- `GET /api/state`: `paypal.seed` (`none | partial | needs_buyer_approval | ready`), `ovara.pins_approval_id` while the tool definitions wait, `error` when `boot` is `degraded`.
- `GET /api/approvals` items also carry `resource` and `task_id`; a held HTTP request (not expected with the PayPal policy) comes as `kind: "http"`.
- `GET /api/receipts` rows carry `source` (`gateway` or `proxy`) and, for proxy rows, `http_status`.
- Feed `decision` items in an "OVARA off" run have `outcome: "allowed"`, `unchecked: true` and `rule: "not checked: OVARA off"`: nothing decided them.
