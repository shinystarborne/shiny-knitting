//! Storing cover images and yarn photos.
//!
//! The frontend does all image work — extracting a page from a PDF, decoding
//! an EPUB's cover, downscaling a photo the user picked — and sends finished
//! JPEG or PNG bytes. This side only decides where the file lives and refuses
//! anything that is not an image.
//!
//! Covers go in `library/covers/<pattern id>.<ext>` and yarn photos in
//! `library/yarn-photos/<yarn id>.<ext>`, so removing a pattern or a yarn can
//! never leave its image behind, and two can never share one.

use std::path::{Path, PathBuf};

use crate::db;
use crate::models::{AppError, AppResult, CoverImage, PhotoInfo};

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

/// Checks the bytes really are an image of a sane size, returning the
/// extension and MIME type. Anything else is refused.
fn validate(bytes: &[u8]) -> AppResult<(&'static str, &'static str)> {
    if bytes.is_empty() {
        return Err(AppError::Message("That file is empty.".into()));
    }
    if bytes.len() > MAX_BYTES {
        return Err(AppError::Message(
            "That image is too large to be a cover (limit 20 MB).".into(),
        ));
    }
    sniff(bytes).ok_or_else(|| AppError::Message("This file is not an image.".into()))
}

/// The full path of a stored image inside `dir`, if a name is recorded and
/// the file still exists.
///
/// Only ever resolves a bare file name we wrote ourselves, so a tampered
/// database cannot point the read at somewhere else on disk.
fn existing_file(dir: &Path, stored_name: &str) -> Option<PathBuf> {
    if stored_name.is_empty() {
        return None;
    }
    let path = dir.join(safe_name(stored_name));
    if path.exists() { Some(path) } else { None }
}

/// Writes image bytes as `<id>.<ext>` inside `dir`, returning the file name.
fn write_file(dir: &Path, id: &str, ext: &str, bytes: &[u8]) -> AppResult<String> {
    std::fs::create_dir_all(dir)?;
    let file_name = format!("{}.{}", safe_name(id), ext);
    std::fs::write(dir.join(&file_name), bytes)?;
    Ok(file_name)
}

/// Puts image bytes in place of the picture stored as `old`, so that at no
/// point is there neither: the new one is written beside it under a
/// temporary name and flushed to disk, moved in as `<id>.<ext>`, and recorded
/// by `record`; only then is the old file, if it had another name, deleted.
/// If anything fails before that, the old picture and its record stay as they
/// were and the new file is cleared away.
///
/// With the same name (a JPEG replaced by a JPEG), the move replaces the old
/// file in one step, and the record already names it.
fn replace_file(
    dir: &Path,
    id: &str,
    ext: &str,
    bytes: &[u8],
    old: &str,
    record: impl FnOnce(&str) -> AppResult<()>,
) -> AppResult<String> {
    use std::io::Write;
    std::fs::create_dir_all(dir)?;
    let file_name = format!("{}.{}", safe_name(id), ext);
    let temp = dir.join(format!("{}.{}.part", safe_name(id), uuid::Uuid::new_v4()));
    let written = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()
    })()
    .and_then(|()| std::fs::rename(&temp, dir.join(&file_name)));
    if let Err(e) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(e.into());
    }
    let old_name = safe_name(old);
    let replaced_in_place = !old.is_empty() && old_name == file_name;
    if let Err(e) = record(&file_name) {
        // The old picture is still there, under its own name, and still the
        // one recorded; only the new file goes.
        if !replaced_in_place {
            let _ = std::fs::remove_file(dir.join(&file_name));
        }
        return Err(e);
    }
    if !old.is_empty() && !replaced_in_place {
        if let Some(path) = existing_file(dir, old) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(file_name)
}

/// Reads an image back, reporting its MIME type from the extension.
fn read_file(path: PathBuf) -> AppResult<(String, Vec<u8>)> {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "jpg".to_string());
    Ok((mime_for(&ext).to_string(), std::fs::read(path)?))
}

/// The full path of a pattern's cover, if it has one that still exists.
pub fn cover_path(state: &AppState, pattern_id: &str) -> AppResult<Option<PathBuf>> {
    let name = db::get_cover(&state.db(), pattern_id)?;
    Ok(existing_file(&covers_dir(state), &name))
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
    let (ext, mime) = validate(&bytes)?;

    let old = db::get_cover(&state.db(), pattern_id)?;
    let file_name = replace_file(&covers_dir(state), pattern_id, ext, &bytes, &old, |name| {
        db::set_cover(&state.db(), pattern_id, name)
    })?;

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
    read_file(path)
}

