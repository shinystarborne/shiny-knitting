"""Exercises the AI metadata path against the configured model server.

Development aid: proves the prompt, the request shape, and the JSON parsing
work against a real model rather than a hand-written reply. Not part of the
app, and it never prints the API key.

Usage: python check-ai.py
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://gen2.zeroval.eu/v1"
MODEL = "Qwen3.6-27B"

# Read the real prompt and default settings out of the Rust source, so this
# check cannot drift away from what the app actually sends.
ROOT = Path(__file__).parent
AI_MOD = (ROOT / "src-tauri" / "src" / "ai" / "mod.rs").read_text(encoding="utf-8")
SYSTEM = re.search(r'pub const SYSTEM_PROMPT: &str = r#"(.*?)"#;', AI_MOD, re.S).group(1)

EXCERPT = (
    "Featherweight Lace Sock by Jess Leslie. A sample pattern for testing. "
    "Finished gauge: 28 sts and 44 rows = 10 cm in Stockinette, after blocking. "
    "Size: Foot circumference 22 cm (8.5 in). Cuff 20 sts, 4 cm rib. "
    "Yarn: 400 m of a fine lace-weight yarn, such as Shetland or 1/8 mohair. "
    "Needles: 2.25 mm US 1. Lace chart, rows read from the bottom up. "
    "Rows 1 and 7: k1, yo, k5, slip1-k2tog-psso."
)

USER = (
    "Pattern file: sample-pattern.pdf\n"
    "Filename suggests: Featherweight Lace Sock\n\n"
    f"--- BEGIN PATTERN ---\n{EXCERPT}\n--- END PATTERN ---\n\n"
    "Produce the JSON object described in the instructions."
)


def post(url, payload, key=None):
    data = json.dumps(payload).encode()
    # This server answers 403 to a request with no User-Agent.
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "User-Agent": "ShinyKnitting/check-ai"},
    )
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def extract_object(text):
    """Mirrors extract_json_object in the Rust code: first balanced {...}."""
    start = text.find("{")
    if start == -1:
        return None, None
    depth, in_string, escaped = 0, False, False
    for i in range(start, len(text)):
        c = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                in_string = False
            continue
        if c == '"':
            in_string = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1]), text[start:i + 1]
                except Exception:
                    return None, text[start:i + 1]
    return None, None


def main():
    try:
        models = json.load(
            urllib.request.urlopen(
                urllib.request.Request(
                    f"{BASE}/models", headers={"User-Agent": "ShinyKnitting/check-ai"}
                ),
                timeout=30,
            )
        )
        ids = [m["id"] for m in models.get("data", [])]
        print(f"server reachable. models offered: {ids}")
    except Exception as e:
        print("could not reach the model server:", e)
        return 1

    print(f"asking {MODEL} ...")
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": USER},
        ],
        "temperature": 0.1,
        "max_tokens": 4000,
        "stream": False,
        "response_format": {"type": "json_object"},
        "reasoning": {"effort": "low"},
    }
    try:
        reply = post(f"{BASE}/chat/completions", body)
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:400]}")
        return 1

    choice = (reply.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content", "") or ""
    reasoning = (choice.get("message") or {}).get("reasoning") or ""
    print(f"finish_reason={choice.get('finish_reason')}  "
          f"content_chars={len(content)}  reasoning_chars={len(reasoning)}")

    if not content.strip():
        print("\nEMPTY REPLY.")
        if reasoning:
            print(f"The model spent {len(reasoning)} chars reasoning. Try a lower")
            print("reasoning effort, or a model that does not reason.")
        return 1

    parsed, raw = extract_object(content)
    print("\n--- raw object ---")
    print(raw)

    if parsed is None:
        print("\nNO JSON OBJECT FOUND")
        return 1

    print("\n--- what the app would store ---")
    designer = (parsed.get("designer") or "").strip()
    difficulty = (parsed.get("difficulty") or "").strip().lower()
    needle = (parsed.get("needleSize") or "").strip()
    yarn = (parsed.get("yarn") or "").strip()
    tags = parsed.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    print(f"  designer   : {designer or '(empty)'}")
    print(f"  difficulty : {difficulty or '(empty)'}")
    print(f"  needleSize : {needle or '(empty)'}")
    print(f"  yarn       : {yarn or '(empty)'}")
    print(f"  tags       : {tags}")
    print(f"  summary    : {(parsed.get('summary') or '')[:120]}")
    print("\nEnd-to-end path works against the real model.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
