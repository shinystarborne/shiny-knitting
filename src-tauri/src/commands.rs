use std::path::{Path, PathBuf};

use rusqlite::OptionalExtension;
use tauri::State;

use crate::ai::{CompletionRequest, ModelInfo};
use crate::db;
use crate::models::{
    AiSettings, AppError, CountKeys, CoverImage, Counter, CounterInput, HighlightSettings,
    NeedleSizeDisplay, Pattern, PatternInput, PhotoInfo, Progress, ScannedFile, Suggestion,
    SuggestionResult, Yarn, YarnInput,
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
    add_pattern_to(&state, input)
}

/// The body of `add_pattern`, on a plain state reference so tests can reach it
/// without a Tauri runtime.
fn add_pattern_to(state: &AppState, input: PatternInput) -> CmdResult<Pattern> {
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

    // The bytes are needed in memory either way: the source file is read once
    // and the copy is written from that read, and the drag-and-drop flow
    // already has them in hand. Hashing before anything is written means a
    // duplicate is rejected without leaving a file behind.
    let from_disk;
    let bytes: &[u8] = match &source {
        Some(path) => {
            from_disk = std::fs::read(path).map_err(|e| {
                AppError::Message(format!("Could not read {}: {}", path.display(), e))
            })?;
            &from_disk
        }
        None => input
            .bytes
            .as_deref()
            .ok_or_else(|| AppError::Message("No file was given to add.".into()))?,
    };

    let hash = db::hash_bytes(bytes);
    if let Some(existing) = db::pattern_with_hash(&state.db(), &hash)? {
        return Err(AppError::AlreadyHave(existing.title));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let dir = state.library_dir.join("originals");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(format!("{}.{}", id, ext));
    // Copy rather than move: the user's original is theirs to keep.
    std::fs::write(&dest, bytes)?;

    let stored =
        match db::insert_pattern(&state.db(), &id, &input, &dest.to_string_lossy(), format, &hash)
        {
            Ok(p) => p,
            Err(e) => {
                // Don't leave an orphan file behind if the insert failed.
                let _ = std::fs::remove_file(&dest);
                return Err(e);
            }
        };
    Ok(stored)
}

/// Lists the pattern files under a folder, for picking several to add at once.
///
/// The walk is recursive and case-insensitive on the extension. A subfolder
/// that cannot be read is skipped rather than failing the whole scan, since
/// the files that can be seen are still worth offering. A root that is not a
/// folder at all is the caller's mistake and is an error.
#[tauri::command]
pub fn scan_pattern_folder(path: String) -> CmdResult<Vec<ScannedFile>> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(AppError::Message(format!("Not a folder: {path}")));
    }
    let mut found = Vec::new();
    scan_dir(&root, &mut found);
    // Sorted by full path, so the picker reads the way the folders do on disk.
    found.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(found)
}

fn scan_dir(dir: &Path, found: &mut Vec<ScannedFile>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let kind = match entry.file_type() {
            Ok(kind) => kind,
            Err(_) => continue,
        };
        if kind.is_dir() {
            scan_dir(&path, found);
        } else if kind.is_file() {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if ext == "pdf" || ext == "epub" {
                found.push(ScannedFile {
                    path: path.to_string_lossy().to_string(),
                    file_name: entry.file_name().to_string_lossy().to_string(),
                });
            }
        }
    }
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

/// Only the status, as the card's "Want to knit" sets it.
#[tauri::command]
pub fn set_pattern_status(state: State<'_, AppState>, id: String, status: String) -> CmdResult<Pattern> {
    db::set_pattern_status(&state.db(), &id, &status)
}

