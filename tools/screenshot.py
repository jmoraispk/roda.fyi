#!/usr/bin/env python3
"""
Roda — local QA / screenshot tool.

Renders index.html with a headless browser and saves screenshots of the hero
and each section, captures a card mid-animation, and runs an overlap check on
the hero title vs. the figure across many widths (with an optional wide-font
proxy that approximates a worst-case display face).

Setup:
    pip install -r tools/requirements.txt
    playwright install chromium

Run:
    python tools/screenshot.py                 # screenshots into tools/shots/
    python tools/screenshot.py --overlap       # just run the overlap audit
    python tools/screenshot.py --html path.html

Note: loading via file:// blocks Google Fonts in some setups. To see the real
Syne/Hanken faces, serve the folder instead:
    python -m http.server 8000   ->   http://localhost:8000
and pass:  python tools/screenshot.py --url http://localhost:8000
"""
import argparse, pathlib, sys
from playwright.sync_api import sync_playwright

# A display face deliberately WIDER than Syne — if the layout clears with this,
# it clears with the real font.
WIDE_PROXY = "h1.title{font-family:'Arial Black','Archivo Black',Impact,sans-serif !important;}"

SECTIONS = ["golpes", "esquivas", "floreios", "quedas"]
WIDTHS = [390, 768, 1000, 1100, 1180, 1280, 1440, 1680, 1920, 2400]


def overlap_audit(page, url, wide=True):
    inject = WIDE_PROXY if wide else ""
    print(f"\nOverlap audit ({'wide-font proxy' if wide else 'page font'}):")
    bad = False
    for w in WIDTHS:
        page.set_viewport_size({"width": w, "height": 900})
        page.goto(url)
        if inject:
            page.add_style_tag(content=inject)
        page.wait_for_timeout(200)
        r = page.evaluate("""()=>{
          const t=document.querySelector('h1.title').getBoundingClientRect();
          const a=document.querySelector('.hero-art').getBoundingClientRect();
          const stacked=getComputedStyle(document.querySelector('.hero')).flexDirection==='column';
          return {gap:Math.round(a.left-t.right), stacked};
        }""")
        if r["stacked"]:
            flag = "STACKED"
        elif r["gap"] >= 0:
            flag = f"ok (gap {r['gap']}px)"
        else:
            flag, bad = f"*** OVERLAP {-r['gap']}px ***", True
        print(f"  w={w:5d}  {flag}")
    print("  => PASS" if not bad else "  => FAIL: overlap detected")
    return not bad


def shots(page, url, outdir):
    outdir.mkdir(parents=True, exist_ok=True)
    # desktop hero (two ginga phases)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(url); page.wait_for_timeout(700)
    page.screenshot(path=str(outdir / "hero_a.png"))
    page.wait_for_timeout(650)
    page.screenshot(path=str(outdir / "hero_b.png"))
    # each section
    for s in SECTIONS:
        page.evaluate(f"document.getElementById('{s}').scrollIntoView()")
        page.wait_for_timeout(800)
        page.screenshot(path=str(outdir / f"{s}.png"))
    # a card mid-animation
    page.evaluate("document.getElementById('golpes').scrollIntoView()")
    page.wait_for_timeout(600)
    card = page.query_selector("#golpes .card:nth-child(3)")
    if card:
        card.hover(); page.wait_for_timeout(330)
        page.screenshot(path=str(outdir / "card_hover.png"))
    # top-level Música (coming-soon) view
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(url); page.wait_for_timeout(400)
    page.click("button[data-view='musica']")
    page.wait_for_timeout(400)
    page.screenshot(path=str(outdir / "musica.png"))
    # mobile
    page.set_viewport_size({"width": 390, "height": 840})
    page.goto(url); page.wait_for_timeout(900)
    page.screenshot(path=str(outdir / "mobile.png"))
    print(f"Saved screenshots to {outdir}/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", default="index.html", help="path to the html file")
    ap.add_argument("--url", default=None, help="serve URL instead of file:// (loads real fonts)")
    ap.add_argument("--overlap", action="store_true", help="run only the overlap audit")
    ap.add_argument("--page-font", action="store_true", help="audit with the page's own font, not the wide proxy")
    args = ap.parse_args()

    url = args.url or ("file://" + str(pathlib.Path(args.html).resolve()))
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(device_scale_factor=2)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        ok = overlap_audit(pg, url, wide=not args.page_font)
        if not args.overlap:
            shots(pg, url, pathlib.Path("tools/shots"))
        b.close()
    js = [e for e in errs if "403" not in e and "Failed to load resource" not in e]
    if js:
        print("\nJS console issues:", js)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
