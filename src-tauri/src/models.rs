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

    /// The same file is already in the library; carries its title. The
    /// frontend prefix-matches on "already in the library as" to offer opening
    /// the existing pattern instead.
    #[error("already in the library as \"{0}\"")]
    AlreadyHave(String),

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
/// the backend uses these to reject unknown values. A pattern can also have no
/// status at all, stored as an empty string, which is what a new one starts
/// with: "want to knit" is a choice, not something every pattern is.
pub const STATUSES: &[&str] = &["want-to-knit", "in-progress", "finished", "abandoned"];

/// A status as stored: a known one, or none.
/// Where a project is: being knitted, put aside for now, done, or unravelled.
pub const PROJECT_STATUSES: &[&str] = &["planned", "active", "paused", "finished", "frogged"];

/// A project that still has its needles and yarn: being knitted, or paused.
pub fn is_live(status: &str) -> bool {
    status == "active" || status == "paused"
}

pub fn tidy_status(status: &str) -> &str {
    if STATUSES.contains(&status) { status } else { "" }
}

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
    /// Free text needle size, e.g. "4mm" or "US 6". Kept as written because
    /// needle sizing differs by region and users mix systems. The canonical
    /// mm sizes derived from it by `needle_size::sizes_of` live in the
    /// `needle_sizes` column, which is what filtering and the sidebar use.
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

/// A pattern file found on disk by `scan_pattern_folder`, offered for adding
/// to the library.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    /// Full path on disk, so it can be handed straight to `add_pattern`.
    pub path: String,
    /// Just the file's own name, for display in the picker.
    pub file_name: String,
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
    /// The key that counts this counter on its own, as a physical key code
    /// (`KeyF`, `Digit2`, `Space`), or empty for none. A code rather than the
    /// character it types, so Shift+key still matches it and the key stays
    /// put on any keyboard layout.
    pub hotkey: String,
}

/// The two counting keys: count a row up, and back down. Physical key codes,
/// like a counter's hotkey.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct CountKeys {
    pub up: String,
    pub down: String,
}

impl Default for CountKeys {
    fn default() -> Self {
        // J and K, which is what counting was before the keys could be chosen.
        Self { up: "KeyJ".into(), down: "KeyK".into() }
    }
}

/// How needle and hook sizes are shown: in millimetres, as the US number, or
/// both. Sizes are stored as canonical mm keys (see `needle_size.rs`), so
/// this decides display only and never what is stored or filtered.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NeedleSizeDisplay {
    Metric,
    Us,
    Both,
}

impl Default for NeedleSizeDisplay {
    fn default() -> Self {
        // Both, until chosen: showing only one system would misread a pattern
        // that states only the other.
        Self::Both
    }
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
            // Off until wanted: see the highlight_off_by_default migration.
            enabled: false,
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

// ---------- yarn stash ----------

/// One purchase of a yarn: a dye lot with the number of balls bought and what
/// is left of them. Partial balls are tracked as grams left, weighed.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YarnLot {
    pub id: String,
    pub yarn_id: String,
    pub dye_lot: String,
    /// Balls bought; halves and quarters are allowed, hence a float.
    pub balls: f64,
    /// Grams left across the lot, partial balls included.
    pub grams_left: i64,
    pub location: String,
    pub bought_at: Option<i64>,
    /// What is left after a project: set when a finished project records its
    /// leftovers, shown as a Leftover tag in the stash.
    #[serde(default)]
    pub leftover: bool,
}

/// One fibre in a yarn, and its share: 75 for "75% wool". A share of 0 is a
/// fibre whose share is not known.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Fibre {
    pub name: String,
    #[serde(default)]
    pub percent: f64,
}

/// What a yarn is meant for: a pattern from the library, or only a title,
/// for a pattern not got yet. A linked pattern's title is its own, read
/// afresh; it is kept as text too, so a pattern removed later still says.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct YarnPlan {
    #[serde(default)]
    pub pattern_id: Option<String>,
    #[serde(default)]
    pub title: String,
}

