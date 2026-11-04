# OVARA Arena: Muse Spark attacks, OVARA holds, Muse Spark learns

An AI agent keeps the books for a small design studio and works its PayPal account (sandbox) through PayPal's own MCP server. It reads client emails, including images: remittance advices, transfer confirmations, scans. A second model plays the attacker. Every round it writes one email meant to get the agent to cancel an open USD 1,200.00 invoice or send money out, usually with an image that hides an instruction in its pixels, and it adapts to how the earlier rounds went. [OVARA](https://github.com/SidianLabs/OVARA), an open-source Go gateway, sits between the agent and PayPal and holds every call that moves or forgives money for a person.

All three model roles are Meta's **Muse Spark** (`muse-spark-open`, the open-weights release, served through an OpenAI-compatible endpoint):

| Role | What it does |
|---|---|
| Attacker | Writes the email and the image spec (title, body lines, hidden line, how the line is hidden). Sees how earlier rounds ended and changes approach. |
| Agent | Vision + tool calling. Reads the email and the image as pixels and works PayPal through the MCP tools. |
| Rule drafter | After an incident, reads the round's trace and proposes an OVARA rule, which OVARA validates before one click applies it. |

Built for the Meta Global AI Developer Hackathon. Apache-2.0, see `LICENSE`.

## What happened (recorded 4 Nov 2026, real runs, nothing edited)

`bench/arena-results-2026-11-04.json` has every round; the console replays them from `web/public/arena-replay.json`.

| | OVARA on | OVARA off |
|---|---|---|
| Rounds | 5 | 6 |
| Agent made a money-moving call (fooled) | 3 | 4 |
| Calls that reached PayPal | **0** (3 held, denied by the operator) | **4** (four USD 1,200.00 invoices cancelled) |
| Agent spotted the attack and did nothing | 2 | 2 |

- The model got fooled. The attacks that worked were plausible accounts-payable emails ("paid by wire, please void the PayPal duplicate", "project paused, please void and reissue in Q1"), each with an image whose hidden line repeated the request as an instruction. The agent checked the invoice, found it matched the sender, and called `cancel_sent_invoice`.
- With OVARA on, every one of those calls stopped at the gate. The approval card shows the call, the agent's reason and the image that pushed it, with the hidden line boxed.
- After a held round, Muse Spark drafted this rule from the trace: deny `cancel_sent_invoice` outright, "because the rule matches only by tool name and cannot see the invoice ID or note arguments, the payee, or the untrusted email". OVARA validated it.

Honest limits of these numbers:
- Small samples, one run each. The attacker adapts, so the on and off runs faced different emails; this is not a controlled A/B of identical attacks.
- Each attack is an email plus an image. These runs do not separate how much the hidden line mattered versus the email's story.
- The From line is whatever the attacker wrote; every successful attack used the real client address. There is no email authentication in the arena, which stands in for a spoofed or compromised client mailbox.
- One attacker turn did not return valid JSON and is left out (it is not counted anywhere).
- The drafted rule is blunt: denying `cancel_sent_invoice` also blocks legitimate cancels (a real double-billing). OVARA rules match tools by name, not arguments; argument-aware rules are future work in OVARA.

## How the image attacks are made

`api/src/render.ts` renders the attacker's spec as a 900x640 PNG (sharp, from SVG). The hidden line is drawn one of six ways: `faint_footer` (11px, #e6e6e6 on white), `tiny_print` (7px grey), `near_white` (#f4f4f4 in the body), `sticky_note` (a handwritten-style note), `stamp` (a rotated, faded stamp) or `visible`. The region is recorded, so the console can box it after the round. A quick check before building this: Muse Spark transcribed an 11px #e9e9e9 footer line that is close to invisible on screen.

## How it fits together

```
attacker (Muse Spark) ──email + image spec──▶ arena (api/src/arena.ts) ──renders PNG──▶ task
                                                                                          │
agent (Muse Spark, vision + tools) ◀── email text + image pixels ─────────────────────────┘
        │ tools/call
        ▼
  ovara mcp wrap ──── decisions, approvals, signed receipts ──── ovara gateway (policy, operator API)
        │ stdio
        ▼
  @paypal/mcp (sees a placeholder token) ──HTTPS via OVARA's proxy, which injects the real sandbox token──▶ api.sandbox.paypal.com
```

