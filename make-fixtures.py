"""Creates a sample knitting pattern as PDF and EPUB for testing the app.

Usage: python make-fixtures.py
Output: fixtures/ and public/fixtures/ — the first for direct inspection, the
second because the harness serves its documents from public/.
"""
import os
import zipfile

# A tiny multi-page PDF with real text, including a chart-like grid, so the
# reader and highlight line get exercised with representative content.

LINES_PAGE_1 = [
    ("Featherweight Lace Sock", 1),
    ("A sample pattern for testing", 0),
    ("", 0),
    ("Finished gauge", 1),
    ("28 sts and 44 rows = 10 cm in", 0),
    ("Stockinette, after blocking.", 0),
    ("", 0),
    ("Size", 1),
    ("Foot circumference 22 cm (8.5 in)", 0),
    ("Cuff 20 sts, 4 cm rib", 0),
    ("", 0),
    ("Lace chart", 1),
]

LINES_PAGE_2 = [
    ("Reading the chart", 1),
    ("Rows are read from the bottom up.", 0),
    ("Start at the right edge with RS.", 0),
    ("", 0),
    ("Lace repeat", 1),
    ("Rows 1 and 7: k1, yo, k5, slip1-k2tog-psso.", 0),
    ("Row 2: k1, k5, yo, k1.", 0),
    ("Rows 3, 5: k7.", 0),
    ("Rows 4 and 6: k1, k2tog-psso, k5, yo.", 0),
    ("", 0),
    ("Repeat rows 1-8 for the leg.", 0),
    ("", 0),
    ("Finishing", 1),
    ("Bind off with a stretchy bind-off.", 0),
    ("Weave in ends, block to measurements.", 0),
]

# A simple grid standing in for a stitch chart.
CHART_COLS, CHART_ROWS = 14, 8
CHART_MARKERS = "k.y.k.s.kk.y.k.k.s.kk.y.k.k.s."


def pdf_escape(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def content_stream(lines, page_num, total_pages):
    parts = ["BT", "/F1 20 Tf", "1 0 0 1 72 720 Tm", "24 TL"]
    y = 720
    for text, is_heading in lines:
        size = 18 if is_heading else 12
        font = "/F2" if is_heading else "/F1"
        parts.append(f"{font} {size} Tf")
        parts.append(f"1 0 0 1 72 {y} Tm")
        parts.append(f"({pdf_escape(text)}) Tj")
        y -= size + (14 if is_heading else 6)
        if y < 420:
            break

    # Draw the chart grid.
    if page_num == 1:
        left, bottom, cell = 72, 160, 26
        parts.append("0.4 w")
        for c in range(CHART_COLS + 1):
            x = left + c * cell
            parts.append(f"{x} {bottom} m {x} {bottom + CHART_ROWS * cell} l S")
        for r in range(CHART_ROWS + 1):
            yy = bottom + r * cell
            parts.append(f"{left} {yy} m {left + CHART_COLS * cell} {yy} l S")
        parts.append("/F1 7 Tf")
        for r in range(CHART_ROWS):
            for c in range(CHART_COLS):
                parts.append(f"1 0 0 1 {left + c * cell + 6} {bottom + r * cell + 16} Tm")
                parts.append(f"({CHART_MARKERS[(r * CHART_COLS + c) % len(CHART_MARKERS)]}) Tj")
        parts.append("1 0 0 1 72 130 Tm (/Row 8/) Tj")
        parts.append("1 0 0 1 72 112 Tm (/Row 7/) Tj")
        parts.append("1 0 0 1 72 94 Tm (/Row 6/) Tj")

    # Footer.
    parts.append("/F1 9 Tf")
    parts.append(f"1 0 0 1 72 60 Tm (Page {page_num} of {total_pages}) Tj")
    parts.append("ET")
    return "\n".join(parts).encode("latin-1")


def build_pdf(path):
    pages = [LINES_PAGE_1, LINES_PAGE_2]
    total = len(pages)
    objects = {}

    # 1: catalog, 2: pages tree, 3: font regular, 4: font bold,
    # 5+: page and content pairs.
    page_ids = [5 + i * 2 for i in range(total)]
    content_ids = [6 + i * 2 for i in range(total)]

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {total} >>".encode()
    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    objects[4] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"

    for i, lines in enumerate(pages):
        stream = content_stream(lines, i + 1, total)
        objects[page_ids[i]] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            f"/Contents {content_ids[i]} 0 R >>"
        ).encode()
        objects[content_ids[i]] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode()
            + stream
            + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += f"{num} 0 obj\n".encode() + objects[num] + b"\nendobj\n"

    xref_at = len(out)
    max_num = max(objects)
    out += f"xref\n0 {max_num + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for num in range(1, max_num + 1):
        if num in offsets:
            out += f"{offsets[num]:010d} 00000 n \n".encode()
        else:
            out += b"0000000000 65535 f \n"
    out += (
        f"trailer\n<< /Size {max_num + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n"
    ).encode()

    with open(path, "wb") as f:
        f.write(bytes(out))


