# Minders — Bellezza Miami AI Shopping Assistant

Bilingual (EN/ES) AI chat widget for bellezzamiami.com. "Bella" helps customers find DIY nail products, answers application/safety questions, qualifies leads, and either closes the sale with a checkout link or hands off to a human agent.

## Key files

- [prompts/system.md](prompts/system.md) — Bella's system prompt. The single source of truth for her persona, tool contracts, qualification logic, and safety rules. Load this as the `system` message on every Claude API call.
- [schema.sql](schema.sql) — Postgres schema backing the seven tools the system prompt references (`extract_profile`, `search_products`, `search_brand_knowledge`, `update_lead_score`, `schedule_followup`, `handoff_to_agent`, `send_checkout_link`). Uses `pgvector` for product and brand-knowledge embeddings.
- [bellezza_miami_inventory.xlsx](bellezza_miami_inventory.xlsx) — source catalog to seed the `products` table.

## Architecture (target)

- **Backend:** FastAPI
  - `POST /chat` — streaming chat endpoint, Claude Sonnet 4.6+, tool-use orchestration
  - `POST /audio/transcribe` — Whisper for inbound voice notes
  - `POST /image/analyze` — vision for inspo photos / past-reaction photos
- **Model:** `claude-sonnet-4-6` (streaming on, suppress stream during tool resolution, show typing indicator)
- **DB:** Postgres + pgvector
- **Commerce:** Shopify cart links via `send_checkout_link`

## Per-request context injection

Before each Claude call, append a `<conversation_context>` block to the system prompt with:
- Current customer profile snapshot (from `customers` row)
- Last 8 messages
- Current page / referring product (if any)
- Customer-local timestamp

## Tool → storage map

| Tool | Backing store |
|------|---------------|
| `extract_profile` | `customers` (upsert) |
| `update_lead_score` | `customers.lead_score` + `lead_score_events` |
| `schedule_followup` | `followups` |
| `search_products` | `products.embedding` (pgvector RPC) |
| `search_brand_knowledge` | `brand_knowledge.embedding` (pgvector RPC) |
| `handoff_to_agent` | `conversations.status = 'handoff'` + dashboard ping |
| `send_checkout_link` | Shopify cart URL builder (no DB write beyond event log) |
