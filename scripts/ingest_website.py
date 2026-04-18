"""Crawl bellezzamiami.com and extract brand-knowledge FAQs via Claude.

Crawls from the homepage to depth 2, skips product/collection/cart pages,
strips nav/footer/cart noise, asks Claude Sonnet to extract 1-5 FAQs per
page, dedupes, and writes seed_data/brand_knowledge.json.

After running this, run scripts/seed_brand_knowledge.py to embed + upsert
into Postgres.

Env required:
  ANTHROPIC_API_KEY

Install:
  pip install requests beautifulsoup4 anthropic
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import deque
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlparse

import requests
from anthropic import Anthropic
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "seed_data" / "brand_knowledge.json"

START_URL = "https://bellezzamiami.com/"
MAX_DEPTH = 2
MAX_PAGES = 50
FETCH_DELAY_S = 1.0
PAGE_TEXT_CHAR_LIMIT = 8000
MIN_PAGE_TEXT_CHARS = 200

MODEL = "claude-sonnet-4-6"
USER_AGENT = "MindersBot/1.0 (brand-knowledge ingest for bellezzamiami.com)"

ALLOWED_TOPICS = [
    "hema_free", "safety", "application", "shapes", "durability",
    "removal", "returns", "shipping", "cuticle_care", "beginner_tips", "other",
]

EXCLUDE_PATH_PREFIXES = (
    "/products/", "/collections/", "/cart", "/checkout", "/account",
    "/search", "/orders/", "/services/", "/apps/",
)

# High-value pages we always try, regardless of whether they're linked from
# the homepage. 404s are expected — not every Shopify store uses every handle.
SEED_PATHS = (
    "/policies/shipping-policy",
    "/policies/refund-policy",
    "/policies/privacy-policy",
    "/policies/terms-of-service",
    "/pages/about",
    "/pages/about-us",
    "/pages/our-story",
    "/pages/faq",
    "/pages/faqs",
    "/pages/contact",
    "/pages/shipping",
    "/pages/returns",
    "/blogs/news",
)

EXCLUDE_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf", ".zip",
    ".mp4", ".mov", ".css", ".js", ".xml", ".rss", ".json",
)

NOISE_SELECTORS = [
    "nav", "header", "footer",
    "script", "style", "noscript", "iframe", "svg",
    "[class*='cart' i]", "[id*='cart' i]",
    "[class*='nav' i]", "[id*='nav' i]",
    "[class*='menu' i]",
    "[class*='announcement' i]",
    "[class*='breadcrumb' i]",
    "[class*='footer' i]", "[id*='footer' i]",
    "[class*='header' i]", "[id*='header' i]",
    "[class*='popup' i]", "[class*='modal' i]", "[class*='drawer' i]",
    "[class*='product-grid' i]", "[class*='collection-grid' i]",
    "[class*='product-card' i]", "[class*='product-item' i]",
    "[class*='cookie' i]",
]

EXTRACTION_TOOL = {
    "name": "submit_faq_entries",
    "description": "Submit FAQ entries extracted from the page.",
    "input_schema": {
        "type": "object",
        "properties": {
            "entries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string", "enum": ALLOWED_TOPICS},
                        "question": {"type": "string"},
                        "answer": {"type": "string"},
                    },
                    "required": ["topic", "question", "answer"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["entries"],
        "additionalProperties": False,
    },
}

EXTRACTION_PROMPT = """You are extracting FAQ-style brand knowledge from a Bellezza Miami webpage. Bellezza is a Miami-based DIY nail-products brand. Their voice is warm, direct, knowledgeable, no legal hedging.

URL: {url}

PAGE CONTENT:
---
{text}
---

Extract 0 to 5 FAQ entries that capture customer-useful brand or product information ACTUALLY PRESENT on this page.

Rules:
- Ground every answer in the content above. Do NOT invent facts.
- If the page implies a specific number (price, days, percent) but doesn't state it, write [VERIFY WITH BRAND] in place of the specific value.
- Skip generic marketing taglines, navigation labels, hero text. Only substantive customer-useful info.
- Phrase each question the way a real customer would ask it.
- Answers should be 2-4 sentences in Bellezza's warm, direct voice.
- If the page has nothing FAQ-worthy, submit an empty array.

Topic options:
- hema_free: HEMA, sensitivity, why their formula avoids it
- safety: reactions, patch tests, ingredient concerns
- application: how to apply tips, polish, prep, cure
- shapes: square, almond, coffin, round - who suits what
- durability: how long it lasts
- removal: how to take them off
- returns: refunds, exchanges, return windows
- shipping: delivery times, regions, customs
- cuticle_care: oils, serums, routine
- beginner_tips: kit contents, starter vs pro, first-time guidance
- other: anything else useful that doesn't fit the above

