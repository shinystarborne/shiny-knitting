use serde::{Deserialize, Serialize};

/// Everything that can go wrong in a command. Serialized to the frontend as a
/// plain string so the UI can show it without unwrapping nested shapes.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),

    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("file error: {0}")]
    Io(#[from] std::io::Error),

    #[error("could not determine the file type for {0}")]
    UnknownFormat(String),

    #[error("pattern not found: {0}")]
    NotFound(String),

    /// Settings and undo snapshots are stored as JSON, so serialising them can
    /// fail. Only reachable if a stored value stops being serialisable, which
    /// for the types in use here should not happen -- but a command must still
    /// return something rather than unwinding.
    #[error("could not encode stored data: {0}")]
    Encode(#[from] serde_json::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Where a pattern sits in your knitting life. Kept as a plain string so you
/// can add your own values later without a schema migration.
///
/// These mirror the lists in `src/api.ts`; the frontend owns the UI wording and
/// the backend uses these to reject unknown values.
pub const STATUSES: &[&str] = &["want-to-knit", "in-progress", "finished", "abandoned"];

/// Accepted difficulty levels, in increasing order of challenge.
pub const DIFFICULTIES: &[&str] = &["beginner", "easy", "intermediate", "advanced"];

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    pub id: String,
    pub title: String,
    pub designer: String,
    /// Absolute path of the file inside the app's own library folder.
    pub file_path: String,
    /// Original filename, kept for display and for export.
    pub file_name: String,
    /// "pdf" or "epub".
    pub format: String,
    pub status: String,
    pub difficulty: String,
    /// Free text needle size, e.g. "4mm" or "US 6". Kept as text because
    /// needle sizing differs by region and users mix systems.
    pub needle_size: String,
    /// Yarn weight as the pattern states it, e.g. "DK", "4-ply worsted", or
    /// "100 m/100g". Free text, because that is how patterns write it.
    pub yarn_weight: String,
    /// The standard weight family `yarn_weight` falls into, derived on write
    /// by `yarn::family_of`. Filtered on, so it is a fixed vocabulary rather
    /// than text; empty when the weight is blank or unrecognised.
    pub yarn_weight_family: String,
    pub tags: Vec<String>,
    pub notes: String,
    pub added_at: i64,
    pub last_opened_at: Option<i64>,
    /// Read-progress snapshot, so reopening a pattern lands where you left off.
    pub last_page: i64,
    pub last_scroll: f64,
    /// Cover image file inside `library/covers`, or empty when there is none.
    pub cover_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PatternInput {
    pub title: String,
    pub designer: String,
    /// Name shown in the library. When `source_path` is set this is ignored and
    /// the name is taken from the file on disk.
    pub file_name: String,
    /// The file's contents, for files handed over by drag and drop or the
    /// webview's own file picker.
    ///
    /// Serialising these over IPC costs roughly three characters per byte and
    /// has to be done on both sides, so a large pattern took many seconds to
    /// add. Prefer `source_path` wherever a path is available.
    #[serde(default)]
    pub bytes: Option<Vec<u8>>,
    /// A path on disk to copy from, which the native file dialog returns. No
    /// bytes cross the IPC boundary at all on this path.
    #[serde(default)]
    pub source_path: Option<String>,
    pub status: String,
    pub difficulty: String,
    pub needle_size: String,
    /// Yarn weight as stated, e.g. "DK" or "100 m/100g". The standard family
    /// is derived from this on write, so there is only one thing to enter.
    #[serde(default)]
    pub yarn_weight: String,
    pub tags: Vec<String>,
    pub notes: String,
}

/// A named place in a pattern that is counted separately from the project as a
/// whole: a front, a sleeve worked in turn, a collar, or a 12-row lace repeat.
/// Each keeps its own current count and target, and can be switched on
/// independently of the others.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Counter {
    pub id: String,
    pub pattern_id: String,
    pub name: String,
    pub target: i64,
    pub current: i64,
    /// When true this counter advances along with the project total on any
    /// counting action. Several can be on at once, so working two sleeves
    /// alternately advances both from the same rows.
    pub enabled: bool,
    /// When true the project total is left alone, for a count that is not part
    /// of the project's rows -- a setup row, or a separate note.
    pub excluded_from_total: bool,
    pub position: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CounterInput {
    pub name: String,
    pub target: i64,
    pub enabled: bool,
    pub excluded_from_total: bool,
}

/// The row counter state for one project.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub pattern_id: String,
    /// Running total of rows completed across the whole project. Always moves
    /// on a counting action; it is the one figure that is never switched off.
    pub total_rows: i64,
    pub updated_at: i64,
}

/// Settings for the moving highlight line, stored per pattern so a wide chart
/// and a text page can each keep their own geometry.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HighlightSettings {
    pub pattern_id: String,
    pub enabled: bool,
    /// Distance from the top of the viewport, in px, that the line rests at.
    pub offset_y: f64,
    /// Line thickness in px.
    pub thickness: f64,
    /// Line length in px. 0 means "span the full reading column".
    pub width: f64,
    /// Horizontal inset in px when width is 0.
    pub inset_x: f64,
    pub color: String,
    pub opacity: f64,
    /// Animate the scroll when the line moves.
    pub animate: bool,
    pub animation_ms: i64,
}

