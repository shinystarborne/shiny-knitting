use std::path::{Path, PathBuf};

use rusqlite::OptionalExtension;
use tauri::State;

use crate::ai::{CompletionRequest, ModelInfo};
use crate::db;
use crate::models::{
    AiSettings, AppError, CoverImage, Counter, CounterInput, HighlightSettings, Pattern,
    PatternInput, Progress, Suggestion, SuggestionResult,
};
use crate::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// Copies the file into the app's library and registers it.
///
/// The file lands in `library/originals/` under a UUID filename, so two
/// patterns with the same original name never collide.
///
/// The file arrives one of two ways. `source_path` is a path from the native
/// file dialog and is copied here, which keeps the file's bytes off the IPC
/// channel entirely. `bytes` is for drag and drop, where the webview only ever
/// hands us the contents.
///
/// `source_path` widens what this command can read compared with taking bytes
/// alone: it will copy from wherever it is told. That is the point, and it is
/// safe here because the only path the app ever produces comes from the native
/// dialog, the webview loads nothing remote, and the copy is read-only into a
/// freshly generated name — the original is never moved or modified.
#[tauri::command]
pub fn add_pattern(state: State<'_, AppState>, input: PatternInput) -> CmdResult<Pattern> {
    let mut input = input;

    // A path is authoritative about the file's name, so drop whatever the
    // caller guessed and take it from the disk.
    let source = match input.source_path.take().filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let path = PathBuf::from(&p);
            input.file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| input.file_name.clone());
            Some(path)
        }
        None => None,
    };

    let ext = Path::new(&input.file_name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let format = match ext.as_str() {
        "pdf" => "pdf",
        "epub" => "epub",
        other => {
            return Err(AppError::UnknownFormat(format!(
                ".{} (only pdf and epub are supported)",
                other
            )))
        }
    };

    let id = uuid::Uuid::new_v4().to_string();
    let dir = state.library_dir.join("originals");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(format!("{}.{}", id, ext));

    match source {
        Some(path) => {
            // Copy rather than move: the user's original is theirs to keep.
            std::fs::copy(&path, &dest).map_err(|e| {
                AppError::Message(format!("Could not read {}: {}", path.display(), e))
            })?;
        }
        None => {
            let bytes = input.bytes.as_deref().ok_or_else(|| {
                AppError::Message("No file was given to add.".into())
            })?;
            std::fs::write(&dest, bytes)?;
        }
    }

    let stored = match db::insert_pattern(&state.db(), &id, &input, &dest.to_string_lossy(), format) {
        Ok(p) => p,
        Err(e) => {
            // Don't leave an orphan file behind if the insert failed.
            let _ = std::fs::remove_file(&dest);
            return Err(e);
        }
    };
    Ok(stored)
}

#[tauri::command]
pub fn list_patterns(state: State<'_, AppState>, filter: db::Filter) -> CmdResult<Vec<Pattern>> {
    db::list_patterns(&state.db(), &filter)
}

#[tauri::command]
pub fn get_pattern(state: State<'_, AppState>, id: String) -> CmdResult<Pattern> {
    db::get_pattern(&state.db(), &id)
}

#[tauri::command]
pub fn update_pattern(state: State<'_, AppState>, pattern: Pattern) -> CmdResult<Pattern> {
    db::update_pattern(&state.db(), &pattern)
}

#[tauri::command]
pub fn delete_pattern(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    delete_pattern_from(&state, &id)
}

