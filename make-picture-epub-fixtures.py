"""Builds two EPUBs whose first pages are pictures, to test describing them.

Usage: python make-picture-epub-fixtures.py
Output:
  public/fixtures/pictures-first.epub: a cover, title page and copyright
    page as pictures, then the book's text in its sixth chapter.
  public/fixtures/pictures-only.epub: a book of scanned pages, every chapter
    a picture, its cover named in the package (EPUB 2's <meta name="cover">).
"""
import os
import struct
import zipfile
import zlib


def png(width, height, colour, stripe):
    """A plain PNG: one colour, with a band of another across its middle."""
    rows = []
    for y in range(height):
        c = stripe if height // 3 <= y < height // 3 + 40 else colour
        rows.append(b"\x00" + bytes(c) * width)
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


def page(body):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page</title></head>
<body>{body}</body></html>"""


def picture_page(name):
    return page(f'<div><img src="../images/{name}" alt="" /></div>')


def build(path, chapters, images, cover_id):
    """`chapters`: (file name, xhtml) in reading order; `images`: (file name, bytes)."""
    manifest = [f'<item id="c{i}" href="text/{name}" media-type="application/xhtml+xml"/>' for i, (name, _) in enumerate(chapters)]
    manifest += [f'<item id="{"cover-img" if n == 0 else f"img{n}"}" href="images/{name}" media-type="image/png"/>' for n, (name, _) in enumerate(images)]
    spine = "".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
    cover_meta = f'<meta name="cover" content="{cover_id}"/>' if cover_id else ""
    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>A book in pictures</dc:title><dc:identifier id="id">pictures</dc:identifier><dc:language>en</dc:language>
    {cover_meta}
  </metadata>
  <manifest>{"".join(manifest)}</manifest>
  <spine>{spine}</spine>
</package>"""
    container = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container)
        z.writestr("OEBPS/content.opf", opf)
        for name, xhtml in chapters:
            z.writestr(f"OEBPS/text/{name}", xhtml)
        for name, data in images:
            z.writestr(f"OEBPS/images/{name}", data)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "public", "fixtures")
    os.makedirs(out, exist_ok=True)

    images = [
        ("cover.png", png(600, 800, (180, 40, 50), (240, 230, 210))),
        ("title.png", png(600, 800, (240, 230, 210), (40, 40, 40))),
        ("copyright.png", png(600, 800, (250, 250, 250), (120, 120, 120))),
        ("rule.png", png(120, 8, (0, 0, 0), (0, 0, 0))),
    ]
    first = [
        ("cover.xhtml", picture_page("cover.png")),
        ("title.xhtml", picture_page("title.png")),
        ("copyright.xhtml", picture_page("copyright.png")),
        ("half-title.xhtml", page('<p><img src="../images/rule.png" alt="" /></p>')),
        ("dedication.xhtml", page("<p> </p>")),
        ("intro.xhtml", page("<h1>Knits from the Highlands</h1><p>By Kate Example. Gauge 22 sts and 30 rows to 10 cm on 4mm needles, in DK wool.</p>")),
    ]
    build(os.path.join(out, "pictures-first.epub"), first, images, None)

    pages = [png(700, 1000, (245, 240, 230), (30 + 60 * i, 60, 90)) for i in range(4)]
    only = [(f"page{i + 1}.xhtml", picture_page(f"page{i + 1}.png")) for i in range(4)]
    build(os.path.join(out, "pictures-only.epub"), only, [(f"page{i + 1}.png", d) for i, d in enumerate(pages)], "cover-img")
    print("wrote pictures-first.epub and pictures-only.epub in", out)


if __name__ == "__main__":
    main()