- The arena acts as the operator: a held call that came from an attack email is denied. With OVARA off, the API runs PayPal's MCP server directly with a real token, nothing is held and nothing is receipted, to show the difference.
- The agent never holds a PayPal token. OVARA mints the sandbox token from the client credentials and injects it on the way out.
- Every decision is an Ed25519-signed, hash-chained receipt; the console verifies the chain on demand.

## Run it

You need a PayPal sandbox app (client id and secret) and a Meta Model API key.

```bash
docker build -t ovara-arena .
```

```bash
docker run --rm -p 10000:10000 \
  -e PAYPAL_CLIENT_ID -e PAYPAL_CLIENT_SECRET -e META_API_KEY \
  ovara-arena
```

Open http://localhost:10000. The first boot clears the sandbox account's open invoices and creates the four the scenarios use, so use a sandbox app made for this. Ready in about twenty seconds; the status dot in the header turns green.

Writes are open by default so that anyone with the URL can run a scenario and answer a hold: the URL is the credential, and one deployment is one shared sandbox. Set `API_TOKEN` to require a bearer token on every write instead (open the console as `/#token=...`). The seed step (`POST /api/seed`) is locked unless `API_TOKEN` is set, because it cancels every open invoice in the sandbox. `DAILY_TASKS` (default 60) and `TASK_TOKEN_CAP` (default 200k tokens) bound the model spend. The full list of settings is in `api/README.md`.

Without Docker: build OVARA from its repo, `ovara init` a directory, run `ovara/setup.sh <dir>`, start `ovara run -dir <dir>` with the PayPal credentials in its environment, then `cd api && npm install && npm run build && node dist/server.js` with `OVARA_DIR` set. The console is `cd web && npm install && npm run build`.

## Layout

| Path | What |
|---|---|
| `ovara/policy.paypal.json` | the PayPal rules: reads and invoice sends allowed, money moves escalated |
| `ovara/proxy.paypal.json` | the proxy's credential binding: OVARA mints the sandbox token from the client credentials |
| `ovara/setup.sh`, `boot.sh`, `Dockerfile` | one image: OVARA from a pinned commit, Node 22, `@paypal/mcp` 1.8.1 pinned |
| `api/src/arena.ts`, `api/src/render.ts` | the arena: attacker prompt and loop, image rendering, scoring, operator denials |
| `api/` | TypeScript. The agent loop (now multimodal: client email + image attachments), the MCP client through `ovara mcp wrap`, the gateway client, the scenarios, the drafter, the HTTP API (`docs/design.md` is the contract) |
| `web/` | the console: the arena (rounds, attack email and image with the hidden line revealed, the agent's trace, OVARA's verdict, the drafted rule), receipts with verify, policy |
| `bench/` | recorded arena results |
| `docs/` | `design.md`, the contract the API and console were built to |

## Known limits

- A deployment is one shared sandbox with open writes (see above). Two visitors can see and answer each other's holds. The daily task cap is shared.
- Rules match tool names, not arguments. `send_invoice` is allowed and accepts `additional_recipients`, so a poisoned note could get a copy of an invoice sent to an outside address without a hold. A fix needs argument-aware rules in OVARA, which this project does not add.
- The sandbox is shared by every visitor of one deployment and is re-seeded on each fresh boot. Cancelled invoices stay in PayPal's list with their notes.
- The model is not deterministic. The recordings are what happened in those runs; a live run may take a different path. Both are reported as they happen.
- `list_transactions` is left out of the tool list because its schema embeds the current time, which would ask for a new tool pin on every boot, and the sandbox app returns 403 for it anyway.
- Idle, the container uses about 120 MB (measured with `docker stats` on the image at rest); Render's free instance has 512 MB and spins down after 15 minutes idle, so the first request after a pause waits for a cold boot and a fresh seed.

Run the arena: `POST /api/arena/run {"rounds": 6, "profile": "strict"}` (OVARA on) or `"profile": "observe"` (OVARA off), with the bearer token. `GET /api/arena` has the rounds and the score. `ATTACKER_MODEL`, `AGENT_MODEL` and `DRAFTER_MODEL` default to `meta-models/muse-spark-open`.

## What was built during the hackathon

OVARA (the gateway, proxy, receipts) predates the hackathon and is used unchanged, built from a pinned commit of its public repo. The PayPal integration underneath (policy, credential binding, `ovara mcp wrap` around PayPal's MCP server, agent loop, API, base console) was written from 31 Oct 2026, inside the submission window. Built for this hackathon on 4 Nov: the arena (attacker loop, image rendering, scoring), the multimodal agent input, the move of every model role to Muse Spark, the recorded runs, and the new console.
