"""Load Bella's system prompt and build the per-request context block."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SYSTEM_PROMPT_PATH = PROJECT_ROOT / "prompts" / "system.md"

_system_prompt_cache: str | None = None


def system_prompt() -> str:
    global _system_prompt_cache
    if _system_prompt_cache is None:
        _system_prompt_cache = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
    return _system_prompt_cache


_PROFILE_FIELDS = (
    "preferred_language", "nail_shape", "color_family", "finish",
    "experience_level", "occasion", "urgency_days", "budget_range",
    "intent", "lead_score", "hema_concerns", "past_reactions",
    "sensitive_skin",
)


def build_context_block(
    profile: dict | None,
    entry_page: str | None,
    timezone: str = "America/New_York",
) -> str:
    tz = ZoneInfo(timezone) if timezone else ZoneInfo("America/New_York")
    now_str = datetime.now(tz).strftime("%Y-%m-%d %H:%M %Z")

    lines = ["<conversation_context>", f"<current_time>{now_str}</current_time>"]

    if profile:
        lines.append("<customer_profile>")
        for k in _PROFILE_FIELDS:
            v = profile.get(k)
            if v is None or v == "":
                continue
            lines.append(f"  {k}: {v}")
        meta = profile.get("metadata") or {}
        if meta:
            lines.append(f"  metadata: {meta}")
        lines.append("</customer_profile>")
    else:
        lines.append("<customer_profile>(new conversation, no profile yet)</customer_profile>")

    if entry_page:
        lines.append(f"<entry_page>{entry_page}</entry_page>")

    lines.append("</conversation_context>")
    return "\n".join(lines)


def full_system(profile: dict | None, entry_page: str | None, timezone: str) -> str:
    return system_prompt() + "\n\n" + build_context_block(profile, entry_page, timezone)
