//! Storing cover images.
//!
//! The frontend does all image work — extracting a page from a PDF, decoding
//! an EPUB's cover, downscaling a photo the user picked — and sends finished
//! JPEG or PNG bytes. This side only decides where the file lives and refuses
//! anything that is not an image.
//!
//! Files go in `library/covers/<pattern id>.<ext>`, so removing a pattern can
//! never leave a cover behind, and two patterns can never share one.

use std::path::PathBuf;

use crate::db;
use crate::models::{AppError, AppResult, CoverImage};

use super::state::AppState;

/// Extensions we accept, mapped to the MIME type we report back.
/// Magic numbers. Checking content rather than trusting the filename stops
/// a renamed script from being stored as though it were an image.
fn sniff(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    sniff_extension(bytes).map(|ext| (ext, mime_for(ext)))
}

/// The file extension for a supported image, by content.
pub fn sniff_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    // WebP: "RIFF" then "WEBP".
    if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.len() > 2 && bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    None
}

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    }
}

/// A 20 MB cover is far past anything sensible for a card image, and letting
/// it through would quietly fill the library folder.
const MAX_BYTES: usize = 20 * 1024 * 1024;

pub fn covers_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("covers")
}

/// The full path of a pattern's cover, if it has one that still exists.
pub fn cover_path(state: &AppState, pattern_id: &str) -> AppResult<Option<PathBuf>> {
    let name = db::get_cover(&state.db(), pattern_id)?;
    if name.is_empty() {
        return Ok(None);
    }
    // Only ever resolve a bare file name we wrote ourselves, so a tampered
    // database cannot point the read at somewhere else on disk.
    let path = covers_dir(state).join(safe_name(&name));
    Ok(if path.exists() { Some(path) } else { None })
}

/// Reduces a stored name to something that can only ever be a plain file
/// inside the covers folder.
///
/// A name like `..` or `.` would still be a path segment even with separators
/// removed, so those are mapped to a harmless placeholder rather than kept.
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();
    if cleaned.is_empty() || cleaned.chars().all(|c| c == '.') {
        return "cover".to_string();
    }
    cleaned
}

/// Saves image bytes as a pattern's cover, replacing any previous one.
pub fn set_cover(state: &AppState, pattern_id: &str, bytes: Vec<u8>) -> AppResult<CoverImage> {
    if bytes.is_empty() {
        return Err(AppError::Message("That file is empty.".into()));
    }
    if bytes.len() > MAX_BYTES {
        return Err(AppError::Message(
            "That image is too large to be a cover (limit 20 MB).".into(),
        ));
    }
    let (ext, mime) = sniff(&bytes).ok_or_else(|| {
        AppError::Message("That file does not look like an image.".into())
    })?;

    let dir = covers_dir(state);
    std::fs::create_dir_all(&dir)?;

    // Clear the old file first so a replaced cover does not linger.
    remove_cover(state, pattern_id).ok();
    let file_name = format!("{}.{}", safe_name(pattern_id), ext);
    let path = dir.join(&file_name);
    std::fs::write(&path, &bytes)?;
    db::set_cover(&state.db(), pattern_id, &file_name)?;

    Ok(CoverImage {
        pattern_id: pattern_id.to_string(),
        file_name,
        bytes,
        mime: mime.to_string(),
    })
}

/// Deletes a pattern's cover file and clears the reference.
pub fn remove_cover(state: &AppState, pattern_id: &str) -> AppResult<()> {
    if let Some(path) = cover_path(state, pattern_id)? {
        let _ = std::fs::remove_file(path);
    }
    db::set_cover(&state.db(), pattern_id, "")?;
    Ok(())
}

/// Reads a pattern's cover bytes, or an error when it has none.
pub fn read_cover(state: &AppState, pattern_id: &str) -> AppResult<(String, Vec<u8>)> {
    let path = cover_path(state, pattern_id)?
        .ok_or_else(|| AppError::Message("This pattern has no cover.".into()))?;
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "jpg".to_string());
    let mime = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };
    Ok((mime.to_string(), std::fs::read(path)?))
}

/// Whether a pattern already has a cover file on disk. Used to offer a scan
/// only for the patterns that still need one.
pub fn has_cover(state: &AppState, pattern_id: &str) -> bool {
    cover_path(state, pattern_id).ok().flatten().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The smallest byte sequences that should be recognised.
    #[test]
    fn recognises_real_image_formats() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(("jpg", "image/jpeg")));
        assert_eq!(
            sniff(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]),
            Some(("png", "image/png"))
        );
        assert_eq!(sniff(b"GIF89a...."), Some(("gif", "image/gif")));
        let mut webp = b"RIFF\0\0\0\0WEBP".to_vec();
        webp.extend_from_slice(b"more");
        assert_eq!(sniff(&webp), Some(("webp", "image/webp")));
        assert_eq!(sniff(b"BM......"), Some(("bmp", "image/bmp")));
    }

    #[test]
    fn refuses_things_that_are_not_images() {
        // A script, a PDF, and an empty buffer all have to be rejected.
        assert_eq!(sniff(b"MZ\x90\x00"), None);
        assert_eq!(sniff(b"%PDF-1.4"), None);
        assert_eq!(sniff(b"<?php echo 1;"), None);
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn a_renamed_executable_is_not_accepted() {
        // The whole point of sniffing: the name is irrelevant.
        assert!(sniff(b"MZ\x90\x00\x03").is_none());
    }

    #[test]
    fn file_names_are_sanitised() {
        // Anything that could escape the covers folder is stripped out.
        assert_eq!(safe_name("../../evil.png"), "....evil.png");
        assert_eq!(safe_name("abc-123_x.png"), "abc-123_x.png");
        assert_eq!(safe_name("a/b\\c"), "abc");
    }

    /// A name that is nothing but dots is still a path segment, so it has to
    /// be replaced outright rather than merely stripped of separators.
    #[test]
    fn dot_only_names_become_a_placeholder() {
        assert_eq!(safe_name(".."), "cover");
        assert_eq!(safe_name("."), "cover");
        assert_eq!(safe_name(""), "cover");
        assert_eq!(safe_name("./."), "cover");
    }

    #[test]
    fn a_traversal_attempt_becomes_a_harmless_name() {
        // A database row pointing outside the library must not be honoured.
        for attempt in [
            "../../../Windows/System32/evil.dll",
            "..",
            "a/../../b.png",
        ] {
            let cleaned = safe_name(attempt);
            assert!(!cleaned.contains('/'), "{attempt} left a separator");
            assert!(!cleaned.contains('\\'), "{attempt} left a separator");
            assert!(!cleaned.is_empty(), "{attempt} produced nothing");
            // The only way dots survive is as a real extension, never alone.
            assert!(!cleaned.chars().all(|c| c == '.'), "{attempt} stayed all dots");
        }
    }
}
