"""Builds a long PDF to test scrolling, page restore, and lazy rendering.

Usage: python make-long-fixture.py
Output: public/fixtures/long-pattern.pdf (40 pages)
"""
import os

PAGES = 40


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
        lines = [
            (f"Long Sock, page {i + 1}", 1),
            ("", 0),
            (f"Section {i // 8 + 1}, chart row {i + 1}", 0),
            ("k1, yo, k5, slip1-k2tog-psso.", 0),
            ("Row 2: k1, k5, yo, k1.", 0),
            ("Rows 3 and 5: k7.", 0),
            ("", 0),
            ("MARKER_PAGE_" + str(i + 1), 0),
        ]
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
    dest = os.path.join(out_dir, "long-pattern.pdf")
    build_pdf(dest)
    print("wrote", dest, os.path.getsize(dest), "bytes,", PAGES, "pages")
