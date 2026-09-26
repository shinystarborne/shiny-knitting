"""Generates the app icon set for the Tauri bundle.

Draws a knitting needle and a strand of stitches, so the icon is recognisable
at 16px in a taskbar. Run with: python make-icon.py
"""
import struct
import zlib
import math

SIZES = [32, 128, 256, 512]
BG = (20, 22, 26, 255)
ACCENT = (229, 72, 77, 255)
LIGHT = (230, 232, 236, 255)


def blend(dst, src, alpha):
    return tuple(int(d + (s - d) * alpha) for d, s in zip(dst, src))


def rounded_rect_alpha(size, radius, x, y):
    """Coverage of a rounded rectangle at pixel (x, y), for anti-aliasing."""
    cx = min(max(x + 0.5, radius), size - radius)
    cy = min(max(y + 0.5, radius), size - radius)
    dist = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
    return max(0.0, min(1.0, radius - dist + 0.5))


def circle_alpha(cx, cy, r, x, y):
    dist = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
    return max(0.0, min(1.0, r - dist + 0.5))


def segment_alpha(ax, ay, bx, by, half, x, y):
    """Coverage of a thick line segment, anti-aliased at the ends."""
    px, py = x + 0.5, y + 0.5
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    dist = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    return max(0.0, min(1.0, half - dist + 0.5))


def render(size):
    px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    radius = size * 0.22
    needle_half = size * 0.028
    stitch_r = size * 0.052

    # Two diagonal needles crossing behind the stitches.
    n1 = (size * 0.30, size * 0.74, size * 0.72, size * 0.24)
    n2 = (size * 0.70, size * 0.74, size * 0.28, size * 0.24)

    # A row of three stitches along the middle, evoking a knit row.
    stitches = [
        (size * 0.34, size * 0.50),
        (size * 0.50, size * 0.50),
        (size * 0.66, size * 0.50),
    ]

    for y in range(size):
        for x in range(size):
            a = rounded_rect_alpha(size, radius, x, y)
            if a <= 0:
                continue
            color = list(BG)
            for needle in (n1, n2):
                sa = segment_alpha(needle[0], needle[1], needle[2], needle[3], needle_half, x, y)
                if sa > 0:
                    color = list(blend(tuple(color), LIGHT, sa))
            for sx, sy in stitches:
                sa = circle_alpha(sx, sy, stitch_r, x, y)
                if sa > 0:
                    color = list(blend(tuple(color), ACCENT, sa))
            px[y][x] = (color[0], color[1], color[2], int(a * 255))
    return px


def write_png(path, size, px):
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("BBBB", *px[y][x]) for x in range(size)) for y in range(size)
    )

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def png_bytes(size, px):
    import io

    buf = io.BytesIO()
    write_png_to(buf, size, px)
    return buf.getvalue()


def write_png_to(f, size, px):
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("BBBB", *px[y][x]) for x in range(size)) for y in range(size)
    )

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    f.write(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def build_ico(path, sizes=(16, 24, 32, 48, 64, 128, 256)):
    """Writes a multi-size .ico. Windows Vista and later accept PNG payloads
    inside an ICO, which keeps this small and lossless."""
    images = [(s, png_bytes(s, render(s))) for s in sizes]
    count = len(images)

    # ICONDIR: reserved, type (1 = icon), image count.
    out = bytearray(struct.pack("<HHH", 0, 1, count))
    offset = 6 + 16 * count
    for size, data in images:
        out += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,  # 0 means 256
            0 if size >= 256 else size,
            0,  # palette colors
            0,  # reserved
            1,  # colour planes
            32,  # bits per pixel
            len(data),
            offset,
        )
        offset += len(data)
    for _, data in images:
        out += data

    with open(path, "wb") as f:
        f.write(bytes(out))


if __name__ == "__main__":
    import os

    out = os.path.join(os.path.dirname(__file__), "src-tauri", "icons")
    os.makedirs(out, exist_ok=True)
    for s in SIZES:
        name = "icon.png" if s == 512 else f"{s}x{s}.png"
        write_png(os.path.join(out, name), s, render(s))
        print("wrote", name)
    build_ico(os.path.join(out, "icon.ico"))
    print("wrote icon.ico")
