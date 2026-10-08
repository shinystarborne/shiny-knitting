use std::path::{Path, PathBuf};

use tauri::State;

use crate::db;
use crate::models::{
    Annotation, AnnotationInput, AppError, Bookmark, ExportRequest, PageRotation, Pin, PinInput,
    PinPlacement,
    MAX_PINS,
};

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

// ---------- annotations ----------

#[tauri::command]
pub fn list_annotations(
    state: State<'_, AppState>,
    pattern_id: String,
) -> CmdResult<Vec<Annotation>> {
    db::list_annotations(&state.db(), &pattern_id)
}

#[tauri::command]
pub fn add_annotation(
    state: State<'_, AppState>,
    pattern_id: String,
    input: AnnotationInput,
) -> CmdResult<Annotation> {
    db::insert_annotation(&state.db(), &pattern_id, &input)
}

#[tauri::command]
pub fn delete_annotation(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::delete_annotation(&state.db(), &id)
}

#[tauri::command]
pub fn edit_annotation(
    state: State<'_, AppState>,
    id: String,
    text: String,
    color: String,
) -> CmdResult<()> {
    db::update_annotation_text(&state.db(), &id, &text, &color)
}

// ---------- bookmarks ----------

#[tauri::command]
pub fn list_bookmarks(state: State<'_, AppState>, pattern_id: String) -> CmdResult<Vec<Bookmark>> {
    db::list_bookmarks(&state.db(), &pattern_id)
}

#[tauri::command]
pub fn add_bookmark(
    state: State<'_, AppState>,
    pattern_id: String,
    page: i64,
    title: String,
    position: Option<i64>,
) -> CmdResult<Bookmark> {
    let title = clean_title(&title);
    db::add_bookmark(&state.db(), &pattern_id, page, &title, position)
}

#[tauri::command]
pub fn rename_bookmark(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> CmdResult<Bookmark> {
    let title = clean_title(&title);
    db::rename_bookmark(&state.db(), &id, &title)?;
    let conn = state.db();
    let bookmark = conn.query_row(
        "SELECT * FROM bookmarks WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(Bookmark {
                id: row.get("id")?,
                pattern_id: row.get("pattern_id")?,
                page: row.get("page")?,
                title: row.get("title")?,
                sort_order: row.get("sort_order")?,
                created_at: row.get("created_at")?,
            })
        },
    )?;
    Ok(bookmark)
}

#[tauri::command]
pub fn move_bookmark(
    state: State<'_, AppState>,
    id: String,
    position: i64,
) -> CmdResult<()> {
    db::move_bookmark(&state.db(), &id, position)
}

#[tauri::command]
pub fn delete_bookmark(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::delete_bookmark(&state.db(), &id)
}

// ---------- page rotations ----------

#[tauri::command]
pub fn list_page_rotations(
    state: State<'_, AppState>,
    pattern_id: String,
) -> CmdResult<Vec<PageRotation>> {
    db::list_page_rotations(&state.db(), &pattern_id)
}

/// Turns one page; returns the rotation it now has (0, 90, 180 or 270).
#[tauri::command]
pub fn set_page_rotation(
    state: State<'_, AppState>,
    pattern_id: String,
    page: i64,
    rotation: i64,
) -> CmdResult<i64> {
    db::set_page_rotation(&state.db(), &pattern_id, page, rotation)
}

/// Falls back to something usable when the user saves a bookmark without
/// typing a name, which is otherwise a silent no-op. Never returns an empty
/// string: pins route through this too, and a pin's title likewise becomes
/// "Untitled" rather than blank.
fn clean_title(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

// ---------- pins ----------

/// Where cropped pin images live, beside the covers.
fn pins_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("pins")
}

#[tauri::command]
pub fn list_pins(state: State<'_, AppState>, pattern_id: String) -> CmdResult<Vec<Pin>> {
    db::list_pins(&state.db(), &pattern_id)
}