/// Deletes a pattern and every file the library kept for it: the document
/// itself, its cover, and its pin images. Leaving any of them behind would
/// fill the library with orphans nothing references.
fn delete_pattern_from(state: &AppState, id: &str) -> CmdResult<()> {
    let (file, cover, pin_images) = {
        let conn = state.db();
        let file = db::get_pattern(&conn, id).ok().map(|p| p.file_path);
        let cover = db::get_cover(&conn, id).unwrap_or_default();
        let pin_images = db::list_pins(&conn, id)
            .map(|pins| {
                pins.into_iter()
                    .map(|p| p.image_file)
                    .filter(|f| !f.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        (file, cover, pin_images)
    };

    db::delete_pattern(&state.db(), id)?;

    // Best effort, like the pin delete: a file already gone is not a reason
    // to fail, and the row is already removed either way.
    let remove = |path: PathBuf| {
        // Guard against a malformed path escaping the library folder.
        if path.starts_with(&state.library_dir) {
            let _ = std::fs::remove_file(path);
        }
    };
    if let Some(file) = file {
        remove(PathBuf::from(file));
    }
    if !cover.is_empty() {
        remove(
            state
                .library_dir
                .join("covers")
                .join(crate::covers::safe_name(&cover)),
        );
    }
    for image in pin_images {
        remove(
            state
                .library_dir
                .join("pins")
                .join(crate::covers::safe_name(&image)),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn get_facets(state: State<'_, AppState>) -> CmdResult<db::Facets> {
    db::list_facets(&state.db())
}

#[tauri::command]
pub fn save_position(
    state: State<'_, AppState>,
    id: String,
    page: i64,
    scroll: f64,
) -> CmdResult<()> {
    db::touch_pattern(&state.db(), &id, page, scroll)
}

/// Returns the bytes of a pattern's file for the renderer to display.
///
/// Returned as a raw IPC payload rather than `Vec<u8>`. A JSON array of
/// numbers costs roughly three characters per byte and has to be built and
/// parsed on both sides, which made opening a large PDF take tens of seconds;
/// the raw form is a straight copy.
#[tauri::command]
pub fn read_file(state: State<'_, AppState>, id: String) -> CmdResult<tauri::ipc::Response> {
    let pattern = db::get_pattern(&state.db(), &id)?;
    let path = PathBuf::from(&pattern.file_path);
    // Only ever read files inside our own library.
    if !path.starts_with(&state.library_dir) {
        return Err(AppError::Message("file is outside the library".into()));
    }
    let bytes = std::fs::read(path)?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------- counters ----------

#[tauri::command]
pub fn list_counters(state: State<'_, AppState>, pattern_id: String) -> CmdResult<Vec<Counter>> {
    db::list_counters(&state.db(), &pattern_id)
}

#[tauri::command]
pub fn add_counter(
    state: State<'_, AppState>,
    pattern_id: String,
    input: CounterInput,
) -> CmdResult<Counter> {
    db::add_counter(&state.db(), &pattern_id, &input)
}

#[tauri::command]
pub fn update_counter(
    state: State<'_, AppState>,
    id: String,
    name: String,
    target: i64,
    excluded_from_total: bool,
) -> CmdResult<()> {
    db::update_counter(&state.db(), &id, &name, target, excluded_from_total)
}

/// Switches a counter on or off, and reports the full state afterwards.
///
/// The counters come back with the result so the sidebar can repaint from one
/// round trip rather than guessing which rows changed.
#[tauri::command]
pub fn set_counter_enabled(
    state: State<'_, AppState>,
    pattern_id: String,
    id: String,
    enabled: bool,
) -> CmdResult<db::CountOutcome> {
    set_counter_enabled_on(&state.db(), &pattern_id, &id, enabled)
}

/// The body of `set_counter_enabled`, on a plain connection for tests.
fn set_counter_enabled_on(
    conn: &rusqlite::Connection,
    pattern_id: &str,
    id: &str,
    enabled: bool,
) -> CmdResult<db::CountOutcome> {
    // The counter must belong to the pattern the outcome is reported against:
    // a mismatched pair would toggle one pattern's counter while reporting
    // another's totals, corrupting the sidebar's picture of both.
    let owner: Option<String> = conn
        .query_row(
            "SELECT pattern_id FROM counters WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .optional()?;
    if owner.as_deref() != Some(pattern_id) {
        return Err(AppError::NotFound(format!("No counter with id {id}.")));
    }
    db::set_counter_enabled(conn, id, enabled)?;
    let total = db::get_progress(conn, pattern_id)?.total_rows;
    let counters = db::list_counters(conn, pattern_id)?;
    Ok(db::CountOutcome {
        pattern_id: pattern_id.to_string(),
        total_rows: total,
        counters,
    })
}

/// One counting action: the project total, plus every counter that is on.
///
/// The total is the reason this exists as a single command rather than the
/// frontend adding up the pieces -- the clamping rules live in the data layer,
/// and a client that reimplemented them would drift.
#[tauri::command]
pub fn count_rows(
    state: State<'_, AppState>,
    pattern_id: String,
    delta: i64,
) -> CmdResult<db::CountOutcome> {
    db::count_rows(&state.db(), &pattern_id, delta)
}

/// Moves one counter on its own, from its own buttons.
#[tauri::command]
pub fn count_counter(
    state: State<'_, AppState>,
    id: String,
    delta: i64,
) -> CmdResult<db::CountOutcome> {
    db::count_one(&state.db(), &id, delta)
}

#[tauri::command]
pub fn reset_counter(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::reset_counter(&state.db(), &id)
}

#[tauri::command]
pub fn delete_counter(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::delete_counter(&state.db(), &id)
}

// ---------- progress ----------

#[tauri::command]
pub fn get_progress(state: State<'_, AppState>, pattern_id: String) -> CmdResult<Progress> {
    db::get_progress(&state.db(), &pattern_id)
}

#[tauri::command]
pub fn set_total_rows(
    state: State<'_, AppState>,
    pattern_id: String,
    total: i64,
) -> CmdResult<Progress> {
    let conn = state.db();
    db::set_total_rows(&conn, &pattern_id, total)?;
    db::get_progress(&conn, &pattern_id)
}

// ---------- highlight ----------

#[tauri::command]
pub fn get_highlight(
    state: State<'_, AppState>,
    pattern_id: String,
) -> CmdResult<HighlightSettings> {
    db::get_highlight(&state.db(), &pattern_id)
}

#[tauri::command]
pub fn save_highlight(
    state: State<'_, AppState>,
    settings: HighlightSettings,
) -> CmdResult<HighlightSettings> {
    db::save_highlight(&state.db(), &settings)?;
    Ok(settings)
}

// ---------- covers ----------

/// Stores image bytes as a pattern's cover.
#[tauri::command]
pub fn set_cover(
    state: State<'_, AppState>,
    pattern_id: String,
    bytes: Vec<u8>,
) -> CmdResult<CoverImage> {
    crate::covers::set_cover(&state, &pattern_id, bytes)
}

/// Returns a pattern's cover as a raw payload.
///
/// The MIME type is not sent alongside: every cover is JPEG or PNG, and the
/// frontend can tell them apart from the first few bytes. Sending bytes as a
/// JSON array of numbers costs about three characters each, which for a large
/// cover was slow enough to notice while the library painted itself.
#[tauri::command]
pub fn get_cover(
    state: State<'_, AppState>,
    pattern_id: String,
) -> CmdResult<tauri::ipc::Response> {
    let (_mime, bytes) = crate::covers::read_cover(&state, &pattern_id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn remove_cover(state: State<'_, AppState>, pattern_id: String) -> CmdResult<()> {
    crate::covers::remove_cover(&state, &pattern_id)
}

// ---------- AI metadata ----------

const AI_SETTINGS_KEY: &str = "ai";

/// Reads the AI settings and unlocks the API key for use.
///
/// The key never leaves the backend in plaintext: only a boolean is handed to
/// the frontend, and only the provider calls get the real value.
fn unlocked_ai_settings(state: &AppState) -> CmdResult<AiSettings> {
    let mut settings: AiSettings = db::get_setting(&state.db(), AI_SETTINGS_KEY)?;
    if !settings.api_key.is_empty() && crate::ai::secret::is_encrypted(&settings.api_key) {
        settings.api_key = crate::ai::secret::decrypt(&settings.api_key)
            .map_err(AppError::Message)?;
    }
    Ok(settings)
}

/// Returns the AI settings with the API key replaced by a boolean, so the
/// plaintext key never crosses into the webview.
#[tauri::command]
pub fn get_ai_settings(state: State<'_, AppState>) -> CmdResult<AiSettingsView> {
    let settings: AiSettings = db::get_setting(&state.db(), AI_SETTINGS_KEY)?;
    Ok(AiSettingsView::from_settings(settings))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    pub base_url: String,
    pub model: String,
    pub fallback_model: String,
    pub has_api_key: bool,
    /// True when the address looks like this machine or a private network.
    /// The UI uses this to say plainly whether anything leaves the machine.
    pub is_local: bool,
    pub apply_automatically: bool,
    pub skip_existing: bool,
    pub max_characters: i64,
    pub reasoning_effort: String,
    pub rescan_existing: bool,
}

impl AiSettingsView {
    fn from_settings(s: AiSettings) -> Self {
        Self {
            is_local: crate::ai::is_local_model_server(&s),
            base_url: s.base_url,
            model: s.model,
            fallback_model: s.fallback_model,
            has_api_key: !s.api_key.is_empty(),
            apply_automatically: s.apply_automatically,
            skip_existing: s.skip_existing,
            max_characters: s.max_characters,
            reasoning_effort: s.reasoning_effort,
            rescan_existing: s.rescan_existing,
        }
    }

    /// Rebuilds full settings for a request. The API key is carried over from
    /// storage; it is never sent to or from the webview.
    fn to_settings(&self, stored: &AiSettings) -> AiSettings {
        AiSettings {
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            fallback_model: self.fallback_model.clone(),
            api_key: stored.api_key.clone(),
            apply_automatically: self.apply_automatically,
            skip_existing: self.skip_existing,
            max_characters: self.max_characters,
            reasoning_effort: self.reasoning_effort.clone(),
            rescan_existing: self.rescan_existing,
        }
    }
}

/// Saves the AI settings, encrypting a newly entered API key.
#[tauri::command]
pub fn save_ai_settings(
    state: State<'_, AppState>,
    settings: AiSettingsView,
    api_key: Option<String>,
) -> CmdResult<AiSettingsView> {
    let conn = state.db();
    let mut stored: AiSettings = db::get_setting(&conn, AI_SETTINGS_KEY)?;

    let mut next = settings.to_settings(&stored);

    // An empty field means "leave the saved key alone"; a field with text
    // replaces it.
    if let Some(key) = api_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            next.api_key =
                crate::ai::secret::encrypt(trimmed).map_err(AppError::Message)?;
        } else {
            next.api_key = String::new();
        }
    }
    stored = next;

    db::set_setting(&conn, AI_SETTINGS_KEY, &stored)?;
    Ok(AiSettingsView::from_settings(stored))
}

/// Checks the configured server is reachable, and lists its models.
#[tauri::command]
pub async fn test_ai_connection(
    state: State<'_, AppState>,
) -> CmdResult<AiConnectionTest> {
    let settings = unlocked_ai_settings(&state)?;
    if settings.base_url.trim().is_empty() {
        return Err(AppError::Message(
            "Enter the address of your model server in Settings first.".into(),
        ));
    }
    let models = crate::ai::list_models(&settings)
        .await
        .map_err(|e| AppError::Message(e.to_string()))?;
    Ok(AiConnectionTest {
        ok: true,
        model_count: models.len(),
        models: models.into_iter().take(300).collect(),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTest {
    pub ok: bool,
    pub model_count: usize,
    pub models: Vec<ModelInfo>,
}

/// Asks the configured model to fill in metadata for one pattern.
///
/// `excerpt` is the text the frontend extracted, already trimmed to the
/// configured budget. When it is empty, `images` carries rendered page
/// pictures instead, which is the only way to read a scan or a photograph.
/// The result is returned whether or not it is applied, so the UI can show it
/// either way.
#[tauri::command]
pub async fn suggest_metadata(
    state: State<'_, AppState>,
    pattern_id: String,
    excerpt: String,
    images: Option<Vec<String>>,
) -> CmdResult<SuggestionResult> {
    let settings = unlocked_ai_settings(&state)?;
    let before = db::get_pattern(&state.db(), &pattern_id)?;

    if settings.base_url.trim().is_empty() {
        return Ok(failed(
            &before,
            "No model server is set up. Open Settings to enter its address.",
        ));
    }
    let images: Vec<String> = images
        .unwrap_or_default()
        .into_iter()
        .filter(|i| i.starts_with("data:image/"))
        .collect();

    if excerpt.trim().is_empty() && images.is_empty() {
        return Ok(failed(
            &before,
            "This file has no text and no page images could be read from it, \
             so there is nothing to describe.",
        ));
    }

    // With no text there is nothing to quote, so the model is asked to read
    // the pictures instead and told not to guess at what it cannot see.
    let (user, images) = if excerpt.trim().is_empty() {
        (
            crate::ai::build_vision_prompt(&before.title, &before.file_name, images.len()),
            images,
        )
    } else {
        (
            crate::ai::build_user_prompt(
                &before.title,
                &before.file_name,
                // Cleaned here rather than in the frontend, so the budget in
                // settings is the one that actually applies.
                &crate::ai::clean_excerpt(&excerpt, settings.max_characters),
            ),
            // Text is readable, so the pages are not sent as well.
            Vec::new(),
        )
    };

    let request = CompletionRequest {
        system: crate::ai::SYSTEM_PROMPT.to_string(),
        user,
        images,
    };

    let sent_images = !request.images.is_empty();

    let reply = match crate::ai::complete(&settings, &request).await {
        Ok(text) => text,
        Err(e) => {
            // A text-only model rejects a request carrying images, and the
            // server's own wording rarely says so. Without this the user sees
            // an opaque error and no idea that the model is the reason.
            let message = if sent_images {
                format!(
                    "{e}\n\nThis file has no text, so its pages were sent as pictures \
                     for the model to read. That needs a model which accepts images; \
                     this one appears not to. Add a text layer with OCR, or point \
                     Settings at a model that can see."
                )
            } else {
                e.to_string()
            };
            return Ok(failed(&before, &message));
        }
    };

    let value = match crate::ai::extract_json_object(&reply) {
        Some(v) => v,
        None => {
            return Ok(failed(
                &before,
                "The model did not return anything in the expected format.",
            ))
        }
    };

    let suggestion = crate::ai::parse_suggestion(&value);
    if crate::ai::is_empty(&suggestion) {
        return Ok(failed(
            &before,
            "The model did not find any of: designer, difficulty, needle size, or yarn.",
        ));
    }

    let after = crate::ai::metadata::apply_to(&before, &suggestion, &settings);
    let changed_fields = crate::ai::metadata::changed_fields(&before, &after);

    let mut applied = false;
    if settings.apply_automatically && !changed_fields.is_empty() {
        let conn = state.db();
        crate::ai::metadata::commit(&conn, &before, &after)?;
        applied = true;
    }

    Ok(SuggestionResult {
        pattern_id: pattern_id.clone(),
        pattern_title: before.title.clone(),
        failed: false,
        error: String::new(),
        suggestion,
        before,
        after,
        changed_fields,
        applied,
    })
}

fn failed(before: &Pattern, message: &str) -> SuggestionResult {
    SuggestionResult {
        pattern_id: before.id.clone(),
        pattern_title: before.title.clone(),
        failed: true,
        error: message.to_string(),
        suggestion: Suggestion::default(),
        before: before.clone(),
        after: before.clone(),
        changed_fields: Vec::new(),
        applied: false,
    }
}

/// Writes a suggestion that the user reviewed and accepted.
#[tauri::command]
pub fn apply_suggestion(
    state: State<'_, AppState>,
    pattern_id: String,
    after: Pattern,
) -> CmdResult<Pattern> {
    apply_suggestion_to(&state.db(), &pattern_id, &after)
}

/// The body of `apply_suggestion`, on a plain connection so tests can reach
/// it without a Tauri runtime.
fn apply_suggestion_to(
    conn: &rusqlite::Connection,
    pattern_id: &str,
    after: &Pattern,
) -> CmdResult<Pattern> {
    let before = db::get_pattern(conn, pattern_id)?;
    // Only the fields the AI is allowed to touch are taken from the caller, so
    // a stale form cannot roll back a title or a file path. The yarn weight is
    // one of them: the review dialog shows a "Yarn weight" row, and dropping
    // it here would discard the change the user just accepted. The family is
    // not copied -- db::update_pattern re-derives it from the weight.
    let mut merged = before.clone();
    merged.designer = after.designer.clone();
    merged.difficulty = after.difficulty.clone();
    merged.needle_size = after.needle_size.clone();
    merged.yarn_weight = after.yarn_weight.clone();
    merged.notes = after.notes.clone();
    merged.tags = after.tags.clone();
    if merged == before {
        return Ok(before);
    }
    crate::ai::metadata::commit(conn, &before, &merged)
}

/// Restores a pattern's metadata to before the most recent AI change.
#[tauri::command]
pub fn undo_last_ai_change(
    state: State<'_, AppState>,
    pattern_id: String,
) -> CmdResult<Option<Pattern>> {
    undo_last_ai_change_on(&state.db(), &pattern_id)
}

/// The body of `undo_last_ai_change`, on a plain connection for tests.
fn undo_last_ai_change_on(
    conn: &rusqlite::Connection,
    pattern_id: &str,
) -> CmdResult<Option<Pattern>> {
    let entry = db::latest_ai_change(conn, pattern_id)?;
    let (_id, before) = match entry {
        Some(v) => v,
        None => return Ok(None),
    };
    let current = db::get_pattern(conn, pattern_id)?;
    // Only the fields the AI can write are rolled back. The snapshot is a
    // whole pattern, but restoring it wholesale would also roll back any
    // title or status edits the user made after the AI change. Notes go back
    // with the rest, since notes is one of the fields the AI writes.
    let mut restored = current.clone();
    restored.designer = before.designer;
    restored.difficulty = before.difficulty;
    restored.needle_size = before.needle_size;
    restored.yarn_weight = before.yarn_weight;
    restored.notes = before.notes;
    restored.tags = before.tags;
    // Restoring the snapshot is itself a change, so it gets its own undo
    // point rather than erasing history.
    let restored = db::update_pattern(conn, &restored)?;
    db::record_ai_change(conn, &current.id, &current, &restored)?;
    Ok(Some(restored))
}

/// Whether a pattern can be undone, for enabling the button.
#[tauri::command]
pub fn has_ai_history(state: State<'_, AppState>, pattern_id: String) -> CmdResult<bool> {
    Ok(db::latest_ai_change(&state.db(), &pattern_id)?.is_some())
}

/// Reports which patterns still lack a cover, so the UI can offer to fill
/// them in rather than making the user check each card.
#[tauri::command]
pub fn patterns_missing_covers(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    let patterns = db::list_patterns(&state.db(), &db::Filter::default())?;
    Ok(patterns
        .into_iter()
        .filter(|p| !crate::covers::has_cover(&state, &p.id))
        .map(|p| p.id)
        .collect())
}

/// Forgets the undo history for a pattern, once the user is happy with it.
#[tauri::command]
pub fn clear_ai_history(state: State<'_, AppState>, pattern_id: String) -> CmdResult<()> {
    db::clear_ai_history(&state.db(), &pattern_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CounterInput, PatternInput, Suggestion};

    /// A pattern on a throwaway in-memory database.
    fn pattern(conn: &rusqlite::Connection, title: &str) -> Pattern {
        let input = PatternInput {
            title: title.to_string(),
            designer: String::new(),
            file_name: format!("{title}.pdf"),
            bytes: Some(vec![]),
            source_path: None,
            status: "want-to-knit".to_string(),
            difficulty: String::new(),
            needle_size: String::new(),
            yarn_weight: String::new(),
            tags: vec![],
            notes: String::new(),
        };
        let id = uuid::Uuid::new_v4().to_string();
        db::insert_pattern(conn, &id, &input, &format!("C:/lib/{id}.pdf"), "pdf").unwrap()
    }

    #[test]
    fn applying_a_suggestion_keeps_the_yarn_weight() {
        // The review dialog shows a "Yarn weight" before/after row; accepting
        // it must not silently drop the field.
        let conn = db::open_test_db();
        let before = pattern(&conn, "Sock");
        let suggestion = Suggestion {
            yarn_weight: "aran".to_string(),
            ..Suggestion::default()
        };
        let after = crate::ai::metadata::apply_to(
            &before,
            &suggestion,
            &crate::models::AiSettings::default(),
        );
        assert_eq!(after.yarn_weight, "aran");

        let saved = apply_suggestion_to(&conn, &before.id, &after).unwrap();
        assert_eq!(saved.yarn_weight, "aran");
        // The family follows the weight, re-derived on write.
        assert_eq!(saved.yarn_weight_family, "aran");

        let fetched = db::get_pattern(&conn, &before.id).unwrap();
        assert_eq!(fetched.yarn_weight, "aran");
        assert_eq!(fetched.yarn_weight_family, "aran");
    }

    #[test]
    fn undo_restores_only_the_fields_the_ai_can_write() {
        // Manual edits made after the AI change must survive an undo.
        let conn = db::open_test_db();
        let before = pattern(&conn, "Cardigan");

        // An AI change, committed the way the suggest command commits it.
        let mut after = before.clone();
        after.designer = "AI Designer".to_string();
        after.yarn_weight = "dk".to_string();
        after.notes = "Yarn: Shetland".to_string();
        crate::ai::metadata::commit(&conn, &before, &after).unwrap();

        // Manual edits afterwards, to fields the AI never touches.
        let mut manual = db::get_pattern(&conn, &before.id).unwrap();
        manual.title = "Renamed by hand".to_string();
        manual.status = "finished".to_string();
        db::update_pattern(&conn, &manual).unwrap();

        let restored = undo_last_ai_change_on(&conn, &before.id)
            .unwrap()
            .expect("an undo point");
        // The AI's changes are rolled back...
        assert_eq!(restored.designer, before.designer);
        assert_eq!(restored.yarn_weight, before.yarn_weight);
        assert_eq!(restored.notes, before.notes);
        // ...and the manual edits are kept.
        assert_eq!(restored.title, "Renamed by hand");
        assert_eq!(restored.status, "finished");
    }

    #[test]
    fn a_counter_cannot_be_toggled_against_the_wrong_pattern() {
        let conn = db::open_test_db();
        let a = pattern(&conn, "A");
        let b = pattern(&conn, "B");
        let counter = db::add_counter(
            &conn,
            &a.id,
            &CounterInput {
                name: "Front".to_string(),
                target: 0,
                enabled: true,
                excluded_from_total: false,
            },
        )
        .unwrap();

        let err = set_counter_enabled_on(&conn, &b.id, &counter.id, false).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got {err}");
        // The mismatched call must not have toggled anything.
        assert!(db::list_counters(&conn, &a.id).unwrap()[0].enabled);

        // The matching pair works and reports the right pattern.
        let out = set_counter_enabled_on(&conn, &a.id, &counter.id, false).unwrap();
        assert_eq!(out.pattern_id, a.id);
        assert!(!out.counters[0].enabled);
    }

    /// A state rooted in a fresh temporary library folder.
    fn state_in_temp_library() -> (AppState, PathBuf) {
        let dir = std::env::temp_dir().join(format!("shiny-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = AppState {
            conn: std::sync::Mutex::new(db::open_test_db()),
            library_dir: dir.clone(),
        };
        (state, dir)
    }

    #[test]
    fn deleting_a_pattern_removes_its_file_cover_and_pin_images() {
        let (state, dir) = state_in_temp_library();

        // A pattern whose document sits in the library, as add_pattern leaves
        // it, plus a cover and a pin image beside it.
        let id = uuid::Uuid::new_v4().to_string();
        let originals = dir.join("originals");
        std::fs::create_dir_all(&originals).unwrap();
        let document = originals.join(format!("{id}.pdf"));
        std::fs::write(&document, b"pdf").unwrap();

        let input = PatternInput {
            title: "Doomed".to_string(),
            designer: String::new(),
            file_name: "doomed.pdf".to_string(),
            bytes: Some(vec![]),
            source_path: None,
            status: "want-to-knit".to_string(),
            difficulty: String::new(),
            needle_size: String::new(),
            yarn_weight: String::new(),
            tags: vec![],
            notes: String::new(),
        };
        {
            let conn = state.db();
            db::insert_pattern(&conn, &id, &input, &document.to_string_lossy(), "pdf").unwrap();

            let covers = dir.join("covers");
            std::fs::create_dir_all(&covers).unwrap();
            std::fs::write(covers.join(format!("{id}.jpg")), b"jpg").unwrap();
            db::set_cover(&conn, &id, &format!("{id}.jpg")).unwrap();

            let pins = dir.join("pins");
            std::fs::create_dir_all(&pins).unwrap();
            std::fs::write(pins.join("pin-image.jpg"), b"jpg").unwrap();
            let pin_input = crate::models::PinInput {
                page: 1,
                geometry: "[]".to_string(),
                quote: String::new(),
                title: String::new(),
                image_bytes: vec![0xFF, 0xD8, 0xFF, 0xE0],
                image_mime: "image/jpeg".to_string(),
            };
            db::insert_pin(&conn, &id, &pin_input, "pin-image.jpg").unwrap();
        }

        delete_pattern_from(&state, &id).unwrap();

        assert!(!document.exists(), "the document leaked");
        assert!(!dir.join("covers").join(format!("{id}.jpg")).exists(), "the cover leaked");
        assert!(!dir.join("pins").join("pin-image.jpg").exists(), "the pin image leaked");
        assert!(db::get_pattern(&state.db(), &id).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
