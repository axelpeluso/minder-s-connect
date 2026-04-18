"""Clone the Bellezza Miami homepage to a static folder for local dev + Vercel.

What this does:
  - Fetches https://bellezzamiami.com/ with a realistic User-Agent.
  - Mirrors local assets (img/link/script/source from bellezzamiami.com or
    root-relative paths) into bellezza-clone/assets/, rewriting src/href to
    point at the local copies.
  - Leaves cdn.shopify.com and cdn.bellezzamiami.com URLs untouched — those
    serve cross-origin without trouble.
  - Injects a fetch/XHR shim that intercepts cart/search/apps API calls and
    returns empty 200s, so theme JS doesn't throw network errors.
  - Injects a <script> tag for the Bella widget with two placeholder URLs.
  - Writes the rewritten HTML to bellezza-clone/index.html.

Install:
  pip install requests beautifulsoup4

Run:
  python scripts/clone_bellezza.py
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT_URL = "https://bellezzamiami.com/"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = PROJECT_ROOT / "bellezza-clone"
ASSETS_DIR = OUT_DIR / "assets"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Shopify-managed CDNs — leave URLs alone, they load cross-origin.
PASSTHROUGH_HOSTS = {
    "cdn.shopify.com",
    "cdn.shopifycdn.net",
    "cdn.bellezzamiami.com",
}

# Hosts whose assets we mirror locally. Empty string covers root-relative URLs.
MIRROR_HOSTS = {
    "bellezzamiami.com",
    "www.bellezzamiami.com",
    "",
}

WIDGET_TAG = (
    '<script src="WIDGET_URL_PLACEHOLDER/bella.js" '
    'data-api="BACKEND_URL_PLACEHOLDER" async></script>'
)

AJAX_SHIM = """
(function () {
  // Bellezza clone shim: intercept Shopify storefront calls that have no
  // working backend here and return empty 200s, so theme JS doesn't crash.
  var BAD = /\\/cart(\\.js|\\/(add|update|change|clear)\\.js)|\\/search(\\.json|\\/suggest\\.json)|\\/apps\\//;
  var EMPTY = function () { return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };

  var _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function (input, init) {
      try {
        var u = typeof input === 'string' ? input : (input && input.url);
        if (u && BAD.test(u)) return Promise.resolve(EMPTY());
      } catch (e) {}
      return _fetch.apply(this, arguments);
    };
  }

  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__bella_stub = !!(url && BAD.test(url));
    return _open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__bella_stub) {
      var xhr = this;
      setTimeout(function () {
        try {
          Object.defineProperty(xhr, 'readyState', { value: 4 });
          Object.defineProperty(xhr, 'status', { value: 200 });
          Object.defineProperty(xhr, 'responseText', { value: '{}' });
        } catch (e) {}
        if (xhr.onreadystatechange) xhr.onreadystatechange();
        if (xhr.onload) xhr.onload();
      }, 0);
      return;
    }
    return _send.apply(this, arguments);
  };
})();
"""

VERCEL_CONFIG = """{
  "framework": null,
  "buildCommand": null,
  "outputDirectory": "."
}
"""


def is_passthrough(abs_url: str) -> bool:
    parsed = urlparse(abs_url)
    if parsed.netloc.lower() in PASSTHROUGH_HOSTS:
        return True
    # Shopify storefronts proxy their CDN under <store>.com/cdn/* — skip those too,
    # they're served by Shopify's CDN and load fine cross-origin.
    if parsed.netloc.lower() in MIRROR_HOSTS - {""} and parsed.path.startswith("/cdn/"):
        return True
    return False


def is_mirrorable(abs_url: str) -> bool:
    if not abs_url or abs_url.startswith(("data:", "javascript:", "mailto:", "tel:", "blob:")):
        return False
    return urlparse(abs_url).netloc.lower() in MIRROR_HOSTS


def safe_local_path(abs_url: str) -> Path:
    """Build a safe relative path for storing the asset under ASSETS_DIR."""
    parsed = urlparse(abs_url)
    path = unquote(parsed.path).lstrip("/")
    if parsed.query:
        path = f"{path}__{hashlib.sha1(parsed.query.encode()).hexdigest()[:8]}"
    if not path or path.endswith("/"):
        path = path + "index"
    parts = []
    for p in path.split("/"):
        if p in ("", ".", ".."):
            continue
        parts.append(re.sub(r'[<>:"|?*]+', "_", p))
    return Path(*parts) if parts else Path("index")


class AssetMirror:
    def __init__(self, session: requests.Session):
        self.session = session
        self.cache: dict[str, str | None] = {}
        self.saved = 0
        self.failed = 0

    def rewrite(self, raw: str | None, base: str) -> str | None:
        if not raw:
            return raw
        abs_url = urljoin(base, raw.strip())
        if is_passthrough(abs_url):
            return abs_url  # absolute URL — load directly from CDN
        if not is_mirrorable(abs_url):
            return raw  # external/non-asset; leave alone
        local = self._fetch(abs_url)
        return local if local else raw

    def _fetch(self, abs_url: str) -> str | None:
        if abs_url in self.cache:
            return self.cache[abs_url]
        rel = safe_local_path(abs_url)
        local_path = ASSETS_DIR / rel
        href = (Path("assets") / rel).as_posix()
        if local_path.exists():
            self.cache[abs_url] = href
            return href
        local_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            r = self.session.get(abs_url, timeout=20, allow_redirects=True)
        except Exception as e:
            self.failed += 1
            print(f"  fail: {abs_url}  ({e})", file=sys.stderr)
            self.cache[abs_url] = None
            return None
        if r.status_code != 200:
            self.failed += 1
            print(f"  skip ({r.status_code}): {abs_url}", file=sys.stderr)
            self.cache[abs_url] = None
            return None
        local_path.write_bytes(r.content)
        self.saved += 1
        print(f"  saved: assets/{rel.as_posix()}  ({len(r.content)} bytes)")
        self.cache[abs_url] = href
        return href

    def rewrite_srcset(self, raw: str | None, base: str) -> str | None:
        if not raw:
            return raw
        out = []
        for entry in raw.split(","):
            bits = entry.strip().split()
            if not bits:
                continue
            new_url = self.rewrite(bits[0], base) or bits[0]
            bits[0] = new_url
            out.append(" ".join(bits))
        return ", ".join(out)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    session.headers["Accept"] = "text/html,application/xhtml+xml,*/*"

    print(f"fetching {ROOT_URL}")
    r = session.get(ROOT_URL, timeout=20, allow_redirects=True)
    r.raise_for_status()
    final_url = r.url
    print(f"  → final URL: {final_url}")
    print(f"  → {len(r.text)} chars\n")

    soup = BeautifulSoup(r.text, "html.parser")

    # Drop <base> if present — it confuses local serving.
    for base_tag in soup.find_all("base"):
        base_tag.decompose()

    mirror = AssetMirror(session)

    # Only mirror <link> elements that actually point at assets we want locally.
    # Skip canonical/alternate/dns-prefetch/preconnect/prev/next — those are
    # navigation hints, not assets.
    LINK_REL_ASSETS = {"stylesheet", "preload", "modulepreload", "icon",
                       "shortcut icon", "apple-touch-icon", "manifest"}
    print("rewriting <link href>:")
    for tag in soup.find_all("link"):
        rel = tag.get("rel") or []
        rel_str = " ".join(rel).lower() if isinstance(rel, list) else str(rel).lower()
        if not any(r in rel_str for r in LINK_REL_ASSETS):
            continue
        if tag.get("href"):
            tag["href"] = mirror.rewrite(tag["href"], final_url)

    print("\nrewriting <script src>:")
    for tag in soup.find_all("script"):
        if tag.get("src"):
            tag["src"] = mirror.rewrite(tag["src"], final_url)

    print("\nrewriting <img src/srcset>:")
    for tag in soup.find_all("img"):
        if tag.get("src"):
            tag["src"] = mirror.rewrite(tag["src"], final_url)
        if tag.get("data-src"):
            tag["data-src"] = mirror.rewrite(tag["data-src"], final_url)
        if tag.get("srcset"):
            tag["srcset"] = mirror.rewrite_srcset(tag["srcset"], final_url)
        if tag.get("data-srcset"):
            tag["data-srcset"] = mirror.rewrite_srcset(tag["data-srcset"], final_url)

    print("\nrewriting <source src/srcset>:")
    for tag in soup.find_all("source"):
        if tag.get("src"):
            tag["src"] = mirror.rewrite(tag["src"], final_url)
        if tag.get("srcset"):
            tag["srcset"] = mirror.rewrite_srcset(tag["srcset"], final_url)

    print("\nrewriting <video src/poster>:")
    for tag in soup.find_all("video"):
        if tag.get("src"):
            tag["src"] = mirror.rewrite(tag["src"], final_url)
        if tag.get("poster"):
            tag["poster"] = mirror.rewrite(tag["poster"], final_url)

    # Inject the AJAX shim as the FIRST script in <head> so it runs before
    # any theme JS attempts cart/search/apps requests.
    head = soup.head or soup
    shim = soup.new_tag("script")
    shim.string = AJAX_SHIM
    head.insert(0, shim)

    # Inject the Bella widget script tag right before </body>.
    body = soup.body or soup
    widget_fragment = BeautifulSoup(WIDGET_TAG, "html.parser")
    body.append(widget_fragment)

    out_html = OUT_DIR / "index.html"
    out_html.write_text(str(soup), encoding="utf-8")

    vercel_path = OUT_DIR / "vercel.json"
    if not vercel_path.exists():
        vercel_path.write_text(VERCEL_CONFIG, encoding="utf-8")

    print(f"\n=== summary ===")
    print(f"  assets downloaded: {mirror.saved}")
    print(f"  assets failed/skipped: {mirror.failed}")
    print(f"  passthrough cache hits: {sum(1 for v in mirror.cache.values() if v is not None) - mirror.saved}")
    print(f"  wrote: {out_html}")
    print(f"  wrote: {vercel_path}")
    print(f"\nnext: cd bellezza-clone && python -m http.server 8080")
    return 0


if __name__ == "__main__":
    sys.exit(main())