/// How many pins a pattern already has, so the UI can grey out the button
/// before the user gets an error.
#[tauri::command]
pub fn pin_count(state: State<'_, AppState>, pattern_id: String) -> CmdResult<usize> {
    db::count_pins(&state.db(), &pattern_id)
}

#[tauri::command]
pub fn add_pin(state: State<'_, AppState>, pattern_id: String, input: PinInput) -> CmdResult<Pin> {
    let conn = state.db();
    let existing = db::count_pins(&conn, &pattern_id)?;
    if existing >= MAX_PINS {
        return Err(AppError::Message(format!(
            "This pattern already has {MAX_PINS} pins. Remove one before adding another."
        )));
    }
    if input.image_bytes.is_empty() {
        return Err(AppError::Message("There was nothing to pin.".into()));
    }

    // The same content check the covers use, so a pin cannot be an arbitrary
    // file renamed to .jpg.
    let ext = crate::covers::sniff_extension(&input.image_bytes)
        .ok_or_else(|| AppError::Message("That pin image could not be read.".into()))?;

    let dir = pins_dir(&state);
    std::fs::create_dir_all(&dir)?;
    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{id}.{ext}");
    std::fs::write(dir.join(&file_name), &input.image_bytes)?;

    let pin = match db::insert_pin(&conn, &pattern_id, &input, &file_name) {
        Ok(p) => p,
        Err(e) => {
            // Do not leave an orphaned image if the row could not be written.
            let _ = std::fs::remove_file(dir.join(&file_name));
            return Err(e);
        }
    };
    Ok(pin)
}

#[tauri::command]
pub fn update_pin(
    state: State<'_, AppState>,
    id: String,
    placement: PinPlacement,
) -> CmdResult<Pin> {
    let conn = state.db();
    // Clamp to the pane so a card cannot be dragged off into nothing.
    let clamped = PinPlacement {
        offset_x: placement.offset_x.clamp(0.0, 0.98),
        offset_y: placement.offset_y.clamp(0.0, 0.98),
        width: placement.width.clamp(0.1, 0.9),
        hidden: placement.hidden,
    };
    db::update_pin_placement(&conn, &id, &clamped)
}

/// Brings a pin to the front of the pattern's pins.
#[tauri::command]
pub fn raise_pin(state: State<'_, AppState>, id: String) -> CmdResult<Pin> {
    db::raise_pin(&state.db(), &id)
}

#[tauri::command]
pub fn rename_pin(state: State<'_, AppState>, id: String, title: String) -> CmdResult<()> {
    let title = clean_title(&title);
    db::rename_pin(&state.db(), &id, &title)
}

#[tauri::command]
pub fn delete_pin(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let conn = state.db();
    let file = db::delete_pin(&conn, &id)?;
    if let Some(name) = file {
        // Best effort: a missing image is not a reason to fail the delete.
        let _ = std::fs::remove_file(pins_dir(&state).join(crate::covers::safe_name(&name)));
    }
    Ok(())
}