/// A yarn in the stash, with its lots and the quantities derived from them.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Yarn {
    pub id: String,
    pub name: String,
    pub brand: String,
    pub colourway: String,
    /// Weight as the ball band states it, e.g. "DK" or "400 m/100g". Free
    /// text, like a pattern's `yarn_weight`.
    pub yarn_weight: String,
    /// The standard family derived from `yarn_weight` on write by
    /// `yarn::family_of`; empty when the weight is blank or unrecognised.
    pub yarn_weight_family: String,
    pub metres_per_ball: i64,
    pub grams_per_ball: i64,
    /// Photo file inside `library/yarn-photos`, or empty when there is none.
    pub photo_path: String,
    pub notes: String,
    /// What it is made of, as the ball band gives it.
    #[serde(default)]
    pub fibres: Vec<Fibre>,
    /// Treated so it can go in the washing machine.
    #[serde(default)]
    pub superwash: bool,
    /// What it is planned for.
    #[serde(default)]
    pub plans: Vec<YarnPlan>,
    /// When it was used up: had, but used, and kept as the stash's history.
    /// None while it is in the stash.
    #[serde(default)]
    pub used_up_at: Option<i64>,
    pub added_at: i64,
    pub lots: Vec<YarnLot>,
    /// Grams left, summed over the lots.
    pub grams_left: i64,
    /// Balls bought, summed over the lots.
    pub balls_total: f64,
    /// What `grams_left` works out to in metres. Zero when either per-ball
    /// figure is missing, since it cannot be known then.
    pub metres_left: i64,
    /// The active projects using this yarn, by name. Empty when it is free.
    #[serde(default)]
    pub projects: Vec<String>,
    /// Every project it was on, finished ones too, by name: what it went into.
    #[serde(default)]
    pub used_in: Vec<String>,
    /// The plans (projects not started) it is meant for, by name.
    #[serde(default)]
    pub planned_in: Vec<String>,
}

/// Yarn used, when it was used: what a finished project took (weighed before
/// and after), or what was left of a yarn marked used up. Kept with the
/// yarn's and project's names, so a removed one still says.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YarnUse {
    pub id: String,
    pub yarn_id: Option<String>,
    pub yarn_name: String,
    pub project_id: Option<String>,
    pub project_name: String,
    pub at: i64,
    pub grams: i64,
    /// What the grams came to by the yarn's ball band then; 0 when it gave no metres per ball.
    pub metres: i64,
    /// "finished" (a project's) or "used-up" (a yarn marked so).
    pub source: String,
}

/// A picture of a yarn's ball band (the paper round the ball), filed by the
/// yarn's brand and name, not its colour: "Drops" / "Air" is every colour of
/// Drops Air. A yarn can have several, a band's front and back.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BallBand {
    pub id: String,
    pub brand: String,
    pub name: String,
    /// The picture's file in library/ball-bands.
    pub photo_path: String,
    pub added_at: i64,
}

/// What the add dialog sends. Everything but the name is optional.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct YarnInput {
    pub name: String,
    #[serde(default)]
    pub brand: String,
    #[serde(default)]
    pub colourway: String,
    #[serde(default)]
    pub yarn_weight: String,
    #[serde(default)]
    pub metres_per_ball: i64,
    #[serde(default)]
    pub grams_per_ball: i64,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub fibres: Vec<Fibre>,
    #[serde(default)]
    pub superwash: bool,
    #[serde(default)]
    pub plans: Vec<YarnPlan>,
    #[serde(default)]
    pub lots: Vec<YarnLotInput>,
}

/// A lot as the dialog sends it. An `id` names an existing lot to keep; a lot
/// without one is new.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct YarnLotInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub dye_lot: String,
    #[serde(default)]
    pub balls: f64,
    #[serde(default)]
    pub grams_left: i64,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub bought_at: Option<i64>,
    #[serde(default)]
    pub leftover: bool,
}