/// The patterns that look like copies of one another, grouped.
#[tauri::command]
pub fn find_duplicate_patterns(state: State<'_, AppState>) -> CmdResult<Vec<crate::models::DuplicateGroup>> {
    let groups = db::duplicate_groups(&state.db())?;
    Ok(groups
        .into_iter()
        .map(|(exact, entries)| {
            let entries: Vec<crate::models::DuplicateEntry> = entries
                .into_iter()
                .map(|(pattern, projects, marks, rows, path)| crate::models::DuplicateEntry {
                    file_size: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
                    pattern,
                    projects,
                    marks,
                    rows,
                })
                .collect();
            let keep = suggested_keep(&entries);
            crate::models::DuplicateGroup { exact, keep, patterns: entries }
        })
        .collect())
}

/// The copy to keep: the one with the most attached to it -- projects, then
/// highlights and pins, then rows counted, then the one read last, then the
/// first added.
fn suggested_keep(entries: &[crate::models::DuplicateEntry]) -> String {
    entries
        .iter()
        .enumerate()
        .max_by_key(|(i, e)| {
            (
                e.projects,
                e.marks,
                e.rows,
                !e.pattern.notes.trim().is_empty(),
                e.pattern.last_opened_at.unwrap_or(0),
                std::cmp::Reverse(*i),
            )
        })
        .map(|(_, e)| e.pattern.id.clone())
        .unwrap_or_default()
}

