# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Self-host the exact Google Fonts faces Roda uses.

Downloads the woff2 files (latin + latin-ext subsets, so Portuguese
diacritics render) into assets/fonts/ and prints an @font-face block that
points at them. The @font-face rules are pasted into the <style> in
index.html — the site then has no external font dependency.

Stdlib only; run with uv (no install step):

    uv run tools/fetch_fonts.py                       # -> assets/fonts/, prints CSS
    uv run tools/fetch_fonts.py assets/fonts out.css  # also writes CSS to a file
"""
import os, re, sys, urllib.request

OUT_DIR = sys.argv[1] if len(sys.argv) > 1 else "assets/fonts"
CSS_OUT = sys.argv[2] if len(sys.argv) > 2 else None  # None -> stdout only

CHROME_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# The families/weights referenced by index.html.
REQ = ("https://fonts.googleapis.com/css2?"
       "family=Syne:wght@600;700;800&"
       "family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;1,400&"
       "family=Space+Mono:wght@400;700&display=swap")

KEEP_SUBSETS = {"latin", "latin-ext"}


def get(url):
    r = urllib.request.Request(url, headers={"User-Agent": CHROME_UA})
    return urllib.request.urlopen(r, timeout=60).read()


def main():
    css = get(REQ).decode("utf-8")
    # Google emits: /* subset */\n @font-face { ... }
    blocks = re.split(r"/\*\s*([\w-]+)\s*\*/", css)
    os.makedirs(OUT_DIR, exist_ok=True)
    out_css, seen = [], set()
    for i in range(1, len(blocks) - 1, 2):
        subset = blocks[i].strip()
        face = blocks[i + 1]
        if subset not in KEEP_SUBSETS:
            continue
        fam = re.search(r"font-family:\s*'([^']+)'", face).group(1)
        style = re.search(r"font-style:\s*(\w+)", face).group(1)
        weight = re.search(r"font-weight:\s*(\d+)", face).group(1)
        url = re.search(r"src:\s*url\(([^)]+)\)", face).group(1)
        urange = re.search(r"unicode-range:\s*([^;]+);", face)
        urange = urange.group(1).strip() if urange else None

        slug = fam.lower().replace(" ", "-")
        ital = "i" if style == "italic" else ""
        fname = f"{slug}-{weight}{ital}-{subset}.woff2"
        if fname not in seen:
            seen.add(fname)
            data = get(url)
            with open(os.path.join(OUT_DIR, fname), "wb") as f:
                f.write(data)
            print(f"  saved {fname}  ({len(data)//1024} KB)  {subset}", file=sys.stderr)

        lines = [
            "  @font-face {",
            f"    font-family: '{fam}';",
            f"    font-style: {style};",
            f"    font-weight: {weight};",
            "    font-display: swap;",
            f"    src: url('assets/fonts/{fname}') format('woff2');",
        ]
        if urange:
            lines.append(f"    unicode-range: {urange};")
        lines.append("  }")
        out_css.append("\n".join(lines))

    block = "\n".join(out_css) + "\n"
    if CSS_OUT:
        with open(CSS_OUT, "w", encoding="utf-8") as f:
            f.write(block)
        print(f"\nWrote {len(out_css)} @font-face rules to {CSS_OUT}", file=sys.stderr)
    else:
        sys.stdout.write(block)
        print(f"\n{len(out_css)} @font-face rules emitted above", file=sys.stderr)


if __name__ == "__main__":
    main()