/// A photo belonging to a yarn. Bytes are stored under
/// `library/yarn-photos/<yarn id>.<ext>`, mirroring `CoverImage`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PhotoInfo {
    pub yarn_id: String,
    /// File name inside the yarn-photos folder, not a full path.
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

/// A page shown turned, clockwise in degrees: 90, 180 or 270.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageRotation {
    pub page: i64,
    pub rotation: i64,
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
    /// The file name to write, under the library's exports folder. An empty
    /// name means one is generated from the pattern title and chosen pages.
    #[serde(default)]
    pub file_name: String,
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
    /// Whether describing patterns with a model is switched on at all. Off
    /// unless chosen: with it off, nothing about the model is shown and
    /// nothing is ever sent.
    pub enabled: bool,
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
            enabled: false,
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

// ---------- needles and hooks ----------

/// What a tool is. Kept as one list so the form, the filter and the backend
/// agree on the spelling.
///
/// - `straight`: a pair of straight needles
/// - `circular`: a fixed circular needle, tips and cable in one
/// - `dpn`: a set of double-pointed needles
/// - `tips`: a pair of interchangeable tips
/// - `cable`: an interchangeable cable
/// - `hook`: a crochet hook
pub const TOOL_KINDS: &[&str] = &["straight", "circular", "dpn", "tips", "cable", "hook"];

/// The materials known by name, offered as suggestions and stored by these
/// keys. Any other material can be typed and is kept as typed: there are more
/// needle materials than any list (carbon, casein, glass, rosewood...).
/// "other" is from before materials were free text, and still reads back.
pub const TOOL_MATERIALS: &[&str] = &[
    "metal", "aluminium", "steel", "copper", "bamboo", "wood", "carbon", "plastic", "other",
];

/// The connector size of an interchangeable tip or cable, which is what decides
/// whether a tip fits a cable. Empty is allowed, for a set that has only one.
pub const CABLE_SIZES: &[&str] = &["mini", "small", "standard", "large"];

/// A needle, a set of needles, a cable, or a hook.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub id: String,
    /// One of `TOOL_KINDS`.
    pub kind: String,
    /// Needle or hook size in millimetres. 0 for a cable, which has none.
    pub size_mm: f64,
    /// Length of the needle, tips or hook, in centimetres. 0 when not recorded,
    /// and for a circular needle or a cable, whose length is `cable_cm`.
    pub length_cm: f64,
    /// Length of a circular needle (tip to tip) or of a cable, in centimetres.
    pub cable_cm: f64,
    /// One of `CABLE_SIZES`, or empty. Only interchangeable tips and cables
    /// have one.
    pub cable_size: String,
    pub brand: String,
    /// A key from `TOOL_MATERIALS`, a material as typed, or empty.
    pub material: String,
    /// The active project the tool is on; None when it is free. A tool is in
    /// use exactly while an active project has it.
    #[serde(default)]
    pub project_id: Option<String>,
    /// That project's name, for display; empty when free.
    #[serde(default)]
    pub project_name: String,
    pub notes: String,
    pub added_at: i64,
}

/// A tool as the form sends it, for adding or for replacing one's details.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolInput {
    pub kind: String,
    #[serde(default)]
    pub size_mm: f64,
    #[serde(default)]
    pub length_cm: f64,
    #[serde(default)]
    pub cable_cm: f64,
    #[serde(default)]
    pub cable_size: String,
    #[serde(default)]
    pub brand: String,
    #[serde(default)]
    pub material: String,
    /// The active project to put it on, or None to leave it free.
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub notes: String,
}

// ---------- projects ----------

