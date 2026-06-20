# /// script
# requires-python = ">=3.10"
# ///
"""
Snapshot the move catalog out of index.html into assets/moves.data.js so the
correction Studio (studio.html) shares ONE source of truth with the live site.

index.html holds the moves as a JS literal `const DATA = [ ... ];` (with little
arrow functions inside, so it is JS, not JSON). We slice that literal verbatim
by bracket-matching (skipping string contents) and write it back out as
`window.RODA_MOVES = <literal>;`. Re-run whenever index.html's DATA changes:

  uv run tools/studio/build_moves.py
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "index.html")
OUT = os.path.join(ROOT, "assets", "moves.data.js")
ANCHOR = "const DATA = ["


def slice_array(text, open_idx):
    """Return text[open_idx .. matching ']'], tracking [] depth, skipping strings."""
    depth, i, n = 0, open_idx, len(text)
    quote = None
    while i < n:
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return text[open_idx:i + 1]
        i += 1
    raise ValueError("unterminated DATA array")


def main():
    with open(SRC, encoding="utf-8") as f:
        text = f.read()
    a = text.find(ANCHOR)
    if a < 0:
        print(f"Could not find `{ANCHOR}` in index.html", file=sys.stderr)
        sys.exit(1)
    open_idx = text.index("[", a)
    literal = slice_array(text, open_idx)

    groups = literal.count("id:'")
    moves = literal.count("{n:'")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    header = ("// AUTO-GENERATED from index.html by tools/studio/build_moves.py\n"
              "// Do not edit by hand — edit index.html, then re-run the script.\n"
              "window.RODA_MOVES = ")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(header + literal + ";\n")
    print(f"Wrote {os.path.relpath(OUT, ROOT)}  ({groups} groups, {moves} moves)")


if __name__ == "__main__":
    main()
