//! Turning rendered pages into a PDF.
//!
//! The pages arrive as images, already rasterised by the webview, and are
//! stacked into a minimal PDF by hand. Writing the file format here rather
//! than pulling in a PDF library keeps the output predictable: every page is
//! one embedded JPEG, which is what a reader expects and what keeps the file
//! small enough to email.

use crate::models::{AppError, AppResult};

use super::annotations::ExportImage;

/// Assembles the images into a PDF.
pub fn build_pdf(images: &[ExportImage]) -> AppResult<Vec<u8>> {
    if images.is_empty() {
        return Err(AppError::Message("There is nothing to export.".into()));
    }

    // Reserve object numbers up front so the cross-reference table can be
    // written at the end without a second pass.
    // 1 catalog, 2 page tree, 3 font, 4 outline, 5 info,
    // then per page: page object and its image.
    const CATALOG: usize = 1;
    const PAGES: usize = 2;
    const FONT: usize = 3;
    const OUTLINE: usize = 4;
    const INFO: usize = 5;
    const FIRST_PAGE_OBJ: usize = 6;

    let page_count = images.len();
    // Each page uses exactly three objects: the page, its content stream, and
    // its image. The count has to match what is actually written, because a
    // gap in the numbering leaves a hole the cross-reference table cannot
    // account for.
    const OBJECTS_PER_PAGE: usize = 3;
    let total_objects = 5 + page_count * OBJECTS_PER_PAGE;
    let page_obj = |i: usize| FIRST_PAGE_OBJ + i * OBJECTS_PER_PAGE;
    let content_obj = |i: usize| FIRST_PAGE_OBJ + i * OBJECTS_PER_PAGE + 1;
    let image_obj = |i: usize| FIRST_PAGE_OBJ + i * OBJECTS_PER_PAGE + 2;

    let mut out: Vec<u8> = Vec::with_capacity(page_count * 120_000);
    let mut offsets: Vec<usize> = vec![0; total_objects + 1];

    out.extend_from_slice(b"%PDF-1.4\n");
    // A binary comment marks the file as containing binary data, which some
    // tools otherwise mangle.
    out.extend_from_slice(b"%\xE2\xE3\xCF\xD3\n");

    // Page size is not known until the images are measured; JPEG dimensions
    // are read from the stream below.
    let mut sizes: Vec<(f64, f64)> = Vec::with_capacity(page_count);

    for image in images {
        let (w, h) = jpeg_size(&image.bytes)
            .ok_or_else(|| AppError::Message("One of the pages is not a readable image.".into()))?;
        sizes.push((w, h));
    }

    // 1: catalog. The closure records where each object landed, which is what
    // the cross-reference table at the end is built from.
    let write = |out: &mut Vec<u8>, offsets: &mut Vec<usize>, num: usize, body: &[u8]| {
        offsets[num] = out.len();
        out.extend_from_slice(format!("{num} 0 obj\n").as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    };

    write(
        &mut out,
        &mut offsets,
        CATALOG,
        format!("<< /Type /Catalog /Pages {PAGES} 0 R /Outlines {OUTLINE} 0 R >>")
            .as_bytes(),
    );

    // 2: the page tree.
    let kids: String = (0..page_count)
        .map(|i| format!("{} 0 R", page_obj(i)))
        .collect::<Vec<_>>()
        .join(" ");
    write(
        &mut out,
        &mut offsets,
        PAGES,
        format!("<< /Type /Pages /Kids [{kids}] /Count {page_count} >>").as_bytes(),
    );

    // 3: a font, for the label drawn at the foot of each page.
    write(
        &mut out,
        &mut offsets,
        FONT,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    );

    // 4: an empty outline, so the bookmarks pane is present but empty.
    write(
        &mut out,
        &mut offsets,
        OUTLINE,
        b"<< /Type /Outlines /First 0 /Last 0 /Count 0 >>",
    );

    // 5: document information.
    write(
        &mut out,
        &mut offsets,
        INFO,
        b"<< /Title (Shiny Knitting export) /Producer (Shiny Knitting) >>",
    );


    for (i, image) in images.iter().enumerate() {
        let (w, h) = sizes[i];
        let pw = w;
        let ph = h;

        // The page itself, sized to the image so there is no white margin.
        //
        // These dictionaries are written as single long lines on purpose. A
        // Rust `\`-newline continuation strips the leading whitespace of the
        // next line, which silently eats the `/` off a name like `/Resources`
        // and leaves a dictionary a reader cannot parse.
        write(
            &mut out,
            &mut offsets,
            page_obj(i),
            format!(
                "<< /Type /Page /Parent {PAGES} 0 R /MediaBox [0 0 {pw:.2} {ph:.2}] /Resources << /XObject << /Im0 {} 0 R >> /Font << /F1 {FONT} 0 R >> >> /Contents {} 0 R >>",
                image_obj(i),
                content_obj(i)
            )
            .as_bytes(),
        );

        // The content stream: draw the image over the whole page, then the
        // label in small grey text at the bottom.
        let label = escape_pdf_text(&image.label);
        let font_size = 9.0;
        // The content stream, likewise on one line: a continued line starting
        // with `/Im0` or `BT` would lose its first character.
        let content = format!(
            "q\n{pw:.2} 0 0 {ph:.2} 0 0 cm\n/Im0 Do\nQ\nBT /F1 {font_size} Tf 0.45 0.45 0.45 rg 12 {:.2} Td ({label}) Tj ET",
            ph - 16.0
        );
        write(
            &mut out,
            &mut offsets,
            content_obj(i),
            format!(
                "<< /Length {} >>\nstream\n{content}\nendstream",
                content.len()
            )
            .as_bytes(),
        );

        // The image, embedded as a DCTDecode (JPEG) stream, which is stored
        // as-is with no re-encoding.
        //
        // The dictionary is written by hand rather than through `write`,
        // because the image data has to follow it before `endobj`, and the
        // offset still has to be recorded or the cross-reference table points
        // at the wrong place.
        offsets[image_obj(i)] = out.len();
        out.extend_from_slice(format!("{} 0 obj\n", image_obj(i)).as_bytes());
        out.extend_from_slice(
            format!(
                "<< /Type /XObject /Subtype /Image /Width {iw} /Height {ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter {filter} /Length {len} >>\r\nstream\r\n",
                iw = w as i64,
                ih = h as i64,
                filter = filter_for(&image.mime),
                len = image.bytes.len()
            )
            .as_bytes(),
        );
        out.extend_from_slice(&image.bytes);
        out.extend_from_slice(b"\r\nendstream\r\nendobj\r\n");
    }

    // Cross-reference table.
    let xref_at = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n", total_objects + 1).as_bytes());
    out.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().take(total_objects + 1).skip(1) {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root {CATALOG} 0 R /Info {INFO} 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
            total_objects + 1
        )
        .as_bytes(),
    );

    Ok(out)
}