/// Something being knitted (or crocheted): optionally from a library pattern,
/// with the needles, hooks, cables and yarn it is using.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    /// The library pattern it is made from. Cleared, not deleted, when the
    /// pattern is removed: the project still happened.
    pub pattern_id: Option<String>,
    #[serde(default)]
    pub pattern_title: String,
    /// One of PROJECT_STATUSES. Active and paused ones have their needles and
    /// yarn in use; finished and frogged ones keep a record of what they used.
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub notes: String,
    pub created_at: i64,
    /// The cover's file inside `library/project-covers`, or empty.
    #[serde(default)]
    pub cover_path: String,
    /// Who it is for. Cleared, not deleted, when the person is removed.
    #[serde(default)]
    pub person_id: Option<String>,
    #[serde(default)]
    pub person_name: String,
    /// The tools on it: while active, those in use; once finished, those it used.
    pub tool_ids: Vec<String>,
    pub yarns: Vec<ProjectYarn>,
    /// A plan's time as said ("autumn", "before the baby comes"); empty when none.
    #[serde(default)]
    pub plan_when: String,
    /// A plan's exact date, when there is one.
    #[serde(default)]
    pub plan_date: Option<i64>,
    /// Where a plan is in the list of plans, dragged into order.
    #[serde(default)]
    pub plan_order: f64,
}

/// One yarn on a project, and, once finished, how much of it was left.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectYarn {
    pub id: String,
    pub yarn_id: String,
    pub yarn_name: String,
    /// The lot it is from, when the yarn has more than one.
    pub lot_id: Option<String>,
    #[serde(default)]
    pub dye_lot: String,
    /// Grams left when the project finished; None while active, or when the
    /// leftover was not recorded.
    pub leftover_grams: Option<i64>,
    /// Grams the project is expected to take; None when not said.
    #[serde(default)]
    pub planned_grams: Option<i64>,
}

/// A yarn as the project dialog sends it: an `id` keeps an existing entry.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectYarnInput {
    #[serde(default)]
    pub id: Option<String>,
    pub yarn_id: String,
    #[serde(default)]
    pub lot_id: Option<String>,
    /// Grams the project is expected to take; None (or 0) for not said.
    #[serde(default)]
    pub planned_grams: Option<i64>,
}

/// A project as the dialog sends it. The tools and yarns are the whole set
/// wanted on it; the backend adds and removes to match.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub pattern_id: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub started_at: Option<i64>,
    /// Kept only once the project is finished: an active one has no end yet.
    #[serde(default)]
    pub finished_at: Option<i64>,
    #[serde(default)]
    pub tool_ids: Vec<String>,
    #[serde(default)]
    pub yarns: Vec<ProjectYarnInput>,
    /// Made as a plan: not started, its yarn only meant for it.
    #[serde(default)]
    pub planned: bool,
    #[serde(default)]
    pub plan_when: String,
    #[serde(default)]
    pub plan_date: Option<i64>,
}

/// How much of one of a project's yarns is left, given when finishing it.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct YarnLeftover {
    pub entry_id: String,
    /// Grams left; 0 for used up. None leaves the stash as it was.
    #[serde(default)]
    pub grams: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FinishInput {
    #[serde(default)]
    pub finished_at: Option<i64>,
    #[serde(default)]
    pub leftovers: Vec<YarnLeftover>,
}

// ---------- boards ----------

/// What can go on a board, a project's or an inspiration board.
///
/// - `note`: a sticky note
/// - `text`: words on the board itself
/// - `link`: a web address, opened in the browser
/// - `image`: a picture, stored as a file
/// - `pattern`: a pattern from the library
/// - `yarn`: a yarn from the stash
/// - `tool`: a needle, hook or cable
/// - `swatch`: a colour
pub const BOARD_KINDS: &[&str] = &["note", "text", "link", "image", "pattern", "yarn", "tool", "swatch", "log"];