/// Whether a pattern already has a cover file on disk. Used to offer a scan
/// only for the patterns that still need one.
pub fn has_cover(state: &AppState, pattern_id: &str) -> bool {
    cover_path(state, pattern_id).ok().flatten().is_some()
}

// ---------- yarn photos ----------

/// Yarn photos live beside the covers, one file per yarn, so removing a yarn
/// can never leave a photo behind.
pub fn yarn_photos_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("yarn-photos")
}

/// The full path of a yarn's photo, if it has one that still exists.
pub fn yarn_photo_path(state: &AppState, yarn_id: &str) -> AppResult<Option<PathBuf>> {
    let name = db::get_yarn_photo(&state.db(), yarn_id)?;
    Ok(existing_file(&yarn_photos_dir(state), &name))
}

/// Saves image bytes as a yarn's photo, replacing any previous one.
pub fn set_yarn_photo(state: &AppState, yarn_id: &str, bytes: Vec<u8>) -> AppResult<PhotoInfo> {
    let (ext, mime) = validate(&bytes)?;

    let old = db::get_yarn_photo(&state.db(), yarn_id)?;
    let file_name = replace_file(&yarn_photos_dir(state), yarn_id, ext, &bytes, &old, |name| {
        db::set_yarn_photo(&state.db(), yarn_id, name)
    })?;

    Ok(PhotoInfo {
        yarn_id: yarn_id.to_string(),
        file_name,
        bytes,
        mime: mime.to_string(),
    })
}

/// Deletes a yarn's photo file and clears the reference.
pub fn remove_yarn_photo(state: &AppState, yarn_id: &str) -> AppResult<()> {
    if let Some(path) = yarn_photo_path(state, yarn_id)? {
        let _ = std::fs::remove_file(path);
    }
    db::set_yarn_photo(&state.db(), yarn_id, "")?;
    Ok(())
}

/// Reads a yarn's photo bytes, or an error when it has none.
pub fn read_yarn_photo(state: &AppState, yarn_id: &str) -> AppResult<(String, Vec<u8>)> {
    let path = yarn_photo_path(state, yarn_id)?
        .ok_or_else(|| AppError::Message("This yarn has no photo.".into()))?;
    read_file(path)
}

// ---------- projects: a cover, and the board's pictures ----------

pub fn project_covers_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("project-covers")
}

pub fn board_images_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("project-images")
}

/// Saves a project's cover, replacing any previous one.
pub fn set_project_cover(state: &AppState, project_id: &str, bytes: Vec<u8>) -> AppResult<()> {
    let (ext, _mime) = validate(&bytes)?;
    let old = db::get_project(&state.db(), project_id)?.cover_path;
    replace_file(&project_covers_dir(state), project_id, ext, &bytes, &old, |name| {
        db::set_project_cover(&state.db(), project_id, name)
    })
    .map(|_| ())
}

pub fn remove_project_cover(state: &AppState, project_id: &str) -> AppResult<()> {
    let name = db::get_project(&state.db(), project_id)?.cover_path;
    if let Some(path) = existing_file(&project_covers_dir(state), &name) {
        let _ = std::fs::remove_file(path);
    }
    db::set_project_cover(&state.db(), project_id, "")
}

pub fn read_project_cover(state: &AppState, project_id: &str) -> AppResult<(String, Vec<u8>)> {
    let name = db::get_project(&state.db(), project_id)?.cover_path;
    let path = existing_file(&project_covers_dir(state), &name)
        .ok_or_else(|| AppError::Message("This project has no cover.".into()))?;
    read_file(path)
}

/// Saves a board item's picture, replacing any previous one.
pub fn set_board_image(state: &AppState, item_id: &str, bytes: Vec<u8>) -> AppResult<()> {
    let (ext, _mime) = validate(&bytes)?;
    let old = db::board_item_image(&state.db(), item_id)?;
    replace_file(&board_images_dir(state), item_id, ext, &bytes, &old, |name| {
        db::set_board_item_image(&state.db(), item_id, name)
    })
    .map(|_| ())
}

