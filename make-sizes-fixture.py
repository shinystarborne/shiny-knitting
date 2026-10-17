"""Builds a pattern in five sizes, to test marking the size knitted.

Usage: python make-sizes-fixture.py
Output: public/fixtures/sized-pattern.pdf (2 pages)

Its sizes are named (XS to XL), with runs of five numbers to mark, one
broken over two lines, and look-alikes that are not sizes: a stitch pattern
in brackets, and a page reference.
"""
import os

PAGES = 2

PAGE_LINES = [
    [
        ("Sunday Cardigan", 1),
        ("", 0),
        ("Sizes: XS (S, M, L, XL)", 0),
        ("Chest: 86 (96, 106, 116, 126) cm", 0),
        ("Cast on 100 (110, 120, 130, 140) sts.", 0),
        ("Rib in (k2, p2) for 5 cm, as on page 2 (8).", 0),
        ("Work 2 (2, 3, 3, 4) repeats of the chart.", 0),
    ],
    [
        ("The yoke", 1),
        ("", 0),
        ("Decrease 6 (6, 8, 8, 10) times.", 0),
        ("Knit 40 (42,", 0),
        ("44, 46, 48) rounds to the neck.", 0),
    ],
]


def pdf_escape(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def content_stream(lines, page_num, total_pages):
    """A page of text plus a footer. Mirrors the short fixture's layout."""
    parts = ["BT", "/F1 20 Tf", "1 0 0 1 72 720 Tm", "24 TL"]
    y = 720
    for text, is_heading in lines:
        size = 18 if is_heading else 12
        font = "/F2" if is_heading else "/F1"
        parts.append(f"{font} {size} Tf")
        parts.append(f"1 0 0 1 72 {y} Tm")
        parts.append(f"({pdf_escape(text)}) Tj")
        y -= size + (14 if is_heading else 6)
    parts.append("/F1 9 Tf")
    parts.append(f"1 0 0 1 72 60 Tm (Page {page_num} of {total_pages}) Tj")
    parts.append("ET")
    return "\n".join(parts).encode("latin-1")


def build_pdf(path):
    page_ids = [5 + i * 2 for i in range(PAGES)]
    content_ids = [6 + i * 2 for i in range(PAGES)]
    max_num = max(page_ids + content_ids)

    objects = {}
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {PAGES} >>".encode()
    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    objects[4] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"

    for i in range(PAGES):
        lines = PAGE_LINES[i]
        stream = content_stream(lines, i + 1, PAGES)
        objects[page_ids[i]] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            f"/Contents {content_ids[i]} 0 R >>"
        ).encode()
        objects[content_ids[i]] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += f"{num} 0 obj\n".encode() + objects[num] + b"\nendobj\n"

    xref_at = len(out)
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


if __name__ == "__main__":
    here = os.path.dirname(__file__)
    out_dir = os.path.join(here, "public", "fixtures")
    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, "sized-pattern.pdf")
    build_pdf(dest)
    print("wrote", dest, os.path.getsize(dest), "bytes,", PAGES, "pages")