XHTML = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>{title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
{body}
</body>
</html>
"""

CHAPTERS = [
    (
        "Featherweight Lace Sock",
        """
        <h1>Featherweight Lace Sock</h1>
        <p class="subtitle">A sample pattern for testing the reader</p>
        <h2>Finished gauge</h2>
        <p>28 sts and 44 rows = 10 cm in Stockinette, after blocking.</p>
        <h2>Size</h2>
        <p>Foot circumference 22 cm (8.5 in). Cuff 20 sts, 4 cm rib.</p>
        <h2>Yarn</h2>
        <p>400 m of a fine lace-weight yarn, such as Shetland or 1/8 mohair.</p>
        <p><a href="ch2.xhtml">Continue to the lace chart</a></p>
        """,
    ),
    (
        "Lace chart",
        """
        <h1>Lace chart</h1>
        <p>Rows are read from the bottom up. Start at the right edge with RS facing.</p>
        <img src="chart.svg" alt="Stitch chart"/>
        <h2>Lace repeat</h2>
        <ul>
          <li>Rows 1 and 7: k1, yo, k5, slip1-k2tog-psso.</li>
          <li>Row 2: k1, k5, yo, k1.</li>
          <li>Rows 3 and 5: k7.</li>
          <li>Rows 4 and 6: k1, k2tog-psso, k5, yo.</li>
        </ul>
        <p>Repeat rows 1-8 for the leg.</p>
        """,
    ),
    (
        "Finishing",
        """
        <h1>Finishing</h1>
        <p>Bind off with a stretchy bind-off. Weave in ends, block to measurements.</p>
        <p>This page is deliberately short so the chapter view has a third entry.</p>
        """,
    ),
]

STYLE = """body { font-family: Georgia, serif; color: #1a1a1a; }
h1 { color: #7a2e35; }
h2 { color: #444; margin-top: 1.2em; }
.subtitle { font-style: italic; color: #666; }
img { display: block; margin: 1em 0; }
"""

CHART_SVG = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240" viewBox="0 0 420 240">
  <rect width="420" height="240" fill="#fff"/>
""" + "".join(
    f'  <line x1="{60 + c * 30}" y1="20" x2="{60 + c * 30}" y2="230" stroke="#ccc" stroke-width="1"/>'
    if c <= 12
    else ""
    for c in range(13)
) + "".join(
    f'  <line x1="60" y1="{20 + r * 30}" x2="420" y2="{20 + r * 30}" stroke="#ccc" stroke-width="1"/>'
    for r in range(8)
) + """
  <text x="10" y="50" font-size="12" fill="#333">8</text>
  <text x="10" y="80" font-size="12" fill="#333">7</text>
  <text x="10" y="110" font-size="12" fill="#333">6</text>
  <text x="10" y="140" font-size="12" fill="#333">5</text>
  <text x="10" y="170" font-size="12" fill="#333">4</text>
  <text x="10" y="200" font-size="12" fill="#333">3</text>
  <text x="10" y="230" font-size="12" fill="#333">2</text>
  <text x="10" y="258" font-size="12" fill="#333">1</text>
</svg>
"""

# A cover image, declared the way EPUB 3 does, so the reader's cover
# extraction has something real to find.
COVER_SVG = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
  <rect width="300" height="400" fill="#7a2e35"/>
  <rect x="18" y="18" width="264" height="364" fill="none" stroke="#f0d9c0" stroke-width="3"/>
  <text x="150" y="150" font-size="24" fill="#f0d9c0" text-anchor="middle"
        font-family="Georgia, serif">Featherweight</text>
  <text x="150" y="185" font-size="24" fill="#f0d9c0" text-anchor="middle"
        font-family="Georgia, serif">Lace Sock</text>
  <text x="150" y="230" font-size="13" fill="#e0bda0" text-anchor="middle">Jess Leslie</text>
  <g fill="none" stroke="#f0d9c0" stroke-width="2">
    <path d="M60 300 q30 -25 60 0 t60 0 t60 0"/>
    <path d="M60 325 q30 -25 60 0 t60 0 t60 0"/>
    <path d="M60 350 q30 -25 60 0 t60 0 t60 0"/>
  </g>
</svg>
"""

CONTAINER_XML = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""

CONTENT_OPF = """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Featherweight Lace Sock</dc:title>
    <dc:creator>Sample Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="id">urn:uuid:sample-featherweight-sock</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="chart" href="chart.svg" media-type="image/svg+xml"/>
    <item id="cover" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>
"""

NAV_XHTML = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc"><ol>
    <li><a href="ch1.xhtml">Featherweight Lace Sock</a></li>
    <li><a href="ch2.xhtml">Lace chart</a></li>
    <li><a href="ch3.xhtml">Finishing</a></li>
  </ol></nav>
</body>
</html>
"""


def build_epub(path):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        # The mimetype entry must be first and stored uncompressed.
        z.writestr(
            zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED
        )
        z.writestr("META-INF/container.xml", CONTAINER_XML)
        z.writestr("OEBPS/content.opf", CONTENT_OPF)
        z.writestr("OEBPS/nav.xhtml", NAV_XHTML)
        z.writestr("OEBPS/style.css", STYLE)
        z.writestr("OEBPS/chart.svg", CHART_SVG)
        z.writestr("OEBPS/cover.svg", COVER_SVG)
        for i, (title, body) in enumerate(CHAPTERS, start=1):
            z.writestr(f"OEBPS/ch{i}.xhtml", XHTML.format(title=title, body=body))


if __name__ == "__main__":
    here = os.path.dirname(__file__)
    out = os.path.join(here, "fixtures")
    os.makedirs(out, exist_ok=True)
    build_pdf(os.path.join(out, "sample-pattern.pdf"))
    build_epub(os.path.join(out, "sample-pattern.epub"))
    # The harness serves its documents from public/, so the same files land
    # there too rather than being copied across by hand.
    public = os.path.join(here, "public", "fixtures")
    os.makedirs(public, exist_ok=True)
    build_pdf(os.path.join(public, "sample-pattern.pdf"))
    build_epub(os.path.join(public, "sample-pattern.epub"))
    for name in sorted(os.listdir(out)):
        print(name, os.path.getsize(os.path.join(out, name)), "bytes")