pub fn read_board_image(state: &AppState, item_id: &str) -> AppResult<(String, Vec<u8>)> {
    let name = db::board_item_image(&state.db(), item_id)?;
    let path = existing_file(&board_images_dir(state), &name)
        .ok_or_else(|| AppError::Message("This picture no longer exists.".into()))?;
    read_file(path)
}

/// Deletes a stored board picture by its file name, best effort.
pub fn delete_board_image_file(state: &AppState, file_name: &str) {
    if let Some(path) = existing_file(&board_images_dir(state), file_name) {
        let _ = std::fs::remove_file(path);
    }
}

// ---------- chart pictures ----------

pub fn chart_pictures_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("chart-pictures")
}

/// Writes a chart's picture, after checking it is one, returning its file name.
pub fn write_chart_picture(state: &AppState, chart_id: &str, bytes: &[u8]) -> AppResult<String> {
    let (ext, _mime) = validate(bytes)?;
    write_file(&chart_pictures_dir(state), chart_id, ext, bytes)
}

pub fn read_chart_picture(state: &AppState, file_name: &str) -> AppResult<(String, Vec<u8>)> {
    let path = existing_file(&chart_pictures_dir(state), file_name)
        .ok_or_else(|| AppError::Message("This chart's picture no longer exists.".into()))?;
    read_file(path)
}

/// Deletes a stored chart picture by its file name, best effort.
pub fn delete_chart_picture_file(state: &AppState, file_name: &str) {
    if let Some(path) = existing_file(&chart_pictures_dir(state), file_name) {
        let _ = std::fs::remove_file(path);
    }
}

// ---------- project log photos ----------

pub fn log_photos_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("log-photos")
}

/// Saves a log entry's photo, replacing any previous one.
pub fn set_log_photo(state: &AppState, entry_id: &str, bytes: Vec<u8>) -> AppResult<()> {
    let (ext, _mime) = validate(&bytes)?;
    let old = db::get_log_entry(&state.db(), entry_id)?.photo_path;
    replace_file(&log_photos_dir(state), entry_id, ext, &bytes, &old, |name| {
        db::set_log_photo(&state.db(), entry_id, name)
    })
    .map(|_| ())
}

pub fn remove_log_photo(state: &AppState, entry_id: &str) -> AppResult<()> {
    let name = db::get_log_entry(&state.db(), entry_id)?.photo_path;
    delete_log_photo_file(state, &name);
    db::set_log_photo(&state.db(), entry_id, "")
}

pub fn read_log_photo(state: &AppState, entry_id: &str) -> AppResult<(String, Vec<u8>)> {
    let name = db::get_log_entry(&state.db(), entry_id)?.photo_path;
    let path = existing_file(&log_photos_dir(state), &name)
        .ok_or_else(|| AppError::Message("This entry has no photo.".into()))?;
    read_file(path)
}

/// Deletes a stored log photo by its file name, best effort.
pub fn delete_log_photo_file(state: &AppState, file_name: &str) {
    if let Some(path) = existing_file(&log_photos_dir(state), file_name) {
        let _ = std::fs::remove_file(path);
    }
}

// ---------- swatch photos ----------

pub fn swatch_photos_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("swatch-photos")
}

/// Saves a swatch's photo, replacing any previous one.
pub fn set_swatch_photo(state: &AppState, swatch_id: &str, bytes: Vec<u8>) -> AppResult<()> {
    let (ext, _mime) = validate(&bytes)?;
    let old = db::get_swatch(&state.db(), swatch_id)?.photo_path;
    replace_file(&swatch_photos_dir(state), swatch_id, ext, &bytes, &old, |name| {
        db::set_swatch_photo(&state.db(), swatch_id, name)
    })
    .map(|_| ())
}

pub fn remove_swatch_photo(state: &AppState, swatch_id: &str) -> AppResult<()> {
    let name = db::get_swatch(&state.db(), swatch_id)?.photo_path;
    delete_swatch_photo_file(state, &name);
    db::set_swatch_photo(&state.db(), swatch_id, "")
}

pub fn read_swatch_photo(state: &AppState, swatch_id: &str) -> AppResult<(String, Vec<u8>)> {
    let name = db::get_swatch(&state.db(), swatch_id)?.photo_path;
    let path = existing_file(&swatch_photos_dir(state), &name)
        .ok_or_else(|| AppError::Message("This swatch has no photo.".into()))?;
    read_file(path)
}