/// One thing on a board, where it sits, and what it holds.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardItem {
    pub id: String,
    /// The board it is on: a project's id, or an inspiration board's.
    pub board_id: String,
    pub kind: String,
    /// Position and size on the board, in board units (pixels at 100%).
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Stacking: higher is on top.
    pub z: i64,
    /// What it holds, by kind: `{ "text": .. }`, `{ "url": .., "title": .. }`,
    /// `{ "patternId": .. }`, `{ "colour": .., "label": .. }` and so on.
    pub data: serde_json::Value,
    /// Whether an image file is stored for it.
    pub has_image: bool,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoardItemInput {
    pub kind: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// A change to an item: only the fields given are changed.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoardItemPatch {
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub w: Option<f64>,
    #[serde(default)]
    pub h: Option<f64>,
    /// True puts it on top of everything else on the board.
    #[serde(default)]
    pub to_front: bool,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// A board of its own, not tied to a project: somewhere to collect ideas.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InspirationBoard {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    /// When something on it last changed, which is the order the boards are shown in.
    pub updated_at: i64,
    pub item_count: i64,
    /// A few of its pictures, newest first, for the board's card.
    pub pictures: Vec<BoardPicture>,
    /// Its colour swatches, for the card.
    pub colours: Vec<String>,
}

/// A picture a board shows: one of its own (`image`, by item id), a
/// pattern's cover (`pattern`, by pattern id) or a yarn's photo (`yarn`).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardPicture {
    pub kind: String,
    pub id: String,
}

// ---------- shops and the wishlist ----------

/// A shop you buy from: where it is on the web, and what you think of it.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shop {
    pub id: String,
    pub name: String,
    /// Its web address, always http or https; empty for a shop with none.
    pub url: String,
    /// Your own words about it: "Drops is cheapest here", "deadstock".
    pub comment: String,
    /// Your own labels: yarn, needles, deadstock, sale. Kept as typed, without
    /// the same tag twice in another case.
    #[serde(default)]
    pub tags: Vec<String>,
    /// How many things still wanted on the wishlist are to be got here.
    #[serde(default)]
    pub wanted: i64,
    pub added_at: i64,
}

/// A shop as the form sends it.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShopInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// What a wishlist item is:
/// - `yarn`
/// - `tool`: needles, hooks or cables
/// - `pattern`
/// - `other`: notions, books, a swift...
pub const WISH_KINDS: &[&str] = &["yarn", "tool", "pattern", "other"];

/// Something you want to get.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Wish {
    pub id: String,
    /// One of `WISH_KINDS`.
    pub kind: String,
    pub name: String,
    /// The maker, as typed or as the shop's page gives it: "DROPS", "ChiaoGoo".
    #[serde(default)]
    pub brand: String,
    /// How much, as typed: "5 balls", "500 g", "a pair".
    pub amount: String,
    /// The price, as typed, with its currency: "€4.95 a ball".
    pub price: String,
    /// A link to it, http or https; empty when there is none.
    pub url: String,
    /// The shop to get it from. Cleared, not deleted, when the shop goes.
    pub shop_id: Option<String>,
    /// That shop's name and web address, for display; empty without one.
    #[serde(default)]
    pub shop_name: String,
    #[serde(default)]
    pub shop_url: String,
    /// The project it is for. Cleared when the project is removed.
    pub project_id: Option<String>,
    #[serde(default)]
    pub project_name: String,
    pub notes: String,
    /// The file name of its picture in library/wish-photos, or empty.
    #[serde(default)]
    pub photo_path: String,
    /// When it was ticked as got; None while it is still wanted.
    pub got_at: Option<i64>,
    /// When it was added to the stash or to Needles & hooks from here; None
    /// until then.
    #[serde(default)]
    pub stashed_at: Option<i64>,
    pub added_at: i64,
}

/// What a shop's page says about the thing on it, as far as it says: read
/// from the page's product data and its sharing tags. Anything not found is
/// empty.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    /// The address the page ended up at, after any redirects.
    pub url: String,
    pub title: String,
    pub brand: String,
    /// With its currency, e.g. "€4.95".
    pub price: String,
    /// The picture's address, made absolute.
    pub image_url: String,
    pub site_name: String,
    /// What the shop calls itself, for naming a shop from its address; empty
    /// when the page does not say.
    pub shop_name: String,
}

