import re, html, pathlib, base64, markdown

SRC = pathlib.Path(__file__).resolve().parent.parent / "docs"
OUT = SRC / "html"
OUT.mkdir(exist_ok=True)

DOCS = [
    ("01-research-findings.md", "Tandem Research Findings", "01 · Research findings", "research-findings.html"),
    ("02-architecture.md", "Tandem Architecture", "02 · Architecture", "architecture.html"),
    ("03-technical-design-spec.md", "Tandem Technical Spec", "03 · Technical design specification", "technical-spec.html"),
    ("05-poc-plan.md", "Tandem POC Plan", "05 · Proof-of-concept plan", "poc-plan.html"),
    ("06-demo-guide.md", "Tandem Demo Guide", "06 · Demo guide", "demo-guide.html"),
    ("07-demo-script.md", "Tandem Demo Script", "07 · Demo script", "demo-script.html"),
]

CSS = """
:root{--ground:#EDF0F3;--panel:#FFFFFF;--panel-2:#F5F7F9;--ink:#1A2128;--ink-2:#4A5561;--ink-3:#7C8893;--line:#D3DAE0;--a:#D4890A;--b:#178E9E;--ai:#5A6773;--ai-soft:#E4E8EC;--code:#F3F5F7;--shadow:0 1px 2px rgba(26,33,40,.06),0 8px 24px rgba(26,33,40,.08);--display:"Bricolage Grotesque","Helvetica Neue",Arial,sans-serif;--body:"IBM Plex Sans","Segoe UI",Roboto,sans-serif;--mono:"IBM Plex Mono",Consolas,"Courier New",monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#0F1519;--panel:#171F26;--panel-2:#1E2830;--ink:#E6EBEF;--ink-2:#AEB9C3;--ink-3:#7C8893;--line:#2C3742;--a:#E9A63A;--b:#3FB4C3;--ai:#9AA7B3;--ai-soft:#27323C;--code:#121A20;--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)}}
:root[data-theme="dark"]{--ground:#0F1519;--panel:#171F26;--panel-2:#1E2830;--ink:#E6EBEF;--ink-2:#AEB9C3;--ink-3:#7C8893;--line:#2C3742;--a:#E9A63A;--b:#3FB4C3;--ai:#9AA7B3;--ai-soft:#27323C;--code:#121A20;--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.55}
.page{max-width:1240px;margin:0 auto;padding:32px 16px 80px;display:grid;grid-template-columns:240px minmax(0,1fr);gap:32px;align-items:start}
nav.toc{position:sticky;top:24px;font-size:13px;border-left:3px solid;border-image:linear-gradient(180deg,var(--a) 0 50%,var(--b) 50% 100%) 1;padding-left:14px}
nav.toc .k{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px}
nav.toc a{display:block;color:var(--ink-2);text-decoration:none;padding:3px 0;line-height:1.35}
nav.toc a:hover{color:var(--b)}
article{background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow);padding:48px 56px 56px;min-width:0}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}
h1,h2,h3,h4{font-family:var(--display);text-wrap:balance;line-height:1.1;letter-spacing:-.015em}
h1{font-size:clamp(34px,4.5vw,52px);font-weight:800;margin:0 0 12px}
h2{font-size:28px;font-weight:700;margin:44px 0 12px;padding-top:20px;border-top:1px solid var(--line)}
h3{font-size:19px;font-weight:700;margin:28px 0 8px}
h4{font-size:16px;font-weight:700;margin:20px 0 6px}
p,li{max-width:72ch}
p{margin:0 0 12px}
em{color:var(--ink-2)}
blockquote{margin:12px 0;padding:8px 16px;border-left:3px solid var(--ai);background:var(--panel-2);color:var(--ink-2)}
blockquote p{margin:0}
a{color:var(--b)}
ul,ol{padding-left:22px;margin:0 0 12px}
li{margin:4px 0}
code{font-family:var(--mono);font-size:.88em;background:var(--code);padding:1px 5px;border-radius:3px}
pre{background:var(--code);border:1px solid var(--line);padding:14px 16px;overflow-x:auto;font-size:13px;line-height:1.5;margin:12px 0 18px}
pre code{background:none;padding:0;font-size:inherit}
pre.mermaid{background:var(--panel-2);text-align:center}
.table-wrap{overflow-x:auto;margin:12px 0 20px}
table{border-collapse:collapse;width:100%;font-size:14px}
th{text-align:left;font-family:var(--mono);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);font-weight:500;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
td code{white-space:nowrap}
hr{border:0;border-top:1px solid var(--line);margin:32px 0}
figure{margin:16px 0 22px}
figure img{width:100%;height:auto;border:1px solid var(--line);box-shadow:var(--shadow);display:block}
figcaption{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);margin-top:6px;letter-spacing:.03em}
strong{font-weight:600}
:focus-visible{outline:2px solid var(--b);outline-offset:2px}
@media (max-width:900px){.page{grid-template-columns:1fr}nav.toc{position:static;border-left:none;padding-left:0}article{padding:28px 20px 40px}h2{font-size:24px}}
"""

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">'

def slugify(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "section"

for src, title, eyebrow, out in DOCS:
    text = (SRC / src).read_text(encoding="utf-8")
    md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists"])
    body = md.convert(text)

    # mermaid fences -> native mermaid blocks
    body = re.sub(
        r'<pre><code class="language-mermaid">(.*?)</code></pre>',
        lambda m: '<pre class="mermaid">' + m.group(1) + '</pre>',
        body, flags=re.S,
    )
    # wrap tables
    body = body.replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")
    # inline local images as data URIs so the published page is self-contained
    def inline_img(m):
        alt, rel = m.group("alt"), m.group("src")
        p = SRC / rel
        if not p.exists():
            return m.group(0)
        mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
        data = base64.b64encode(p.read_bytes()).decode("ascii")
        return f'<figure><img src="data:{mime};base64,{data}" alt="{alt}" loading="lazy"><figcaption>{alt}</figcaption></figure>'
    body = re.sub(r'<p><img alt="(?P<alt>[^"]*)" src="(?P<src>guide/[^"]+)"\s*/?></p>', inline_img, body)
    # ids on h2 + toc
    toc = []
    def h2(m):
        inner = m.group(1)
        sid = slugify(inner)
        toc.append((sid, re.sub(r"<[^>]+>", "", inner)))
        return f'<h2 id="{sid}">{inner}</h2>'
    body = re.sub(r"<h2>(.*?)</h2>", h2, body, flags=re.S)
    # drop the first h1 (we render it in the header) -- keep any others
    m = re.search(r"<h1>(.*?)</h1>", body, flags=re.S)
    h1 = re.sub(r"<[^>]+>", "", m.group(1)) if m else title
    body = body.replace(m.group(0), "", 1) if m else body

    toc_html = "".join(f'<a href="#{sid}">{html.escape(t)}</a>' for sid, t in toc)
    page = f"""<title>{html.escape(title)}</title>
{FONTS}
<style>{CSS}</style>
<div class="page">
<nav class="toc"><div class="k">Contents</div>{toc_html}</nav>
<article>
<div class="eyebrow"><span>Tandem design package · {html.escape(eyebrow)}</span><span>2026-09-03</span></div>
<h1>{html.escape(h1)}</h1>
{body}
</article>
</div>
"""
    (OUT / out).write_text(page, encoding="utf-8")
    print(out, len(page), "bytes,", len(toc), "sections")
