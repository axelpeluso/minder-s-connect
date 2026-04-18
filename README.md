Bella is a conversational commerce layer built for [Bellezza Miami](https://bellezzamiami.com), a bilingual DIY nail-products brand. It replaces the static "Contact Us" form with an embedded AI shopping assistant that listens, remembers, recommends, and qualifies — turning every website visitor into a living customer profile in a self-writing CRM.

Built for the Emerge Hackathon 2026.

---

## What it does

A customer visits Bellezza's storefront, taps a chat bubble, and lands in a conversation with **Bella** — an AI assistant who speaks fluent English and Spanish, accepts voice notes and photos, knows the product catalog, answers objections grounded in real brand knowledge, and closes with a one-tap checkout link when the customer is ready to buy.

While the customer is chatting, a profile is built automatically in the background — nail shape, experience level, skin sensitivity, occasion, urgency, budget, language, sentiment. Every signal is extracted from natural conversation. No forms. No dropdowns. Just chat.

The Bellezza team sees it all live in a dashboard — every active conversation, every customer profile, every lead score, in real time. When a customer needs a human, one click hands off the conversation with a pre-drafted suggested reply and the agent takes over seamlessly in the same thread.

## The demo moment

1. A customer opens Bellezza's storefront and taps the floating chat bubble
2. She sends a voice note in Spanish — *"Hola, tengo una boda el sábado y nunca me he puesto uñas en casa"*
3. Within three seconds: the audio transcribes, Bella replies in Spanish with a tailored beginner bundle, and an "Open checkout" button renders with the real product link
4. In a second browser window, the dashboard lights up live: new customer "Maria", language Spanish, shape almond, experience beginner, urgency 3 days, occasion wedding, **lead score 82**
5. The agent clicks "Take over" and replies as herself — the customer sees the handoff mid-conversation

Ninety seconds. End to end. On a page that looks exactly like Bellezza's real storefront.

## Architecture

Four deployed pieces, one shared Supabase database.

```
┌────────────┐     ┌──────────────┐     ┌────────────┐     ┌──────────────┐
│   Widget   │────▶│   Backend    │────▶│  Supabase  │◀────│  Dashboard   │
│ Cloudflare │     │   Railway    │     │ Postgres + │     │   Lovable    │
│    Pages   │◀────│   FastAPI    │◀────│  Realtime  │────▶│  Next.js UI  │
└────────────┘     └──────────────┘     └────────────┘     └──────────────┘
       ▲                   │                    ▲
       │                   ▼                    │
┌────────────┐     ┌──────────────┐             │
│  Bellezza  │     │ Claude + GPT │             │
│   clone    │     │  + Whisper   │             │
│  (Vercel)  │     └──────────────┘             │
└────────────┘                                  │
                                                │
                        [No direct link between Backend and Dashboard —
                         they share a database, and Supabase Realtime
                         pushes changes to both sides in under a second.]
```

**Database as API.** The backend writes rows to Supabase; the dashboard subscribes to the same rows via Realtime. Neither service calls the other — the schema is the contract.

## Tech stack

- **Backend** — Python 3.13, FastAPI, Anthropic Claude Sonnet (conversation + tool orchestration), OpenAI Whisper (voice-note transcription), Claude vision (nail/product image analysis), async psycopg with pgvector for semantic retrieval
- **Widget** — vanilla JS, single-file embed, Server-Sent Events for streaming replies, MediaRecorder for in-browser audio capture
- **Database** — Supabase (PostgreSQL + pgvector + Storage + Realtime + Auth)
- **Dashboard** — Lovable (Vite + React + shadcn), live via Supabase Realtime subscriptions
- **Hosting** — Railway (backend), Cloudflare Pages (widget), Vercel (Bellezza clone), Lovable (dashboard)

## The AI layer

Bella is grounded in a hand-curated knowledge base seeded directly from bellezzamiami.com (FAQs, policies, product pages) plus authored entries for application walkthroughs and objection handling. Every factual claim is RAG-grounded against this corpus — no hallucinated shipping times, no invented return policies, no fake product specs.

Seven tools are wired to the database and fire silently during conversation:

- `extract_profile` — structured field extraction on every inbound message
- `search_products` — semantic + attribute search over the 17-SKU catalog
- `search_brand_knowledge` — vector retrieval over 26 brand-voice KB entries
- `update_lead_score` — weighted 40/30/30 composite of intent, fit, and urgency
- `schedule_followup` — contextual re-engagement when a customer goes quiet
- `handoff_to_agent` — reserved for medical questions and complex edge cases
- `send_checkout_link` — generates a real Bellezza cart URL with SKUs pre-loaded

## Repo structure

```
minders/
├── backend/              FastAPI service — 7 tools, Claude streaming, Whisper, vision
├── widget/               Embeddable chat widget (single JS file)
├── dashboard/            Lovable-generated CRM dashboard (snapshot)
├── bellezza-clone/       Static clone of bellezzamiami.com for demo
├── scripts/              Seed + website-ingest pipelines
├── migrations/           SQL migrations 001–008
├── prompts/              system.md — the chatbot's runtime instructions
├── seed_data/            brand_knowledge.json, product inventory
├── schema.sql            Full deployed schema (truthful to live DB)
└── .env.example          Template for local dev (real keys never committed)
```

## Running locally

Requires Python 3.11+, Node 20+, a Supabase project, and API keys for Anthropic and OpenAI.

```bash
# 1. Clone
git clone https://github.com/axelpeluso/minders-emergehackathon2026.git
cd minders-emergehackathon2026

# 2. Environment
cp backend/.env.example backend/.env
# Edit backend/.env with your DATABASE_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

# 3. Database
psql $DATABASE_URL < schema.sql
for f in migrations/*.sql; do psql $DATABASE_URL < "$f"; done
python scripts/seed_products.py
python scripts/seed_brand_knowledge.py
python scripts/seed_application_kb.py

# 4. Backend
cd backend
pip install -r requirements.txt
python run.py                         # http://localhost:8000

# 5. Widget (in another terminal)
cd widget
python -m http.server 5500            # http://localhost:5500
```