/// A wishlist item as the form sends it.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WishInput {
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub brand: String,
    #[serde(default)]
    pub amount: String,
    #[serde(default)]
    pub price: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub shop_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub notes: String,
}

// ---------- a project's log ----------

/// One entry in a project's log: something typed, or a milestone the app
/// wrote when the project started, paused, finished and so on.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub project_id: String,
    /// When it happened: when it was written, unless changed.
    pub at: i64,
    pub text: String,
    /// Written by the app, not typed.
    pub milestone: bool,
    /// Its photo's file name in library/log-photos, or empty.
    pub photo_path: String,
}

// ---------- gauge swatches ----------

/// A gauge swatch: what it was knitted in and on, and how many stitches and
/// rows it has over 10 cm, before and after blocking.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Swatch {
    pub id: String,
    /// The yarn in the stash it was knitted in; None for yarn not in the stash.
    pub yarn_id: Option<String>,
    /// The yarn as typed, for yarn not in the stash; also what a removed
    /// yarn was called, so its swatches still say.
    pub yarn_text: String,
    /// What to call the yarn: the stash yarn's brand and name, or the text.
    #[serde(default)]
    pub yarn_name: String,
    #[serde(default)]
    pub yarn_colourway: String,
    /// The needle or hook from Needles & hooks; None for a size only.
    pub tool_id: Option<String>,
    /// The needle size in millimetres, 0 when not recorded.
    pub needle_mm: f64,
    /// "Stockinette", "Garter", "Rib 2x2"...
    pub stitch: String,
    /// Stitches and rows over 10 cm, before blocking; 0 when not counted.
    pub sts: f64,
    pub rows: f64,
    /// The same after blocking; 0 when not counted (or not blocked).
    pub sts_blocked: f64,
    pub rows_blocked: f64,
    pub project_id: Option<String>,
    #[serde(default)]
    pub project_name: String,
    /// Its photo's file name in library/swatch-photos, or empty.
    pub photo_path: String,
    pub notes: String,
    /// When it was knitted.
    pub made_at: i64,
    pub added_at: i64,
}

/// A swatch as the form sends it.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SwatchInput {
    #[serde(default)]
    pub yarn_id: Option<String>,
    #[serde(default)]
    pub yarn_text: String,
    #[serde(default)]
    pub tool_id: Option<String>,
    #[serde(default)]
    pub needle_mm: f64,
    #[serde(default)]
    pub stitch: String,
    #[serde(default)]
    pub sts: f64,
    #[serde(default)]
    pub rows: f64,
    #[serde(default)]
    pub sts_blocked: f64,
    #[serde(default)]
    pub rows_blocked: f64,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub notes: String,
    /// None for today.
    #[serde(default)]
    pub made_at: Option<i64>,
}

// ---------- people and their measurements ----------

/// The measurements every person has a row for, by key, in the order shown.
/// Mirrors `MEASUREMENTS` in `src/api.ts`, which has their names and how to
/// take each. All are lengths in centimetres; a person can have more of their
/// own (`Person::extra`), and a shoe size, which is not a length.
pub const MEASUREMENTS: &[&str] = &[
    "height",
    "chest",
    "waist",
    "hips",
    "neck",
    "shoulders",
    "upper_arm",
    "wrist",
    "arm_length",
    "armhole_depth",
    "back_length",
    "head",
    "hand",
    "foot_length",
    "foot_around",
];

/// Someone knitted for, with every set of their measurements.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    pub name: String,
    /// Colours they like, fibres they cannot wear, sizes they prefer.
    pub notes: String,
    /// Their own measurements beyond the standard ones, by name, in order.
    pub extra: Vec<String>,
    /// Every set, the newest first.
    pub sets: Vec<MeasurementSet>,
    /// How many projects are for them.
    pub project_count: i64,
    pub added_at: i64,
}

