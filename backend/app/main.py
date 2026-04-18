"""FastAPI app: streaming /chat with Claude tool-use loop, plus audio/image endpoints."""
from __future__ import annotations

import base64
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .db import close_pool, conn, open_pool
from .prompts import full_system
from .tools import TOOL_DEFINITIONS, execute_tool, get_openai

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bella")

ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
MAX_TOKENS = 1024
MAX_TOOL_TURNS = 6
HISTORY_LIMIT = 8


@asynccontextmanager
async def lifespan(_: FastAPI):
    await open_pool()
    yield
    await close_pool()


app = FastAPI(title="Minders / Bella", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
anthropic = AsyncAnthropic()


# ---------- Models ----------

class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str
    image_url: str | None = None
    entry_page: str | None = None
    timezone: str = "America/New_York"


# ---------- Helpers ----------

def sse(event_type: str, data: Any) -> bytes:
    return f"data: {json.dumps({'type': event_type, **(data if isinstance(data, dict) else {'value': data})})}\n\n".encode("utf-8")


def _to_api_block(b) -> dict:
    """Strip Anthropic response-only fields so the block is valid as input."""
    if b.type == "text":
        return {"type": "text", "text": b.text}
    if b.type == "tool_use":
        return {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
    return b.model_dump(exclude_none=True)


async def _ensure_conversation(conv_id: str | None, entry_page: str | None) -> tuple[str, str]:
    """Return (conversation_id, customer_id). Creates both if conv_id is None."""
    async with conn() as c, c.cursor() as cur:
        if conv_id:
            await cur.execute(
                "select id, customer_id from conversations where id = %s",
                (conv_id,),
            )
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "conversation not found")
            return str(row[0]), str(row[1])
        # New conversation: also new customer
        await cur.execute(
            "insert into customers (intent) values ('browsing') returning id",
        )
        customer_id = (await cur.fetchone())[0]
        await cur.execute(
            "insert into conversations (customer_id, entry_page) values (%s, %s) returning id",
            (customer_id, entry_page),
        )
        new_conv_id = (await cur.fetchone())[0]
        await c.commit()
        return str(new_conv_id), str(customer_id)


async def _load_profile(customer_id: str) -> dict | None:
    async with conn() as c, c.cursor() as cur:
        await cur.execute("select * from customers where id = %s", (customer_id,))
        row = await cur.fetchone()
        if not row:
            return None
        cols = [d.name for d in cur.description]
        return dict(zip(cols, row))


async def _load_history(conv_id: str, limit: int) -> list[dict]:
    """Return last N user/assistant/tool messages in chronological order, in Claude API shape."""
    async with conn() as c, c.cursor() as cur:
        await cur.execute(
            """
            select role, content, tool_name, tool_input, tool_output
              from messages
             where conversation_id = %s and role <> 'system'
             order by created_at desc, id desc
             limit %s
            """,
            (conv_id, limit),
        )
        rows = list(reversed(await cur.fetchall()))
    msgs: list[dict] = []
    for role, content, tool_name, tool_input, tool_output in rows:
        if role == "user":
            msgs.append({"role": "user", "content": content or ""})
        elif role == "assistant":
            msgs.append({"role": "assistant", "content": content or ""})
        # tool messages are reconstructed implicitly by Claude turns; we don't replay them
    return msgs


async def _save_message(
    conv_id: str,
    role: str,
    *,
    content: str | None = None,
    tool_name: str | None = None,
    tool_input: dict | None = None,
    tool_output: dict | None = None,
    image_url: str | None = None,
    audio_url: str | None = None,
) -> None:
    # Don't persist multi-megabyte data URLs into the row content;
    # they bloat the DB and break the dashboard. Mark them as inline-only.
    persisted_image = None if (image_url and image_url.startswith("data:")) else image_url
    persisted_audio = None if (audio_url and audio_url.startswith("data:")) else audio_url
    async with conn() as c, c.cursor() as cur:
        await cur.execute(
            """
            insert into messages (conversation_id, role, content, tool_name, tool_input, tool_output, image_url, audio_url)
            values (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
            """,
            (
                conv_id, role, content, tool_name,
                json.dumps(tool_input) if tool_input is not None else None,
                json.dumps(tool_output) if tool_output is not None else None,
                persisted_image, persisted_audio,
            ),
        )
        await cur.execute(
            "update conversations set last_message_at = now() where id = %s",
            (conv_id,),
        )
        await c.commit()


# ---------- Endpoints ----------

def _user_content_with_image(text: str, image_url: str) -> list[dict]:
    """Build a multimodal user content array for Claude."""
    if image_url.startswith("data:"):
        header, b64 = image_url.split(",", 1)
        media_type = header.split(";")[0].split(":", 1)[1] if ":" in header else "image/jpeg"
        source = {"type": "base64", "media_type": media_type, "data": b64}
    else:
        source = {"type": "url", "url": image_url}
    return [
        {"type": "image", "source": source},
        {"type": "text", "text": text or "(image attached)"},
    ]


@app.post("/chat")
async def chat(req: ChatRequest):
    conv_id, customer_id = await _ensure_conversation(req.conversation_id, req.entry_page)
    profile = await _load_profile(customer_id)
    history = await _load_history(conv_id, HISTORY_LIMIT)
    if req.image_url:
        history.append({"role": "user", "content": _user_content_with_image(req.message, req.image_url)})
    else:
        history.append({"role": "user", "content": req.message})
    await _save_message(conv_id, "user", content=req.message, image_url=req.image_url)

    system = full_system(profile, req.entry_page, req.timezone)

    async def event_stream():
        # Send conversation id up front so the widget can persist it
        yield sse("conversation", {"conversation_id": conv_id})

        msgs = list(history)
        for turn in range(MAX_TOOL_TURNS):
            tool_uses: list[dict] = []
            text_parts: list[str] = []
            current_block_idx: int | None = None
            current_block_type: str | None = None
            tool_input_buffers: dict[int, list[str]] = {}

            async with anthropic.messages.stream(
                model=ANTHROPIC_MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                tools=TOOL_DEFINITIONS,
                messages=msgs,
            ) as stream:
                async for event in stream:
                    et = getattr(event, "type", None)
                    if et == "content_block_start":
                        current_block_idx = event.index
                        current_block_type = event.content_block.type
                        if current_block_type == "tool_use":
                            tool_uses.append({
                                "index": event.index,
                                "id": event.content_block.id,
                                "name": event.content_block.name,
                            })
                            tool_input_buffers[event.index] = []
                            yield sse("tool_call_start", {"name": event.content_block.name})
                    elif et == "content_block_delta":
                        d = event.delta
                        if d.type == "text_delta":
                            text_parts.append(d.text)
                            yield sse("text_delta", {"text": d.text})
                        elif d.type == "input_json_delta":
                            tool_input_buffers.setdefault(event.index, []).append(d.partial_json)
                    elif et == "content_block_stop":
                        current_block_idx = None
                        current_block_type = None
                final = await stream.get_final_message()

            # Persist assistant message (text portion only — tool calls are in messages.tool_*)
            assistant_text = "".join(b.text for b in final.content if b.type == "text")
            if assistant_text:
                await _save_message(conv_id, "assistant", content=assistant_text)

            tool_use_blocks = [b for b in final.content if b.type == "tool_use"]
            if not tool_use_blocks:
                yield sse("done", {"conversation_id": conv_id})
                return

            # Append assistant turn (with tool_use blocks) and the tool results to msgs
            msgs.append({"role": "assistant", "content": [_to_api_block(b) for b in final.content]})

            tool_results = []
            for tu in tool_use_blocks:
                result = await execute_tool(
                    tu.name, tu.input, conv_id=conv_id, customer_id=customer_id,
                )
                await _save_message(
                    conv_id, "tool",
                    tool_name=tu.name, tool_input=tu.input, tool_output=result,
                )
                yield sse("tool_result", {"name": tu.name, "result": result})
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": json.dumps(result, default=str),
                })
            msgs.append({"role": "user", "content": tool_results})

        # Hit MAX_TOOL_TURNS without a final text response
        yield sse("done", {"conversation_id": conv_id, "warning": "max tool turns reached"})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/audio/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    data = await audio.read()
    if not data:
        raise HTTPException(400, "empty audio")
    filename = audio.filename or "recording.webm"
    content_type = audio.content_type or "audio/webm"
    try:
        resp = await get_openai().audio.transcriptions.create(
            model="whisper-1",
            file=(filename, data, content_type),
        )
    except Exception as e:
        log.exception("whisper failed")
        raise HTTPException(502, f"transcription failed: {e}")
    return {"text": resp.text}


@app.post("/image/analyze")
async def analyze_image(image: UploadFile = File(...)):
    data = await image.read()
    if not data:
        raise HTTPException(400, "empty image")
    media_type = image.content_type or "image/jpeg"
    if not media_type.startswith("image/"):
        raise HTTPException(400, f"not an image: {media_type}")
    b64 = base64.b64encode(data).decode("ascii")
    return {"image_url": f"data:{media_type};base64,{b64}", "size": len(data)}


@app.get("/healthz")
async def healthz():
    return {"ok": True}
