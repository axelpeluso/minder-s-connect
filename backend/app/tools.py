"""Tool schemas (for Claude) and Python handlers (write to Postgres)."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

from openai import AsyncOpenAI

from .db import conn

logger = logging.getLogger(__name__)

EMBED_MODEL = os.environ.get("EMBED_MODEL", "text-embedding-3-small")
STORE_DOMAIN = os.environ.get("STORE_DOMAIN", "https://bellezzamiami.com")

_openai: AsyncOpenAI | None = None


def get_openai() -> AsyncOpenAI:
    global _openai
    if _openai is None:
        _openai = AsyncOpenAI()
    return _openai


# backward-compat alias
_get_openai = get_openai


# ---------- Tool definitions for Claude ----------

TOOL_DEFINITIONS: list[dict] = [
    {
        "name": "extract_profile",
        "description": (
            "Save structured customer information extracted from the conversation. "
            "Call on every meaningful inbound message with whatever new fields you can infer."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Customer's first name (or full name if she offered it)."},
                "email": {"type": "string", "description": "Customer's email. Only save if she actually gave it to you."},
                "phone": {"type": "string", "description": "Customer's phone. Only save if she actually gave it to you."},
                "nail_shape": {"type": "string", "enum": ["square", "almond", "coffin", "round", "oval"]},
                "color_family": {"type": "string"},
                "finish": {"type": "string"},
                "experience_level": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]},
                "occasion": {"type": "string"},
                "urgency_days": {"type": "integer"},
                "budget_range": {"type": "string"},
                "hema_concerns": {"type": "boolean"},
                "past_reactions": {"type": "boolean"},
                "sensitive_skin": {"type": "boolean"},
                "preferred_language": {"type": "string", "enum": ["en", "es"]},
                "intent": {"type": "string", "enum": ["browsing", "considering", "ready_to_buy", "purchased", "lost"]},
                "metadata": {"type": "object", "description": "Freeform fields not covered above. Merged into customer.metadata."},
            },
        },
    },
    {
        "name": "search_products",
        "description": "Vector + attribute search over the Bellezza catalog. Returns up to `limit` products.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "filters": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "enum": ["diy_kit", "soft_gel_tips", "cuticle_care", "nail_preparation", "paint_and_slay"]},
                        "shape": {"type": "string", "enum": ["square", "almond", "coffin", "round", "oval"]},
                        "color": {"type": "string"},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "in_stock": {"type": "boolean"},
                    },
                },
                "limit": {"type": "integer", "default": 5},
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_brand_knowledge",
        "description": "Vector search over Bellezza's brand/FAQ corpus. Always call before making factual claims.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 3},
            },
            "required": ["query"],
        },
    },
    {
        "name": "update_lead_score",
        "description": "Update the customer's lead score with a per-factor breakdown.",
        "input_schema": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "minimum": 0, "maximum": 100},
                "factors": {
                    "type": "object",
                    "properties": {
                        "intent": {"type": "integer"},
                        "fit": {"type": "integer"},
                        "urgency": {"type": "integer"},
                    },
                },
                "reason": {"type": "string"},
            },
            "required": ["score", "factors", "reason"],
        },
    },
    {
        "name": "schedule_followup",
        "description": "Schedule a contextual follow-up message if the customer goes quiet after showing interest.",
        "input_schema": {
            "type": "object",
            "properties": {
                "delay_hours": {"type": "number"},
                "context_reference": {"type": "string"},
                "message_template": {"type": "string"},
            },
            "required": ["delay_hours", "context_reference", "message_template"],
        },
    },
    {
        "name": "handoff_to_agent",
        "description": "Escalate to a human agent. Use for medical context, order issues, or anything beyond your competence.",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "suggested_reply": {"type": "string"},
            },
            "required": ["summary"],
        },
    },
    {
        "name": "send_checkout_link",
        "description": "Generate a checkout URL with the recommended products pre-loaded and log the event.",
        "input_schema": {
            "type": "object",
            "properties": {
                "product_ids": {"type": "array", "items": {"type": "string"}, "description": "Product UUIDs from search_products."},
                "note": {"type": "string"},
            },
            "required": ["product_ids"],
        },
    },
]


# ---------- Handlers ----------

_PROFILE_COLS = {
    "name", "email", "phone",
    "nail_shape", "color_family", "finish", "experience_level", "occasion",
    "urgency_days", "budget_range", "hema_concerns", "past_reactions",
    "sensitive_skin", "preferred_language", "intent",
}


async def handle_extract_profile(customer_id: str, args: dict) -> dict:
    if not args:
        return {"updated": False, "reason": "no fields"}
    metadata = args.pop("metadata", None)
    cols = [k for k in args if k in _PROFILE_COLS and args[k] is not None]
    async with conn() as c, c.cursor() as cur:
        if cols:
            sets = ", ".join(f"{k} = %s" for k in cols)
            await cur.execute(
                f"update customers set {sets} where id = %s",
                [args[k] for k in cols] + [customer_id],
            )
        if metadata:
            await cur.execute(
                "update customers set metadata = coalesce(metadata, '{}'::jsonb) || %s::jsonb where id = %s",
                (json.dumps(metadata), customer_id),
            )
        await c.commit()
    return {"updated": True, "fields": cols + (["metadata"] if metadata else [])}


async def _embed(text: str) -> list[float]:
    resp = await _get_openai().embeddings.create(model=EMBED_MODEL, input=text)
    return resp.data[0].embedding


async def handle_search_products(args: dict) -> dict:
    query = args["query"]
    filters = args.get("filters") or {}
    limit = args.get("limit", 5)
    qvec = await _embed(query)
    async with conn() as c, c.cursor() as cur:
        await cur.execute(
            "select * from match_products(%s::vector, %s, %s, %s, %s, %s, %s)",
            (qvec, limit,
             filters.get("category"), filters.get("shape"), filters.get("color"),
             filters.get("tags"), filters.get("in_stock")),
        )
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r)) for r in await cur.fetchall()]
    for r in rows:
        if "id" in r:
            r["id"] = str(r["id"])
        if "price_cents" in r and r["price_cents"] is not None:
            r["price"] = f"${r['price_cents'] / 100:.2f}"
    return {"results": rows}


async def handle_search_brand_knowledge(args: dict) -> dict:
    query = args["query"]
    limit = args.get("limit", 3)
    qvec = await _embed(query)
    async with conn() as c, c.cursor() as cur:
        await cur.execute(
            "select * from match_brand_knowledge(%s::vector, %s)",
            (qvec, limit),
        )
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r)) for r in await cur.fetchall()]
    for r in rows:
        if "id" in r:
            r["id"] = str(r["id"])
    return {"results": rows}


async def handle_update_lead_score(customer_id: str, args: dict) -> dict:
    score = args["score"]
    factors = args["factors"]
    reason = args["reason"]
    async with conn() as c, c.cursor() as cur:
        await cur.execute(
            "update customers set lead_score = %s, lead_factors = %s::jsonb where id = %s",
            (score, json.dumps(factors), customer_id),
        )
        await cur.execute(
            "insert into lead_score_events (customer_id, score, factors, reason) values (%s, %s, %s::jsonb, %s)",
            (customer_id, score, json.dumps(factors), reason),
        )
        await c.commit()
    return {"updated": True, "score": score}


async def handle_schedule_followup(
    conv_id: str, customer_id: str, args: dict,
) -> dict:
    delay_hours = float(args["delay_hours"])
    fire_at = datetime.now(timezone.utc) + timedelta(hours=delay_hours)
    async with conn() as c, c.cursor() as cur:
        await cur.execute(
            """
            insert into followups (customer_id, conversation_id, fire_at,
                                   context_reference, message_template)
            values (%s, %s, %s, %s, %s)
            returning id
            """,
            (customer_id, conv_id, fire_at,
             args["context_reference"], args["message_template"]),
        )
        row = await cur.fetchone()
        await c.commit()
    return {"scheduled": True, "followup_id": str(row[0]), "fire_at": fire_at.isoformat()}


async def handle_handoff(conv_id: str, args: dict) -> dict:
    summary = args["summary"]
    suggested = args.get("suggested_reply")
    async with conn() as c, c.cursor() as cur:
        await cur.execute(
            """
            update conversations
               set status = 'handoff',
                   handoff_summary = %s,
                   handoff_suggested_reply = %s
             where id = %s
            """,
            (summary, suggested, conv_id),
        )
        await c.commit()
    return {"handed_off": True}


async def handle_send_checkout_link(
    conv_id: str, customer_id: str, args: dict,
) -> dict:
    product_ids = args["product_ids"]
    note = args.get("note")
    if not product_ids:
        return {"error": "product_ids required"}
    async with conn() as c, c.cursor() as cur:
        await cur.execute(
            "select sku, url from products where id = any(%s::uuid[])",
            (product_ids,),
        )
        rows = await cur.fetchall()
        if not rows:
            return {"error": "no matching products found"}
        skus = [r[0] for r in rows]
        # Prefer the first product's real page — Shopify storefront,
        # customer can add-to-cart there. If nothing has a URL, fall
        # back to the store's all-products page.
        product_urls = [r[1] for r in rows if r[1]]
        if product_urls:
            url = product_urls[0]
        else:
            url = f"{STORE_DOMAIN}/collections/all"
        await cur.execute(
            """
            insert into checkout_links
                   (customer_id, conversation_id, product_ids, url, note)
            values (%s, %s, %s::uuid[], %s, %s)
            returning id
            """,
            (customer_id, conv_id, product_ids, url, note),
        )
        link_id = (await cur.fetchone())[0]
        await c.commit()
    return {"url": url, "link_id": str(link_id), "skus": skus}


async def execute_tool(
    name: str, args: dict, *, conv_id: str, customer_id: str,
) -> dict:
    """Dispatch a Claude tool call to its handler. Returns a JSON-serializable dict."""
    try:
        if name == "extract_profile":
            return await handle_extract_profile(customer_id, dict(args))
        if name == "search_products":
            return await handle_search_products(args)
        if name == "search_brand_knowledge":
            return await handle_search_brand_knowledge(args)
        if name == "update_lead_score":
            return await handle_update_lead_score(customer_id, args)
        if name == "schedule_followup":
            return await handle_schedule_followup(conv_id, customer_id, args)
        if name == "handoff_to_agent":
            return await handle_handoff(conv_id, args)
        if name == "send_checkout_link":
            return await handle_send_checkout_link(conv_id, customer_id, args)
        return {"error": f"unknown tool: {name}"}
    except Exception as e:
        logger.exception("tool error: %s", name)
        return {"error": str(e)}