/// How the image data is stored in the PDF. JPEG bytes are already compressed
/// and go in untouched; anything else has to have been deflated by the caller.
///
/// The leading slash matters: in a PDF dictionary this is a *name*, and a name
/// without its slash is not a name at all. A lenient reader will render the
/// page anyway and a strict one rejects the file outright.
fn filter_for(mime: &str) -> &'static str {
    if mime.contains("png") {
        "/FlateDecode"
    } else {
        "/DCTDecode"
    }
}

/// Pulls the width and height out of a JPEG's start-of-frame marker.
///
/// Walking the marker segments is the only reliable way; the dimensions are
/// not at a fixed offset, and a thumbnail in an EXIF block can sit in front
/// of the frame header.
fn jpeg_size(bytes: &[u8]) -> Option<(f64, f64)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut i = 2usize;
    while i + 3 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        // Padding and standalone markers carry no length.
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }
        if marker == 0xD9 || marker == 0xDA {
            // End of image, or the start of scan data.
            break;
        }
        let length = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
        // Any of these frame headers carry the dimensions, and the header is
        // nine bytes from the marker, so the bounds check covers both.
        if matches!(
            marker,
            0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE | 0xCF
        ) && i + 9 < bytes.len()
        {
            let height = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as f64;
            let width = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as f64;
            if width > 0.0 && height > 0.0 {
                return Some((width, height));
            }
        }
        if length < 2 {
            break;
        }
        i += 2 + length;
    }
    None
}

/// Escapes the characters that would otherwise end a PDF string early.
fn escape_pdf_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars().take(120) {
        match ch {
            '(' => out.push_str("\\("),
            ')' => out.push_str("\\)"),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push(' '),
            // Outside ASCII, PDF string literals are byte-oriented, so encode
            // the common accented letters rather than emitting raw UTF-8.
            'é' => out.push_str("\\351"),
            'è' => out.push_str("\\350"),
            'á' => out.push_str("\\341"),
            'ü' => out.push_str("\\374"),
            'ö' => out.push_str("\\366"),
            'ä' => out.push_str("\\344"),
            '’' => out.push_str("\\222"),
            c => out.push(c),
        }
    }
    out
}