#[tauri::command]
pub fn get_pin_image(state: State<'_, AppState>, id: String) -> CmdResult<tauri::ipc::Response> {
    let pin = db::get_pin(&state.db(), &id)?;
    if pin.image_file.is_empty() {
        return Err(AppError::Message("This pin has no image.".into()));
    }
    let path = pins_dir(&state).join(crate::covers::safe_name(&pin.image_file));
    let bytes = std::fs::read(path)?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------- export ----------

/// Builds a PDF from chosen pages or chapters and writes it out.
///
/// The heavy lifting is in the webview, which already has a rendered canvas
/// for every page; this receives the finished images, stacks them into a PDF,
/// and puts the file somewhere the user can find it.
///
/// `images` holds one rendered image per chosen page, in the order the user
/// picked them.
#[tauri::command]
pub fn save_export_pdf(
    state: State<'_, AppState>,
    request: ExportRequest,
    images: Vec<ExportImage>,
) -> CmdResult<ExportResult> {
    if request.pages.is_empty() {
        return Err(AppError::Message("Choose at least one page to export.".into()));
    }
    if images.is_empty() {
        return Err(AppError::Message("Nothing was rendered to export.".into()));
    }
    if images.len() != request.pages.len() {
        return Err(AppError::Message(
            "The pages chosen and the pages rendered do not match. Try again.".into(),
        ));
    }
    if images.len() > 200 {
        return Err(AppError::Message(
            "That is more than 200 pages; the file would be enormous.".into(),
        ));
    }

    let bytes = super::export::build_pdf(&images)?;

    let pattern = db::get_pattern(&state.db(), &request.pattern_id)?;
    let name = export_file_name(&request, &pattern.title);
    let dir = state.library_dir.join("exports");
    std::fs::create_dir_all(&dir)?;
    // Two exports of the same pattern would otherwise overwrite each other.
    let path = unique_path(&dir, &name);
    std::fs::write(&path, &bytes)?;

    Ok(ExportResult {
        path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        page_count: images.len(),
        size_bytes: bytes.len(),
    })
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportImage {
    /// The page or chapter this came from, for the reader of the PDF later.
    pub page: i64,
    pub label: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub file_name: String,
    pub page_count: usize,
    pub size_bytes: usize,
}

/// Builds a file name that is safe on Windows and says what is inside it.
///
/// A name the caller chose is honoured, reduced to a plain file name the same
/// way cover names are, so it can never point outside the exports folder.
/// Otherwise one is generated from the pattern's title and the chosen pages.
fn export_file_name(request: &ExportRequest, title: &str) -> String {
    let requested = request.file_name.trim();
    if !requested.is_empty() {
        let safe = crate::covers::safe_name(requested);
        if safe.to_ascii_lowercase().ends_with(".pdf") {
            return safe;
        }
        return format!("{safe}.pdf");
    }
    let stem: String = title
        .chars()
        .map(|c| match c {
            // These are the characters Windows refuses in a file name.
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if (c as u32) < 0x20 => '-',
            c => c,
        })
        .collect();
    let stem = stem.trim().trim_matches('.').to_string();
    let stem = if stem.is_empty() { "pattern".to_string() } else { stem };
    let pages = summarise_pages(&request.pages);
    format!("{stem} {pages}.pdf")
}

fn summarise_pages(pages: &[i64]) -> String {
    let first = match pages.first() {
        Some(p) => *p,
        None => return String::new(),
    };
    let last = *pages.last().unwrap_or(&first);
    if first == last {
        format!("page {first}")
    } else {
        format!("pages {first}-{last}")
    }
}

/// Appends ` (2)`, ` (3)` and so on rather than overwriting an earlier export.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = name.strip_suffix(".pdf").unwrap_or(name);
    for n in 2..1000 {
        let next = dir.join(format!("{stem} ({n}).pdf"));
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!("{stem} ({}).pdf", uuid::Uuid::new_v4()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(file_name: &str) -> ExportRequest {
        ExportRequest {
            pattern_id: "p".to_string(),
            pages: vec![2, 3],
            file_name: file_name.to_string(),
        }
    }

    #[test]
    fn an_empty_name_is_generated_from_the_title_and_pages() {
        assert_eq!(export_file_name(&request(""), "Lace Sock"), "Lace Sock pages 2-3.pdf");
        assert_eq!(export_file_name(&request("   "), "Lace Sock"), "Lace Sock pages 2-3.pdf");
    }

    #[test]
    fn a_chosen_name_is_honoured_and_made_safe() {
        assert_eq!(export_file_name(&request("chart.pdf"), "Lace Sock"), "chart.pdf");
        // The extension is added when it is missing.
        assert_eq!(export_file_name(&request("chart"), "Lace Sock"), "chart.pdf");
        // Anything that could escape the exports folder is stripped out.
        let name = export_file_name(&request("../../evil.pdf"), "Lace Sock");
        assert!(!name.contains('/'), "{name} kept a separator");
        assert!(!name.contains('\\'), "{name} kept a separator");
        assert!(name.ends_with(".pdf"), "{name}");
    }
}
