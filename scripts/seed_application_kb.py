"""Seed brand_knowledge with application + beginner-tips entries for the DIY kit.

Six entries covering how to apply the no-lamp press-on Bellezza system. All
sourced to the DIY kit product page; specific quantitative claims (10s press,
15-20 min set time, 30 min cure) are taken from the brand's product guidance.

Idempotent: row IDs are derived from (topic, title) via uuid5 with the same
namespace as scripts/seed_brand_knowledge.py, so upserts in place rather than
creating duplicates.

Env required:
  DATABASE_URL    Supabase Postgres URL (session pooler).
  OPENAI_API_KEY

Install:
  pip install "psycopg[binary]" pgvector openai
"""
from __future__ import annotations

import os
import sys
import uuid

import psycopg
from openai import OpenAI
from pgvector.psycopg import register_vector

EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536
# Same namespace as seed_brand_knowledge.py so IDs are consistent across scripts.
NAMESPACE = uuid.UUID("6f3a8c2e-1d5b-4f7a-8b9c-0e1d2f3a4b5c")
SOURCE_URL = "https://bellezzamiami.com/products/diy-kit-coffin-shape"

ENTRIES: list[dict] = [
    {
        "topic": "application",
        "title": "How do I apply the nails?",
        "body": (
            "Start with clean, dry hands — wash, dry, then gently push back your "
            "cuticles with the pusher in your kit. Buff the shine off your natural "
            "nail with the file (this is what helps the glue grip), and if you have "
            "rubbing alcohol around, swipe each nail to dehydrate it. Size every tip "
            "to its finger before you start gluing — line them up so you're not "
            "scrambling later. Then go one nail at a time: thin layer of glue on the "
            "tip and on your nail, press down firmly for a full 10 seconds, hold "
            "steady, move on. Working one at a time keeps the glue from setting "
            "before you get a clean press."
        ),
    },
    {
        "topic": "application",
        "title": "How long does the application take?",
        "body": (
            "Once you've done it once, a full set takes about 15–20 minutes. Your "
            "first time will run longer because you're learning each step — set "
            "aside 30 minutes, queue up a podcast or playlist, and don't rush it. "
            "Speed comes the second time around."
        ),
    },
    {
        "topic": "beginner_tips",
        "title": "Common beginner mistakes when applying",
        "body": (
            "Four things trip up first-timers. One: using too much glue — you'll "
            "get bubbles trapped under the tip. Two: skipping the nail prep — your "
            "tips will pop off in a day. Three: choosing tips that are too big — "
            "always go one size down rather than up if you're between sizes. Four: "
            "rushing the 10-second press — the glue needs that full count to grip. "
            "Slow down on those four and you're golden."
        ),
    },
    {
        "topic": "application",
        "title": "How do I prep my natural nails?",
        "body": (
            "Trim them short — flush with your fingertip is ideal. Push your "
            "cuticles back gently with the pusher (don't cut them, just nudge). "
            "Run the file across the surface of each nail to take off the natural "
            "shine — this is the step that lets the glue actually grip. If you have "
            "rubbing alcohol or acetone, swipe each nail clean to dehydrate it; "
            "that last step makes a real difference in how long the set lasts."
        ),
    },
    {
        "topic": "application",
        "title": "Do I need any extra tools?",
        "body": (
            "Nope — the kit has everything. Tips, glue, file, buffer, cuticle "
            "pusher, and the application guide are all in there. No lamp, no UV, "
            "nothing external needed. The only optional add is rubbing alcohol or "
            "alcohol wipes if you want extra-clean prep, but you don't have to "
            "have them."
        ),
    },
    {
        "topic": "application",
        "title": "How long until the nails are fully set?",
        "body": (
            "The tips are wearable right after the 10-second press — you can use "
            "your hands immediately. To let the glue fully cure, though, hold off "
            "on water, heavy pressure, and lotion for the first 30 minutes. After "
            "that, you're good to go."
        ),
    },
]


def deterministic_id(topic: str, title: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"{topic}|{title}")


def main() -> int:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set", file=sys.stderr)
        return 1
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY not set", file=sys.stderr)
        return 1

    client = OpenAI()
    inputs = [f"{e['title']}\n\n{e['body']}" for e in ENTRIES]
    resp = client.embeddings.create(model=EMBED_MODEL, input=inputs)
    embeddings = [d.embedding for d in resp.data]
    if any(len(v) != EMBED_DIM for v in embeddings):
        print(f"embedding dim mismatch (expected {EMBED_DIM})", file=sys.stderr)
        return 1

    rows = [
        (
            str(deterministic_id(e["topic"], e["title"])),
            e["topic"],
            e["title"],
            e["body"],
            SOURCE_URL,
            v,
        )
        for e, v in zip(ENTRIES, embeddings)
    ]

    with psycopg.connect(db_url) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            cur.executemany(
                """
                insert into brand_knowledge (id, topic, title, body, source_url, embedding)
                values (%s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                    topic      = excluded.topic,
                    title      = excluded.title,
                    body       = excluded.body,
                    source_url = excluded.source_url,
                    embedding  = excluded.embedding;
                """,
                rows,
            )
            cur.execute(
                """
                select topic, count(*) as n
                  from brand_knowledge
                 where topic in ('application', 'beginner_tips')
                 group by topic
                 order by topic
                """
            )
            counts = cur.fetchall()
        conn.commit()

    print(f"upserted {len(rows)} rows")
    print("after seed, brand_knowledge counts for application + beginner_tips:")
    for topic, n in counts:
        print(f"  {topic:14} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