/// Keeps one pattern and removes its copies, folding what can be folded into
/// the one kept first (see db::merge_patterns).
#[tauri::command]
pub fn merge_duplicate_patterns(state: State<'_, AppState>, keep: String, remove: Vec<String>) -> CmdResult<Pattern> {
    let remove: Vec<String> = remove.into_iter().filter(|id| id != &keep).collect();
    let kept = db::merge_patterns(&state.db(), &keep, &remove)?;
    for id in &remove {
        delete_pattern_from(&state, id)?;
    }
    Ok(kept)
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
    // The file goes unless another pattern still reads from it.
    if let Some(file) = file {
        let shared: bool = state
            .db()
            .query_row("SELECT EXISTS(SELECT 1 FROM patterns WHERE file_path = ?1)", rusqlite::params![file], |r| r.get(0))
            .unwrap_or(true);
        if !shared {
            remove(PathBuf::from(file));
        }
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

/// Gives a counter its own key (a physical key code), or clears it with "".
#[tauri::command]
pub fn set_counter_key(state: State<'_, AppState>, id: String, hotkey: String) -> CmdResult<()> {
    db::set_counter_key(&state.db(), &id, hotkey.trim())
}

/// The two counting keys, shared by every pattern.
#[tauri::command]
pub fn get_count_keys(state: State<'_, AppState>) -> CmdResult<CountKeys> {
    db::get_setting(&state.db(), "count_keys")
}

#[tauri::command]
pub fn save_count_keys(state: State<'_, AppState>, keys: CountKeys) -> CmdResult<CountKeys> {
    if !valid_count_keys(&keys) {
        return Err(AppError::Message("Count up and count down need two different keys.".into()));
    }
    db::set_setting(&state.db(), "count_keys", &keys)?;
    Ok(keys)
}

/// How needle and hook sizes are shown: metric, US, or both.
#[tauri::command]
pub fn get_needle_size_display(state: State<'_, AppState>) -> CmdResult<NeedleSizeDisplay> {
    db::get_setting(&state.db(), "needle_size_display")
}

#[tauri::command]
pub fn save_needle_size_display(
    state: State<'_, AppState>,
    display: NeedleSizeDisplay,
) -> CmdResult<NeedleSizeDisplay> {
    db::set_setting(&state.db(), "needle_size_display", &display)?;
    Ok(display)
}

/// Both keys are needed and must differ: a key that counted up and down at
/// once would do nothing, and an empty one could never be pressed.
fn valid_count_keys(keys: &CountKeys) -> bool {
    !keys.up.trim().is_empty() && !keys.down.trim().is_empty() && keys.up != keys.down
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

// ---------- yarn stash ----------

#[tauri::command]
pub fn list_yarns(state: State<'_, AppState>, filter: db::YarnFilter) -> CmdResult<Vec<Yarn>> {
    db::list_yarns(&state.db(), &filter)
}

#[tauri::command]
pub fn get_yarn(state: State<'_, AppState>, id: String) -> CmdResult<Yarn> {
    db::get_yarn(&state.db(), &id)
}

#[tauri::command]
pub fn add_yarn(state: State<'_, AppState>, input: YarnInput) -> CmdResult<Yarn> {
    let id = uuid::Uuid::new_v4().to_string();
    db::insert_yarn(&state.db(), &id, &input)
}

#[tauri::command]
pub fn update_yarn(state: State<'_, AppState>, yarn: Yarn) -> CmdResult<Yarn> {
    db::update_yarn(&state.db(), &yarn)
}

#[tauri::command]
pub fn delete_yarn(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    delete_yarn_from(&state, &id)
}

/// Deletes a yarn and the photo the library kept for it. The lots go with the
/// row via ON DELETE CASCADE; the photo file is removed best effort, like the
/// pattern delete: a file already gone is not a reason to fail.
fn delete_yarn_from(state: &AppState, id: &str) -> CmdResult<()> {
    let photo = db::get_yarn_photo(&state.db(), id).unwrap_or_default();

    db::delete_yarn(&state.db(), id)?;

    if !photo.is_empty() {
        let path = state
            .library_dir
            .join("yarn-photos")
            .join(crate::covers::safe_name(&photo));
        // Guard against a malformed path escaping the library folder.
        if path.starts_with(&state.library_dir) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn yarn_facets(state: State<'_, AppState>) -> CmdResult<Vec<db::YarnFamilyFacet>> {
    db::yarn_facets(&state.db())
}

/// A yarn used up, into the stash's history; or with `used` false, back in the stash.
#[tauri::command]
pub fn set_yarn_used_up(state: State<'_, AppState>, id: String, used: bool) -> CmdResult<crate::models::Yarn> {
    let at = used.then(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0));
    db::set_yarn_used_up(&state.db(), &id, at)
}

/// Every use of yarn recorded, for the stash's monthly figures.
#[tauri::command]
pub fn list_yarn_usage(state: State<'_, AppState>) -> CmdResult<Vec<crate::models::YarnUse>> {
    db::list_yarn_usage(&state.db())
}

/// Stores image bytes as a yarn's photo.
#[tauri::command]
pub fn set_yarn_photo(
    state: State<'_, AppState>,
    yarn_id: String,
    bytes: Vec<u8>,
) -> CmdResult<PhotoInfo> {
    crate::covers::set_yarn_photo(&state, &yarn_id, bytes)
}

/// The photo's bytes, as a raw IPC payload like `get_cover`: a JSON array of
/// numbers costs roughly three characters per byte, which shows on a photo.
#[tauri::command]
pub fn get_yarn_photo(
    state: State<'_, AppState>,
    yarn_id: String,
) -> CmdResult<tauri::ipc::Response> {
    let (_mime, bytes) = crate::covers::read_yarn_photo(&state, &yarn_id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn remove_yarn_photo(state: State<'_, AppState>, yarn_id: String) -> CmdResult<()> {
    crate::covers::remove_yarn_photo(&state, &yarn_id)
}

// ---------- AI metadata ----------

const AI_SETTINGS_KEY: &str = "ai";

/// Reads the AI settings and unlocks the API key for use.
///
/// The key never leaves the backend in plaintext: only a boolean is handed to
/// the frontend, and only the provider calls get the real value.
fn unlocked_ai_settings(state: &AppState) -> CmdResult<AiSettings> {
    let mut settings = stored_ai_settings(&state.db())?;
    if !settings.api_key.is_empty() && crate::ai::secret::is_encrypted(&settings.api_key) {
        settings.api_key = crate::ai::secret::decrypt(&settings.api_key)
            .map_err(AppError::Message)?;
    }
    Ok(settings)
}

/// The AI settings as stored. Settings saved before the on/off switch existed
/// were saved by someone setting the model up, so those count as on; anyone
/// who never opened them starts with it off.
pub(crate) fn stored_ai_settings(conn: &rusqlite::Connection) -> CmdResult<AiSettings> {
    let raw: serde_json::Value = db::get_setting(conn, AI_SETTINGS_KEY)?;
    let mut settings: AiSettings = serde_json::from_value(raw.clone()).unwrap_or_default();
    if raw.is_object() && raw.get("enabled").is_none() {
        settings.enabled = true;
    }
    Ok(settings)
}

/// Returns the AI settings with the API key replaced by a boolean, so the
/// plaintext key never crosses into the webview.
#[tauri::command]
pub fn get_ai_settings(state: State<'_, AppState>) -> CmdResult<AiSettingsView> {
    let settings = stored_ai_settings(&state.db())?;
    Ok(AiSettingsView::from_settings(settings))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    #[serde(default)]
    pub enabled: bool,
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
            enabled: s.enabled,
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
            enabled: self.enabled,
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
    let mut stored = stored_ai_settings(&conn)?;

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
    // Switched off means nothing is sent, whatever asks.
    if !settings.enabled {
        return Err(AppError::Message("Describing with a model is switched off in Settings.".to_string()));
    }
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

    #[test]
    fn the_model_switch_is_off_unless_the_model_was_set_up_before_it() {
        let conn = crate::db::open_test_db();
        assert!(!stored_ai_settings(&conn).unwrap().enabled, "never set up: off");
        db::set_setting(&conn, AI_SETTINGS_KEY, &serde_json::json!({ "baseUrl": "http://localhost:1234/v1" })).unwrap();
        let saved = stored_ai_settings(&conn).unwrap();
        assert!(saved.enabled, "set up before the switch existed: on");
        assert_eq!(saved.base_url, "http://localhost:1234/v1");
        db::set_setting(&conn, AI_SETTINGS_KEY, &AiSettings { enabled: false, ..saved }).unwrap();
        assert!(!stored_ai_settings(&conn).unwrap().enabled, "switched off: stays off");
    }

    #[test]
    fn count_keys_default_to_j_and_k_and_must_differ() {
        let conn = db::open_test_db();
        let keys: CountKeys = db::get_setting(&conn, "count_keys").unwrap();
        assert_eq!((keys.up.as_str(), keys.down.as_str()), ("KeyJ", "KeyK"));
        assert!(valid_count_keys(&CountKeys { up: "Space".into(), down: "Backspace".into() }));
        assert!(!valid_count_keys(&CountKeys { up: "KeyJ".into(), down: "KeyJ".into() }));
        assert!(!valid_count_keys(&CountKeys { up: " ".into(), down: "KeyK".into() }));
    }

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
        db::insert_pattern(conn, &id, &input, &format!("C:/lib/{id}.pdf"), "pdf", "").unwrap()
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
            db::insert_pattern(&conn, &id, &input, &document.to_string_lossy(), "pdf", "").unwrap();

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

    /// A pattern as add_pattern receives it: bytes in hand, as drag and drop
    /// delivers them.
    fn dropped(title: &str, file_name: &str, bytes: &[u8]) -> PatternInput {
        PatternInput {
            title: title.to_string(),
            designer: String::new(),
            file_name: file_name.to_string(),
            bytes: Some(bytes.to_vec()),
            source_path: None,
            status: "want-to-knit".to_string(),
            difficulty: String::new(),
            needle_size: String::new(),
            yarn_weight: String::new(),
            tags: vec![],
            notes: String::new(),
        }
    }

    #[test]
    fn adding_the_same_file_twice_is_refused_with_the_existing_title() {
        let (state, dir) = state_in_temp_library();

        let first = add_pattern_to(&state, dropped("First Socks", "one.pdf", b"same bytes")).unwrap();

        // The same contents under a different file name are the same pattern.
        let err = add_pattern_to(&state, dropped("Second Copy", "two.pdf", b"same bytes"))
            .unwrap_err();
        assert!(matches!(err, AppError::AlreadyHave(_)), "got {err}");
        // The frontend prefix-matches on this exact wording to offer opening
        // the pattern that is already there.
        assert!(
            err.to_string()
                .starts_with("already in the library as \"First Socks\""),
            "got {err}"
        );

        // A different file that happens to share a name is not a duplicate.
        let other = add_pattern_to(&state, dropped("Renamed", "one.pdf", b"new bytes")).unwrap();
        assert_ne!(other.id, first.id);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_duplicate_is_spotted_across_the_two_add_flows() {
        let (state, dir) = state_in_temp_library();

        // Added from a path on disk, the way the native dialog hands one over.
        let source = dir.join("downloads").join("Socks.pdf");
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::write(&source, b"shared contents").unwrap();
        let via_path = add_pattern_to(
            &state,
            PatternInput {
                source_path: Some(source.to_string_lossy().to_string()),
                ..dropped("Path Socks", "ignored.pdf", b"")
            },
        )
        .unwrap();
        // The name comes from the file on disk, and the original is copied,
        // never moved.
        assert_eq!(via_path.file_name, "Socks.pdf");
        assert!(source.exists(), "the user's file must not be moved");

        // The same contents dropped in as bytes are recognised as the same
        // pattern, whichever way they arrived the first time.
        let err = add_pattern_to(&state, dropped("Dropped Copy", "dropped.pdf", b"shared contents"))
            .unwrap_err();
        assert!(matches!(err, AppError::AlreadyHave(_)), "got {err}");
        assert!(
            err.to_string()
                .starts_with("already in the library as \"Path Socks\""),
            "got {err}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scanning_a_folder_finds_patterns_recursively_and_sorted() {
        let dir = std::env::temp_dir().join(format!("shiny-scan-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("nested").join("deeper")).unwrap();
        for (rel, contents) in [
            ("b-sock.pdf", "pdf"),
            // Extensions match case-insensitively.
            ("A-Cardigan.PDF", "pdf"),
            ("c-shawl.epub", "epub"),
            ("notes.txt", "text"),
            ("no-extension", "text"),
            ("nested/d-hat.EPUB", "epub"),
            ("nested/deeper/e-cowl.pdf", "pdf"),
            ("nested/skip.md", "text"),
        ] {
            std::fs::write(dir.join(rel), contents).unwrap();
        }

        let found = scan_pattern_folder(dir.to_string_lossy().to_string()).unwrap();

        // Sorted by full path, the order the picker shows them in.
        let paths: Vec<&str> = found.iter().map(|f| f.path.as_str()).collect();
        let mut sorted = paths.clone();
        sorted.sort_unstable();
        assert_eq!(paths, sorted);

        // Every pdf and epub, nested ones included; nothing else.
        let names: Vec<&str> = found.iter().map(|f| f.file_name.as_str()).collect();
        assert_eq!(names.len(), 5, "got {names:?}");
        for expected in ["b-sock.pdf", "A-Cardigan.PDF", "c-shawl.epub", "d-hat.EPUB", "e-cowl.pdf"]
        {
            assert!(names.contains(&expected), "missing {expected} in {names:?}");
        }
        assert!(!names.contains(&"notes.txt"));
        assert!(!names.contains(&"no-extension"));
        assert!(!names.contains(&"skip.md"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scanning_a_missing_folder_is_an_error() {
        let missing = std::env::temp_dir().join(format!("shiny-scan-{}", uuid::Uuid::new_v4()));
        let err = scan_pattern_folder(missing.to_string_lossy().to_string()).unwrap_err();
        assert!(matches!(err, AppError::Message(_)), "got {err}");
    }

    #[test]
    fn a_scanned_file_serialises_camel_case() {
        // The frontend reads `fileName`; a snake_case leak would show blank.
        let json = serde_json::to_value(ScannedFile {
            path: "p".to_string(),
            file_name: "f".to_string(),
        })
        .unwrap();
        assert_eq!(json["fileName"], "f");
        assert!(json.get("file_name").is_none());
    }

    /// A yarn on the test database, with one lot.
    fn test_yarn(conn: &rusqlite::Connection, name: &str) -> Yarn {
        let input = YarnInput {
            name: name.to_string(),
            yarn_weight: "dk".to_string(),
            grams_per_ball: 100,
            lots: vec![crate::models::YarnLotInput {
                dye_lot: "A1".to_string(),
                balls: 2.0,
                grams_left: 150,
                ..crate::models::YarnLotInput::default()
            }],
            ..YarnInput::default()
        };
        let id = uuid::Uuid::new_v4().to_string();
        db::insert_yarn(conn, &id, &input).unwrap()
    }

    #[test]
    fn deleting_a_yarn_removes_its_lots_and_photo() {
        let (state, dir) = state_in_temp_library();

        let id = {
            let conn = state.db();
            let yarn = test_yarn(&conn, "Doomed");
            let photos = dir.join("yarn-photos");
            std::fs::create_dir_all(&photos).unwrap();
            std::fs::write(photos.join(format!("{}.jpg", yarn.id)), b"jpg").unwrap();
            db::set_yarn_photo(&conn, &yarn.id, &format!("{}.jpg", yarn.id)).unwrap();
            yarn.id
        };

        delete_yarn_from(&state, &id).unwrap();

        assert!(
            !dir.join("yarn-photos").join(format!("{id}.jpg")).exists(),
            "the photo leaked"
        );
        assert!(db::get_yarn(&state.db(), &id).is_err());
        assert!(db::list_yarn_lots(&state.db(), &id).unwrap().is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_yarn_photo_round_trips_and_rejects_non_images() {
        let (state, dir) = state_in_temp_library();
        let yarn = test_yarn(&state.db(), "Photogenic");

        // Real magic bytes: the name means nothing, the content everything.
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
        let info = crate::covers::set_yarn_photo(&state, &yarn.id, png.to_vec()).unwrap();
        assert_eq!(info.yarn_id, yarn.id);
        assert_eq!(info.file_name, format!("{}.png", yarn.id));
        assert_eq!(info.mime, "image/png");
        assert_eq!(info.bytes, png);

        let (mime, bytes) = crate::covers::read_yarn_photo(&state, &yarn.id).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, png);

        // A PDF is not a photo, and a rejected replacement leaves the old one.
        let err = crate::covers::set_yarn_photo(&state, &yarn.id, b"%PDF-1.4".to_vec())
            .unwrap_err();
        assert!(matches!(err, AppError::Message(_)), "got {err}");
        let (_, bytes) = crate::covers::read_yarn_photo(&state, &yarn.id).unwrap();
        assert_eq!(bytes, png);

        crate::covers::remove_yarn_photo(&state, &yarn.id).unwrap();
        assert!(!dir.join("yarn-photos").join(&info.file_name).exists());
        assert!(crate::covers::read_yarn_photo(&state, &yarn.id).is_err());
        assert_eq!(db::get_yarn(&state.db(), &yarn.id).unwrap().photo_path, "");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_yarn_serialises_camel_case() {
        // The frontend reads yarnWeightFamily, gramsLeft and friends; a
        // snake_case leak would show blanks all over the stash.
        let conn = db::open_test_db();
        let yarn = test_yarn(&conn, "Case Check");
        let json = serde_json::to_value(&yarn).unwrap();
        for key in [
            "yarnWeight",
            "yarnWeightFamily",
            "metresPerBall",
            "gramsPerBall",
            "photoPath",
            "addedAt",
            "gramsLeft",
            "ballsTotal",
            "metresLeft",
        ] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
        assert!(json.get("yarn_weight_family").is_none());
        assert!(json.get("grams_left").is_none());

        let lot = &json["lots"][0];
        for key in ["yarnId", "dyeLot", "gramsLeft", "boughtAt"] {
            assert!(lot.get(key).is_some(), "missing lot.{key}");
        }
        assert!(lot.get("yarn_id").is_none());
    }
}