impl HighlightSettings {
    pub fn defaults(pattern_id: &str) -> Self {
        Self {
            pattern_id: pattern_id.to_string(),
            enabled: true,
            offset_y: 0.35,
            thickness: 3.0,
            width: 0.0,
            inset_x: 24.0,
            color: "#e5484d".to_string(),
            opacity: 0.3,
            animate: true,
            animation_ms: 260,
        }
    }
}

// ---------- covers ----------

/// A cover image belonging to a pattern. Bytes are stored under
/// `library/covers/<pattern id>.<ext>`, so the file is ours to manage and is
/// deleted along with the pattern.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CoverImage {
    pub pattern_id: String,
    /// File name inside the covers folder, not a full path.
    pub file_name: String,
    pub bytes: Vec<u8>,
    pub mime: String,
}

// ---------- annotations, bookmarks, pins ----------

/// What a mark on a page represents.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationKind {
    /// Coloured highlight over selected text.
    Highlight,
    /// A written note attached to a spot or a piece of text.
    Note,
    /// Freehand strokes drawn over the page.
    Draw,
}

impl AnnotationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AnnotationKind::Highlight => "highlight",
            AnnotationKind::Note => "note",
            AnnotationKind::Draw => "draw",
        }
    }

    /// An unrecognised kind is treated as a highlight rather than rejected, so
    /// a row written by a future version cannot make a pattern unreadable.
    pub fn parse(value: &str) -> Self {
        match value {
            "note" => AnnotationKind::Note,
            "draw" => AnnotationKind::Draw,
            _ => AnnotationKind::Highlight,
        }
    }
}

/// A highlight, a note, or a drawing.
///
/// Geometry travels as JSON rather than a typed shape: a highlight is a list
/// of rectangles, a note is a single point, and a drawing is a list of stroke
/// points. The frontend owns that interpretation, and a shape union here would
/// only have to be unpacked again on the way back out.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub pattern_id: String,
    pub kind: String,
    /// 1-based page for a PDF, chapter index for an EPUB.
    pub page: i64,
    /// Rectangles for a highlight, a single point for a note, or a point list
    /// of strokes for a drawing. Stored as JSON.
    pub geometry: String,
    /// The text this was made from. On an EPUB this is what re-finds the
    /// passage after the text reflows.
    pub quote: String,
    pub occurrence: i64,
    pub color: String,
    /// Note body, empty for the other kinds.
    pub text: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationInput {
    pub kind: String,
    pub page: i64,
    pub geometry: String,
    pub quote: String,
    #[serde(default)]
    pub occurrence: i64,
    pub color: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub pattern_id: String,
    pub page: i64,
    pub title: String,
    pub sort_order: i64,
    pub created_at: i64,
}