/// Deletes a stored swatch photo by its file name, best effort.
pub fn delete_swatch_photo_file(state: &AppState, file_name: &str) {
    if let Some(path) = existing_file(&swatch_photos_dir(state), file_name) {
        let _ = std::fs::remove_file(path);
    }
}

// ---------- wishlist pictures ----------

pub fn wish_photos_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("wish-photos")
}

/// Saves a wishlist item's picture, replacing any previous one.
pub fn set_wish_photo(state: &AppState, wish_id: &str, bytes: Vec<u8>) -> AppResult<()> {
    let (ext, _mime) = validate(&bytes)?;
    let old = db::get_wish(&state.db(), wish_id)?.photo_path;
    replace_file(&wish_photos_dir(state), wish_id, ext, &bytes, &old, |name| {
        db::set_wish_photo(&state.db(), wish_id, name)
    })
    .map(|_| ())
}

pub fn remove_wish_photo(state: &AppState, wish_id: &str) -> AppResult<()> {
    let name = db::get_wish(&state.db(), wish_id)?.photo_path;
    delete_wish_photo_file(state, &name);
    db::set_wish_photo(&state.db(), wish_id, "")
}

pub fn read_wish_photo(state: &AppState, wish_id: &str) -> AppResult<(String, Vec<u8>)> {
    let name = db::get_wish(&state.db(), wish_id)?.photo_path;
    let path = existing_file(&wish_photos_dir(state), &name)
        .ok_or_else(|| AppError::Message("This has no picture.".into()))?;
    read_file(path)
}

/// Deletes a stored wishlist picture by its file name, best effort.
pub fn delete_wish_photo_file(state: &AppState, file_name: &str) {
    if let Some(path) = existing_file(&wish_photos_dir(state), file_name) {
        let _ = std::fs::remove_file(path);
    }
}

/// Deletes a stored project cover by its file name, best effort.
pub fn delete_project_cover_file(state: &AppState, file_name: &str) {
    if let Some(path) = existing_file(&project_covers_dir(state), file_name) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What is in a folder, names sorted, and the folder of a test.
    fn listing(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn a_picture_replaced_by_another_kind_is_recorded_then_the_old_one_goes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("p1.jpg"), b"old").unwrap();
        let mut recorded = String::new();
        let name = replace_file(dir.path(), "p1", "png", b"new", "p1.jpg", |n| {
            // The old one is still there while the new one is recorded.
            assert!(dir.path().join("p1.jpg").exists() && dir.path().join("p1.png").exists());
            recorded = n.to_string();
            Ok(())
        })
        .unwrap();
        assert_eq!((name.as_str(), recorded.as_str()), ("p1.png", "p1.png"));
        assert_eq!(listing(dir.path()), ["p1.png"]);
        assert_eq!(std::fs::read(dir.path().join("p1.png")).unwrap(), b"new");
    }

    #[test]
    fn a_picture_whose_record_fails_leaves_the_old_one_as_it_was() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("p1.jpg"), b"old").unwrap();
        let failed = replace_file(dir.path(), "p1", "png", b"new", "p1.jpg", |_| Err(AppError::Message("locked".into())));
        assert!(failed.is_err());
        assert_eq!(listing(dir.path()), ["p1.jpg"], "the new file and any temporary one cleared away");
        assert_eq!(std::fs::read(dir.path().join("p1.jpg")).unwrap(), b"old");
    }

    #[test]
    fn a_picture_of_the_same_kind_is_replaced_in_place() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("p1.jpg"), b"old").unwrap();
        let name = replace_file(dir.path(), "p1", "jpg", b"new", "p1.jpg", |_| Ok(())).unwrap();
        assert_eq!(name, "p1.jpg");
        assert_eq!(listing(dir.path()), ["p1.jpg"]);
        assert_eq!(std::fs::read(dir.path().join("p1.jpg")).unwrap(), b"new");
        // And a first picture, with nothing before it.
        let first = replace_file(dir.path(), "p2", "png", b"one", "", |_| Ok(())).unwrap();
        assert_eq!(first, "p2.png");
        assert_eq!(listing(dir.path()), ["p1.jpg", "p2.png"]);
    }

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