Submit your entries via the submit_faq_entries tool."""


def normalize_url(url: str) -> str:
    url, _ = urldefrag(url)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    cleaned = parsed._replace(query="", fragment="").geturl()
    if parsed.path in ("", "/"):
        return cleaned
    return cleaned.rstrip("/")


def is_internal(url: str, root_host: str) -> bool:
    host = urlparse(url).netloc.lower()
    if not host:
        return False
    return host == root_host or host.endswith("." + root_host)


def is_excluded(url: str) -> bool:
    path = urlparse(url).path.lower()
    if any(path.startswith(p) for p in EXCLUDE_PATH_PREFIXES):
        return True
    if any(path.endswith(ext) for ext in EXCLUDE_EXTENSIONS):
        return True
    return False


def clean_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for selector in NOISE_SELECTORS:
        for el in soup.select(selector):
            el.decompose()
    main = soup.find("main") or soup.find("article") or soup.body or soup
    text = main.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_links(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    links = []
    for a in soup.find_all("a", href=True):
        link = normalize_url(urljoin(base_url, a["href"]))
        if link:
            links.append(link)
    return links


class RateLimitedFetcher:
    def __init__(self, delay_s: float):
        self.delay_s = delay_s
        self.last_fetch_at = 0.0
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.session.headers["Accept"] = "text/html,application/xhtml+xml"

    def get(self, url: str, *, allow_missing: bool = False) -> str | None:
        elapsed = time.monotonic() - self.last_fetch_at
        if elapsed < self.delay_s:
            time.sleep(self.delay_s - elapsed)
        try:
            r = self.session.get(url, timeout=15, allow_redirects=True)
            self.last_fetch_at = time.monotonic()
        except requests.RequestException as e:
            self.last_fetch_at = time.monotonic()
            print(f"  fetch error {url}: {e}", file=sys.stderr)
            return None
        if r.status_code != 200:
            if r.status_code == 404 and allow_missing:
                print(f"  not present (skipping): {url}")
            else:
                print(f"  skip ({r.status_code}): {url}", file=sys.stderr)
            return None
        if "html" not in r.headers.get("content-type", "").lower():
            return None
        return r.text


def crawl(start_url: str, max_depth: int, max_pages: int) -> dict[str, str]:
    root_host = urlparse(start_url).netloc.lower()
    fetcher = RateLimitedFetcher(FETCH_DELAY_S)
    visited: set[str] = set()

    seed_urls: set[str] = {
        u for u in (normalize_url(urljoin(start_url, p)) for p in SEED_PATHS) if u
    }
    queue: deque[tuple[str, int]] = deque([(normalize_url(start_url), 0)])
    for u in seed_urls:
        queue.append((u, 0))

    pages: dict[str, str] = {}

    while queue and len(pages) < max_pages:
        url, depth = queue.popleft()
        if not url or url in visited:
            continue
        visited.add(url)
        if is_excluded(url):
            continue

        is_seed = url in seed_urls
        tag = "seed" if is_seed else f"depth {depth}"
        print(f"[{tag}] {url}")
        html = fetcher.get(url, allow_missing=is_seed)
        if html is None:
            continue

        text = clean_html(html)
        if len(text) >= MIN_PAGE_TEXT_CHARS:
            pages[url] = text[:PAGE_TEXT_CHAR_LIMIT]
        else:
            print(f"  (skipping page body, only {len(text)} chars)")

        if depth < max_depth:
            for link in extract_links(html, url):
                if (
                    link not in visited
                    and is_internal(link, root_host)
                    and not is_excluded(link)
                ):
                    queue.append((link, depth + 1))

    return pages


def extract_faqs(client: Anthropic, url: str, text: str) -> list[dict]:
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            tools=[EXTRACTION_TOOL],
            tool_choice={"type": "tool", "name": "submit_faq_entries"},
            messages=[{
                "role": "user",
                "content": EXTRACTION_PROMPT.format(url=url, text=text),
            }],
        )
    except Exception as e:
        print(f"  Claude error for {url}: {e}", file=sys.stderr)
        return []

    for block in resp.content:
        if getattr(block, "type", None) != "tool_use":
            continue
        raw = block.input.get("entries", []) if isinstance(block.input, dict) else []
        return [
            {**e, "source": url}
            for e in raw
            if isinstance(e, dict)
            and all(k in e and isinstance(e[k], str) and e[k].strip()
                    for k in ("topic", "question", "answer"))
        ]
    return []


_PUNCT_RE = re.compile(r"[^\w\s]")


def normalize_question(q: str) -> tuple[str, ...]:
    return tuple(_PUNCT_RE.sub("", q.lower()).split())


def dedupe(entries: list[dict]) -> list[dict]:
    seen: set[tuple[str, ...]] = set()
    out: list[dict] = []
    for e in entries:
        key = normalize_question(e["question"])
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def main() -> int:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY not set", file=sys.stderr)
        return 1

    print(f"crawling from {START_URL} (depth <= {MAX_DEPTH}, max {MAX_PAGES} pages)")
    pages = crawl(START_URL, MAX_DEPTH, MAX_PAGES)
    print(f"\ncollected {len(pages)} pages with usable content\n")

    if not pages:
        print("no pages — nothing to write", file=sys.stderr)
        return 1

    client = Anthropic()
    all_entries: list[dict] = []
    for i, (url, text) in enumerate(pages.items(), 1):
        print(f"[{i}/{len(pages)}] extracting from {url}")
        faqs = extract_faqs(client, url, text)
        print(f"  -> {len(faqs)} entries")
        all_entries.extend(faqs)

    print(f"\ntotal raw entries: {len(all_entries)}")
    deduped = dedupe(all_entries)
    print(f"after dedup:       {len(deduped)}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(deduped, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"\nwrote {OUT_PATH}")
    print("next: python scripts/seed_brand_knowledge.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