/// A floating copy of a piece of the pattern.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub id: String,
    pub pattern_id: String,
    pub page: i64,
    /// What was pinned, in normalised page coordinates.
    pub geometry: String,
    pub quote: String,
    pub title: String,
    /// Position and size of the floating card, as a fraction of the pane.
    pub offset_x: f64,
    pub offset_y: f64,
    pub width: f64,
    pub hidden: bool,
    pub z: i64,
    /// File name of the cropped image inside `library/pins`.
    pub image_file: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PinInput {
    pub page: i64,
    pub geometry: String,
    pub quote: String,
    pub title: String,
    /// The cropped area, as image bytes. Stored as a file rather than a blob
    /// so a long library does not bloat the database.
    pub image_bytes: Vec<u8>,
    pub image_mime: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PinPlacement {
    pub offset_x: f64,
    pub offset_y: f64,
    pub width: f64,
    pub hidden: bool,
}

/// How many pins a pattern may have at once.
pub const MAX_PINS: usize = 5;

/// A page or chapter chosen for export.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub pattern_id: String,
    /// 1-based pages for a PDF, chapter indices for an EPUB. Order is kept and
    /// duplicates are removed, so "1,1,2" exports as pages 1 and 2.
    pub pages: Vec<i64>,
    /// Roughly 150 is fine on screen and keeps the file small enough to email.
    #[serde(default = "default_export_dpi")]
    pub dpi: i64,
    /// Where to write it. An empty name means one is generated beside the
    /// library.
    #[serde(default)]
    pub file_name: String,
}

fn default_export_dpi() -> i64 {
    150
}

// ---------- AI metadata ----------
/// Everything about how the AI feature behaves. Stored as one JSON blob so
/// adding a setting does not need a schema change.
///
/// There is deliberately no "provider" choice. Every server worth using —
/// a self-hosted model on the same network, Ollama, LM Studio, vLLM,
/// OpenRouter — serves the same OpenAI-compatible API, so the only things
/// that vary are the address and whether a key is required.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    /// Where the model server is, e.g. `http://192.168.1.20:1234/v1`. The `/v1`
    /// is optional; it is added for you if you leave it off.
    pub base_url: String,
    pub model: String,
    /// Used when the model field is left blank.
    pub fallback_model: String,
    /// Optional. Local servers usually need none. Stored encrypted with
    /// Windows DPAPI; never a plain key. See `ai/secret.rs`.
    pub api_key: String,
    /// Write results without asking. The results stay reviewable afterwards.
    pub apply_automatically: bool,
    /// Only fill in fields that are currently empty, leaving anything the
    /// user has already set alone.
    pub skip_existing: bool,
    /// How much of the pattern to send, in characters. A short excerpt is
    /// enough to find gauge, size, and materials.
    pub max_characters: i64,
    /// Reasoning effort for models that have it: "low", "medium", "high", or
    /// empty to leave the model's own default alone. Lower is faster and
    /// cheaper, and this task does not need much.
    pub reasoning_effort: String,
    /// Whether a scan should include patterns that already have metadata.
    pub rescan_existing: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            base_url: "https://gen2.zeroval.eu/v1".to_string(),
            model: "Qwen3.6-27B".to_string(),
            fallback_model: "Qwen3.6-27B".to_string(),
            api_key: String::new(),
            apply_automatically: true,
            skip_existing: true,
            max_characters: 4000,
            reasoning_effort: "low".to_string(),
            rescan_existing: false,
        }
    }
}

/// The fields the AI is asked to fill in.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub designer: String,
    pub difficulty: String,
    pub needle_size: String,
    /// The yarn weight, e.g. "DK", "4-ply worsted", or "100 m/100g". Kept
    /// separate from `yarn` because the weight is filterable and the brand is
    /// not.
    pub yarn_weight: String,
    pub yarn: String,
    pub tags: Vec<String>,
    /// One or two sentences on what the pattern is, for the notes field.
    pub summary: String,
}

/// A suggestion plus what it would change, so the UI can show the difference
/// and offer an undo.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionResult {
    pub pattern_id: String,
    pub pattern_title: String,
    /// True when the model could not produce anything usable.
    pub failed: bool,
    /// Why it failed, for display. Empty on success.
    pub error: String,
    pub suggestion: Suggestion,
    /// The pattern as it stands now, so the UI can show "before".
    pub before: Pattern,
    /// A preview of what the pattern will look like once applied.
    pub after: Pattern,
    /// Which fields this suggestion would actually change.
    pub changed_fields: Vec<String>,
    /// True when the result was written to the database.
    pub applied: bool,
}
