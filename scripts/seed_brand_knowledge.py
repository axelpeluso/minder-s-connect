"""Seed the brand_knowledge table from seed_data/brand_knowledge.json.

Idempotent: row IDs are derived from (topic, question) via uuid5, so re-running
upserts in place rather than creating duplicates.

Env required:
  DATABASE_URL    Postgres connection string for the Supabase project
                  (Project Settings -> Database -> Connection string -> URI).
  OPENAI_API_KEY  For the embeddings call.

Install:
  pip install "psycopg[binary]" pgvector openai
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

import psycopg
from openai import OpenAI
from pgvector.psycopg import register_vector

ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "seed_data" / "brand_knowledge.json"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536
NAMESPACE = uuid.UUID("6f3a8c2e-1d5b-4f7a-8b9c-0e1d2f3a4b5c")


def deterministic_id(topic: str, question: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"{topic}|{question}")


def main() -> int:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set", file=sys.stderr)
        return 1
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY not set", file=sys.stderr)
        return 1

    entries = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    if not entries:
        print("no entries to seed", file=sys.stderr)
        return 1

    client = OpenAI()
    inputs = [f"{e['question']}\n\n{e['answer']}" for e in entries]
    resp = client.embeddings.create(model=EMBED_MODEL, input=inputs)
    embeddings = [d.embedding for d in resp.data]

    if any(len(v) != EMBED_DIM for v in embeddings):
        print(f"embedding dim mismatch (expected {EMBED_DIM})", file=sys.stderr)
        return 1

    rows = [
        (
            str(deterministic_id(e["topic"], e["question"])),
            e["topic"],
            e["question"],
            e["answer"],
            e.get("source"),
            v,
        )
        for e, v in zip(entries, embeddings)
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
        conn.commit()

    print(f"upserted {len(rows)} brand_knowledge rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
