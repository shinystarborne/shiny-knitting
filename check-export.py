"""Checks the export builder's output with a real PDF reader.

The Rust tests verify the file structure; this verifies that an independent
parser agrees the pages are there and the embedded image actually decodes.
Development aid, not part of the app.

Produce the sample first:
    cd src-tauri && cargo test writes_a_sample_for_external_check

Then:
    python check-export.py
"""
import logging
import os
import sys

SAMPLE = os.path.join(
    os.path.dirname(__file__), "src-tauri", "target", "export-check.pdf"
)


def main() -> int:
    try:
        from pypdf import PdfReader
    except ImportError:
        print("pypdf is needed:  pip install pypdf")
        return 1

    if not os.path.exists(SAMPLE):
        print(f"no sample at {SAMPLE}")
        print("produce it with:")
        print("  cd src-tauri && cargo test writes_a_sample_for_external_check")
        return 1

    # pypdf logs some parse complaints rather than raising, so they are
    # collected and treated as failures. Without this the script would report
    # success over a file the reader could not fully read.
    complaints: list[str] = []

    class Collector(logging.Handler):
        def emit(self, record):  # noqa: D102
            complaints.append(record.getMessage())

    logging.getLogger("pypdf").addHandler(Collector())
    logging.getLogger("pypdf").setLevel(logging.WARNING)

    reader = PdfReader(SAMPLE)
    pages = len(reader.pages)
    print(f"parsed: {pages} pages, {os.path.getsize(SAMPLE)} bytes")

    failures: list[str] = []
    if pages != 2:
        failures.append(f"expected 2 pages, got {pages}")

    for i, page in enumerate(reader.pages, start=1):
        box = page.mediabox
        width, height = float(box.width), float(box.height)
        print(f"  page {i}: {width:.0f} x {height:.0f} pt")
        if width <= 0 or height <= 0:
            failures.append(f"page {i} has no size")

        xobjects = page.get("/Resources", {}).get("/XObject", {})
        if not xobjects:
            failures.append(f"page {i} has no image")
            continue
        for name in xobjects:
            obj = xobjects[name].get_object()
            subtype = obj.get("/Subtype")
            print(
                f"    {name}: {subtype} {obj.get('/Filter')} "
                f"{obj.get('/Width')}x{obj.get('/Height')}"
            )
            if subtype != "/Image":
                failures.append(f"page {i} {name} is not an image")
            # Decoding the stream is what proves the dictionary and the
            # declared length agree with the data that follows.
            try:
                data = obj.get_data()
                if len(data) < 100:
                    failures.append(f"page {i} {name} decoded to only {len(data)} bytes")
            except Exception as e:  # noqa: BLE001
                failures.append(f"page {i} {name} would not decode: {e}")

    for message in complaints:
        print(f"  reader complaint: {message[:160]}")
        failures.append(f"pypdf complained: {message[:160]}")

    if failures:
        print("\nFAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("\nAn independent PDF reader agrees the export is valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
