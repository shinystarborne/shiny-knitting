"""Builds a pattern page with addresses on it, to test following its links.

Usage: python make-links-fixture.py
Output: public/fixtures/links-pattern.pdf (1 page)

One address is a real link in the PDF (an annotation, going somewhere other
than it says, so which one answered can be told); the others are only words
on the page: with and without https://, a shop's bare name and path, a mail
address, and one broken over two lines. And look-alikes that are no address.
"""
import os

LINES = [
    ("Sunday Shawl", 1),
    ("", 0),
    ("Shop: www.real-link.com", 0),
    ("Yarn from www.wollshop.de/garn/merino.", 0),
    ("Find me on ravelry.com/designers/shiny", 0),
    ("Questions: hello@shiny-knits.com", 0),
    ("Video: https://example.com/patterns/", 0),
    ("sunday-shawl", 0),
    ("Knit 2.5 cm, e.g. k2tog, fig. 3.", 0),
]


def pdf_escape(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def build_pdf(path):
    parts = ["BT"]
    y = 720
    real_y = None
    for text, is_heading in LINES:
        size = 18 if is_heading else 12
        parts.append(f"{'/F2' if is_heading else '/F1'} {size} Tf")
        parts.append(f"1 0 0 1 72 {y} Tm")
        parts.append(f"({pdf_escape(text)}) Tj")
        if text.startswith("Shop:"):
            real_y = y
        y -= size + (14 if is_heading else 6)
    parts.append("ET")
    stream = "\n".join(parts).encode("latin-1")

    # The real link: over "www.real-link.com", going to another address.
    rect = f"[105 {real_y - 3} 220 {real_y + 11}]"
    objects = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [5 0 R] /Count 1 >>",
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        4: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        5: (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            "/Annots [7 0 R] /Contents 6 0 R >>"
        ).encode(),
        6: f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream",
        7: (
            f"<< /Type /Annot /Subtype /Link /Rect {rect} /Border [0 0 0] "
            "/A << /S /URI /URI (https://real-link.com/annotated) >> >>"
        ).encode(),
    }

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += f"{num} 0 obj\n".encode() + objects[num] + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for num in sorted(objects):
        out += f"{offsets[num]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    with open(path, "wb") as f:
        f.write(bytes(out))


if __name__ == "__main__":
    here = os.path.dirname(__file__)
    out_dir = os.path.join(here, "public", "fixtures")
    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, "links-pattern.pdf")
    build_pdf(dest)
    print("wrote", dest, os.path.getsize(dest), "bytes")