/// The size a page will be exported at, for showing an estimate beforehand.
#[tauri::command]
pub fn estimate_export_dpi(dpi: i64) -> AppResult<i64> {
    Ok(dpi.clamp(72, 600))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real, decodable 32x24 JPEG, read from `tests/fixtures/sample.jpg`.
    ///
    /// It has to be a genuine one: a hand-assembled stub with a valid header
    /// but no scan data passes a structural check and then fails in any real
    /// reader, which is exactly the sort of thing this file must not ship.
    /// Keeping it as a file also means it can be inspected with any image
    /// tool, and regenerated with `make-fixtures.py` if needed.
    fn tiny_jpeg() -> Vec<u8> {
        std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/sample.jpg"),
        )
        .expect("the JPEG fixture is present")
    }

    #[test]
    fn reads_jpeg_dimensions() {
        let (w, h) = jpeg_size(&tiny_jpeg()).expect("dimensions");
        assert_eq!(w, 32.0);
        assert_eq!(h, 24.0);
    }

    /// The fixture has to be a real JPEG, not a well-formed header, or the
    /// whole file of tests is checking something a reader would reject.
    #[test]
    fn the_fixture_is_a_real_jpeg() {
        let bytes = tiny_jpeg();
        assert!(bytes.starts_with(&[0xFF, 0xD8]), "no start of image");
        assert!(bytes.ends_with(&[0xFF, 0xD9]), "no end of image");
        // An entropy-coded segment has to be present, not just a frame header.
        assert!(
            bytes.windows(2).any(|w| w == [0xFF, 0xDA]),
            "no scan data: this is a header, not a decodable image"
        );
    }

    #[test]
    fn rejects_things_that_are_not_jpegs() {
        assert!(jpeg_size(b"not a jpeg at all").is_none());
        assert!(jpeg_size(&[]).is_none());
        assert!(jpeg_size(&[0x89, b'P', b'N', b'G']).is_none());
    }

    #[test]
    fn escapes_text_that_would_break_a_pdf_string() {
        assert_eq!(escape_pdf_text("a(b)c\\d"), "a\\(b\\)c\\\\d");
        assert_eq!(escape_pdf_text("plain text"), "plain text");
    }

    #[test]
    fn builds_a_structurally_valid_pdf() {
        let images = vec![ExportImage {
            page: 1,
            label: "Page 1".to_string(),
            mime: "image/jpeg".to_string(),
            bytes: tiny_jpeg(),
        }];
        let pdf = build_pdf(&images).expect("a pdf");

        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(pdf.ends_with(b"%%EOF\n"));
        // The pieces a reader needs to find.
        assert!(find(&pdf, b"/Type /Catalog"));
        assert!(find(&pdf, b"/Type /Pages"));
        assert!(find(&pdf, b"/Type /Page "));
        assert!(find(&pdf, b"/Subtype /Image"));
        assert!(find(&pdf, b"startxref"));

        // The startxref offset must point at the xref table.
        let tail = String::from_utf8_lossy(&pdf[pdf.len().saturating_sub(64)..]).to_string();
        let offset: usize = tail
            .rsplit("startxref")
            .next()
            .unwrap()
            .trim()
            .lines()
            .next()
            .unwrap()
            .trim()
            .parse()
            .expect("a numeric startxref");
        assert_eq!(&pdf[offset..offset + 4], b"xref");
    }

    #[test]
    fn the_page_count_matches_the_images() {
        let make = |page: i64| ExportImage {
            page,
            label: format!("Page {page}"),
            mime: "image/jpeg".to_string(),
            bytes: tiny_jpeg(),
        };
        let pdf = build_pdf(&[make(1), make(2), make(3)]).expect("a pdf");
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/Count 3"), "expected /Count 3");
        assert_eq!(count(&pdf, b"/Type /Page "), 3);
    }

    #[test]
    fn an_empty_export_is_refused() {
        assert!(build_pdf(&[]).is_err());
    }

    #[test]
    fn a_non_image_is_refused_with_a_clear_error() {
        let bad = vec![ExportImage {
            page: 1,
            label: "Page 1".to_string(),
            mime: "image/jpeg".to_string(),
            bytes: b"this is not a jpeg".to_vec(),
        }];
        let err = build_pdf(&bad).unwrap_err().to_string();
        assert!(err.contains("not a readable image"), "got: {err}");
    }

    #[test]
    fn every_xref_entry_points_at_its_object() {
        // The failure mode this guards against is silent: a reader that cannot
        // follow the table shows a blank page rather than an error.
        let pdf = build_pdf(&[
            ExportImage {
                page: 1,
                label: "one".to_string(),
                mime: "image/jpeg".to_string(),
                bytes: tiny_jpeg(),
            },
            ExportImage {
                page: 2,
                label: "two".to_string(),
                mime: "image/jpeg".to_string(),
                bytes: tiny_jpeg(),
            },
        ])
        .expect("a pdf");
        let text = String::from_utf8_lossy(&pdf);
        let text = text.as_ref();

        let start = text.find("\nxref\n").expect("an xref table") + 1;
        let table = &text[start..];
        let mut lines = table.lines();
        lines.next(); // "xref"
        let header = lines.next().expect("the subsection header");
        let count: usize = header
            .split_whitespace()
            .nth(1)
            .expect("a count")
            .parse()
            .expect("a numeric count");

        let rows: Vec<&str> = lines.collect();
        for (num, row) in rows.iter().take(count).enumerate() {
            // Entries are "nnnnnnnnnn ggggg t" with a trailing space, so the
            // type letter is read from a trimmed row.
            let row = row.trim();
            // Object 0 is the free-list head and has no object behind it.
            if num == 0 {
                assert!(row.ends_with('f'), "object 0 should be free: {row:?}");
                continue;
            }
            assert!(row.ends_with('n'), "object {num} should be in use: {row:?}");
            let offset: usize = row[..10].parse().expect("a ten-digit offset");
            let expected = format!("{num} 0 obj");
            let expected = expected.as_bytes();
            // Sliced as bytes: the file carries binary image data, so a byte
            // offset can land inside a multi-byte character of the lossy copy.
            assert_eq!(
                &pdf[offset..offset + expected.len()],
                expected,
                "object {num} offset points somewhere else"
            );
        }
    }

    #[test]
    fn the_startxref_offset_reaches_the_table() {
        let pdf = build_pdf(&[ExportImage {
            page: 1,
            label: "x".to_string(),
            mime: "image/jpeg".to_string(),
            bytes: tiny_jpeg(),
        }])
        .expect("a pdf");
        let text = String::from_utf8_lossy(&pdf);
        let tail = text.rsplit("startxref").next().expect("a startxref");
        let offset: usize = tail
            .trim()
            .lines()
            .next()
            .expect("the offset on its own line")
            .trim()
            .parse()
            .expect("a numeric offset");
        assert_eq!(&pdf[offset..offset + 4], b"xref");
    }

    /// Rust's `\` line continuation eats the leading whitespace of the next
    /// line, which silently strips the `/` off a name like `/Resources` and
    /// leaves a dictionary no reader can parse. This checks every key that has
    /// to survive.
    #[test]
    fn dictionary_keys_keep_their_leading_slash() {
        let pdf = build_pdf(&[ExportImage {
            page: 1,
            label: "Page 1".to_string(),
            mime: "image/jpeg".to_string(),
            bytes: tiny_jpeg(),
        }])
        .expect("a pdf");
        let text = String::from_utf8_lossy(&pdf);

        for key in [
            "/Type",
            "/Subtype",
            "/Resources",
            "/XObject",
            "/Contents",
            "/ColorSpace",
            "/Filter",
            "/Length",
            "/MediaBox",
            "/Width",
            "/Height",
            "/Font",
        ] {
            assert!(text.contains(key), "missing {key} in the output");
            // And the bare word, without its slash, must not have appeared.
            let bare = &key[1..];
            assert!(
                !text.contains(&format!(" {bare} /")),
                "a key lost its leading slash: {bare}"
            );
        }

        // Values that are names must carry their slash too. A `/Filter` whose
        // value is a bare `DCTDecode` renders in a lenient viewer and is
        // rejected outright by a strict one, so it is checked exactly.
        assert!(
            text.contains("/Filter /DCTDecode"),
            "the filter name is missing its slash"
        );
        assert!(
            !text.contains("/Filter DCTDecode"),
            "the filter was written as a bare word instead of a name"
        );
        assert!(text.contains("/ColorSpace /DeviceRGB"), "bad colour space");
    }

    /// The content stream has to start each operation with its own name, so a
    /// mangled `/Im0 Do` would leave a blank page rather than an error.
    #[test]
    fn the_content_stream_keeps_its_operators() {
        let pdf = build_pdf(&[ExportImage {
            page: 1,
            label: "Page 1".to_string(),
            mime: "image/jpeg".to_string(),
            bytes: tiny_jpeg(),
        }])
        .expect("a pdf");
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/Im0 Do"), "the image is never drawn");
        assert!(text.contains("BT /F1"), "the label is never written");
    }

    /// Writes a real two-page PDF to the target directory so an independent
    /// reader can check it. See `check-export.py` at the project root.
    #[test]
    fn writes_a_sample_for_external_check() {
        let images: Vec<super::super::annotations::ExportImage> = [1, 2]
            .iter()
            .map(|n| super::super::annotations::ExportImage {
                page: *n,
                label: format!("Page {n}"),
                mime: "image/jpeg".to_string(),
                bytes: tiny_jpeg(),
            })
            .collect();
        let pdf = build_pdf(&images).expect("a pdf");

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("export-check.pdf");
        std::fs::write(&path, &pdf).expect("write the sample");
        println!("wrote {} ({} bytes)", path.display(), pdf.len());
    }

    fn find(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    fn count(haystack: &[u8], needle: &[u8]) -> usize {
        haystack.windows(needle.len()).filter(|w| *w == needle).count()
    }
}
