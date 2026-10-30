# OVARA for PayPal agents

An AI agent runs a business's PayPal (invoices, refunds, orders) with OVARA between the agent and PayPal. Reads go through; anything that moves money is held for a person; a poisoned note that tries to redirect money is stopped; every decision is a signed, hash-chained receipt.

Built for the PayPal AI Hackathon on top of the open-source [OVARA](https://github.com/SidianLabs/OVARA) gateway (Go, Apache-2.0) and PayPal's official [MCP server](https://www.npmjs.com/package/@paypal/mcp), in the PayPal sandbox.

Status: in progress. See `docs/plan.md`.