/// One time someone was measured. Values are centimetres, by measurement key:
/// a standard key, or `x:` and the name of one of the person's own. A
/// measurement not taken has no entry.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementSet {
    pub id: String,
    pub person_id: String,
    pub measured_at: i64,
    pub values: std::collections::BTreeMap<String, f64>,
    /// As bought: "EU 39", "US 8". Not a length, so not converted.
    pub shoe_size: String,
}

/// A person as the page sends them.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersonInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub extra: Vec<String>,
}

/// A set of measurements as the page sends it.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementSetInput {
    pub measured_at: i64,
    #[serde(default)]
    pub values: std::collections::BTreeMap<String, f64>,
    #[serde(default)]
    pub shoe_size: String,
}

/// How lengths are shown and typed: centimetres or inches. Stored in
/// centimetres whichever is chosen.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MeasureUnit {
    #[default]
    Cm,
    In,
}

// ---------- duplicate patterns ----------

/// Patterns that look like the same one, and which to keep.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// Every file is byte for byte the same: certainly copies. Otherwise only
    /// the names match, and they may be different versions or languages.
    pub exact: bool,
    /// The one suggested to keep: the one with the most attached to it.
    pub keep: String,
    pub patterns: Vec<DuplicateEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateEntry {
    pub pattern: Pattern,
    /// Projects made from it.
    pub projects: i64,
    /// Its highlights, notes on pages, bookmarks and pins.
    pub marks: i64,
    /// Rows counted in it.
    pub rows: i64,
    /// The file's size in bytes, 0 when it cannot be read.
    pub file_size: u64,
}

// ---------- colourwork charts ----------

/// One colour of a chart: what the legend calls it, and how it is drawn.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChartColour {
    pub name: String,
    /// "#rrggbb".
    pub hex: String,
}

/// A round yoke's stretch of rounds with the same stitches in each repeat.
/// From `row` (0 is the first round knitted) up to the next section, each
/// repeat has `sts` stitches. `cols` are the columns its wider neighbour has
/// and it does not: where the decreases (or, top-down, the increases) go.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChartSection {
    pub row: i64,
    pub sts: i64,
    #[serde(default)]
    pub cols: Vec<i64>,
}

/// Stitches and rows per 10 cm; 0 when not given.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChartGauge {
    pub sts: f64,
    pub rows: f64,
}

fn one() -> i64 {
    1
}

/// What a chart is: its grid and colours, and how it is knitted. Mirrors
/// `ChartData` in `src/views/chart.ts`, which explains each field.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChartData {
    /// "standard" or "yoke".
    pub kind: String,
    pub width: i64,
    pub height: i64,
    /// One character per square, row by row from the first row knitted, each
    /// a colour's index in hex ("0" to "f").
    pub cells: String,
    pub colours: Vec<ChartColour>,
    /// A standard chart worked flat, in right- and wrong-side rows; else in
    /// the round.
    #[serde(default)]
    pub flat: bool,
    /// A yoke's repeats around.
    #[serde(default = "one")]
    pub repeats: i64,
    /// A yoke knitted from the neck down.
    #[serde(default)]
    pub top_down: bool,
    #[serde(default)]
    pub sections: Vec<ChartSection>,
    #[serde(default)]
    pub gauge: ChartGauge,
    /// Symbols drawn on the squares as well as colours.
    #[serde(default)]
    pub symbols: bool,
    /// Floats longer than this many stitches are pointed out; 0 for never.
    #[serde(default)]
    pub float_limit: i64,
    #[serde(default)]
    pub notes: String,
}

/// A colourwork chart.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chart {
    pub id: String,
    pub name: String,
    pub data: ChartData,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A chart as the page sends it.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChartInput {
    #[serde(default)]
    pub name: String,
    pub data: ChartData,
}
