"""Creates a scanned-looking PDF: pages of pure image, no text layer at all.

Usage: python make-scan-fixture.py
Output: public/fixtures/scanned-pattern.pdf

A great many knitting patterns are scans or phone photographs, so the page is
an image and text search finds nothing. That is the case the AI's image
fallback exists for, and it needs a file that genuinely has no text to test
against: a PDF with a real text layer would never reach that path.
"""
import os
import zlib

# The JPEG from the Rust test fixtures, inlined. A real JPEG rather than a
# stub, so pdf.js genuinely decodes it and the fallback is exercised end to end.
JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300ffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffc00011080008000c0301"
    "01021101031101ffc4001f0000010501010101010100000000000000000102030405"
    "060708090a0bffc400b5100002010303020403050504040000017d0102030004110512"
    "21310641075161711322328108144291a1072341b1c109233352f0156272d10a162434"
    "e125f11718191a262728292a35363738393a434445464748494a535455565758595a63"
    "6465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4"
    "a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1"
    "e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00f7fa28a2803fff"
    "d9"
)

OUT = os.path.join(os.path.dirname(__file__), "public", "fixtures", "scanned-pattern.pdf")

PAGE_W, PAGE_H = 612, 792
PAGES = 3


def image_obj() -> bytes:
    """The shared image object, referenced by every page.

    The length covers only the JPEG. The newline before `endstream` is
    required by the spec and deliberately sits outside it, which is what every
    writer does.
    """
    return (
        b"<< /Type /XObject /Subtype /Image /Width 8 /Height 8 "
        b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "
        + str(len(JPEG)).encode()
        + b" >>\nstream\n"
        + JPEG
        + b"\nendstream"
    )


def main():
    # Object numbers are fixed up front so the cross references below are
    # written once and cannot drift out of step with the list.
    catalog = 1
    page_tree = 2
    image = 3
    # Each page is a page object followed by its content stream.
    page_nums = [4 + i * 2 for i in range(PAGES)]
    content_nums = [n + 1 for n in page_nums]

    kids = " ".join(f"{n} 0 R" for n in page_nums)
    bodies = {
        catalog: b"<< /Type /Catalog /Pages 2 0 R >>",
        page_tree: (
            b"<< /Type /Pages /Kids ["
            + kids.encode()
            + b"] /Count "
            + str(PAGES).encode()
            + b" >>"
        ),
        image: image_obj(),
    }
    for i in range(PAGES):
        # A page that paints the one image across the whole sheet.
        content = zlib.compress(f"q\n{PAGE_W} 0 0 {PAGE_H} 0 0 cm\n/Im0 Do\nQ\n".encode())
        bodies[page_nums[i]] = (
            b"<< /Type /Page /Parent "
            + str(page_tree).encode()
            + b" 0 R /MediaBox [0 0 "
            + f"{PAGE_W} {PAGE_H}".encode()
            + b"] /Resources << /XObject << /Im0 "
            + str(image).encode()
            + b" 0 R >> >> /Contents "
            + str(content_nums[i]).encode()
            + b" 0 R >>"
        )
        bodies[content_nums[i]] = (
            b"<< /Length "
            + str(len(content)).encode()
            + b" /Filter /FlateDecode >>\nstream\n"
            + content
            + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for num in range(1, max(bodies) + 1):
        offsets[num] = len(out)
        out += f"{num} 0 obj\n".encode() + bodies[num] + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {max(bodies) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for num in range(1, max(bodies) + 1):
        out += f"{offsets[num]:010d} 00000 n \n".encode()
    out += (
        b"trailer\n<< /Size "
        + str(max(bodies) + 1).encode()
        + b" /Root "
        + str(catalog).encode()
        + b" 0 R >>\nstartxref\n"
        + str(xref_at).encode()
        + b"\n%%EOF\n"
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(out)
    print(f"wrote {OUT} ({len(out)} bytes, {PAGES} image-only pages)")


if __name__ == "__main__":
    main()
