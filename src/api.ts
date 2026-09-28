import { invoke } from "@tauri-apps/api/core";

/**
 * Normalises a raw IPC payload into bytes.
 *
 * Commands that return file contents hand back a raw payload, which the
 * webview surfaces as an `ArrayBuffer` or a view over one. Everything
 * downstream wants a `Uint8Array`, and copying a large PDF needlessly is
 * exactly the cost this was changed to avoid, so a view is passed through
 * untouched.
 */
export function toBytes(raw: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  // `ArrayBufferView` is generic over a possibly-shared buffer, but an IPC
  // payload never comes from a SharedArrayBuffer, so this stays a zero-copy
  // view of the received buffer. The cast only settles that for the type
  // checker; the runtime shape is already correct.
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) as Uint8Array<ArrayBuffer>;
}

/** Mirrors `models.rs::Pattern`. */
export interface Pattern {
  id: string;
  title: string;
  designer: string;
  filePath: string;
  fileName: string;
  format: "pdf" | "epub";
  status: string;
  difficulty: string;
  needleSize: string;
  /**
   * Yarn weight as the pattern states it, e.g. "DK" or "100 m/100g". Free
   * text; the family below is derived from it on write.
   */
  yarnWeight: string;
  /** Standard weight family key, e.g. "dk". Empty when unrecognised. */
  yarnWeightFamily: string;
  tags: string[];
  notes: string;
  addedAt: number;
  lastOpenedAt: number | null;
  lastPage: number;
  lastScroll: number;
  /** File name of the cover inside the library's covers folder, or "". */
  coverPath: string;
}

/** Mirrors `models.rs::Section`. */
/**
 * A named place in a pattern that is counted separately from the project as a
 * whole: a front, a sleeve worked in turn, a collar, or a lace repeat.
 */
export interface Counter {
  id: string;
  patternId: string;
  name: string;
  /** Row count to aim for. 0 means no target, so it can count freely. */
  target: number;
  current: number;
  /**
   * Whether this counter advances when rows are counted. Several can be on at
   * once, which is what makes working two sleeves alternately work.
   */
  enabled: boolean;
  /**
   * Leaves the project total alone when this counter is moved on its own, for
   * a count that is not one of the project's rows.
   */
  excludedFromTotal: boolean;
  position: number;
}

export interface CounterInput {
  name: string;
  target: number;
  enabled: boolean;
  excludedFromTotal: boolean;
}

/**
 * What one counting action did. The whole state comes back so the panel
 * repaints from a single round trip rather than working out for itself what
 * the clamping rules did.
 */
export interface CountOutcome {
  patternId: string;
  totalRows: number;
  counters: Counter[];
}

export interface Progress {
  patternId: string;
  totalRows: number;
  updatedAt: number;
}

export interface HighlightSettings {
  patternId: string;
  enabled: boolean;
  offsetY: number;
  thickness: number;
  width: number;
  insetX: number;
  color: string;
  opacity: number;
  animate: boolean;
  animationMs: number;
}

/** One row of the yarn weight filter, from the standard weight table. */
export interface YarnWeightFacet {
  key: string;
  label: string;
  count: number;
}

export interface FacetValues {
  designers: string[];
  needleSizes: string[];
  /** Every family in the table, in order, whether or not it is used. */
  yarnWeights: YarnWeightFacet[];
  tags: string[];
}

export interface Filter {
  search?: string;
  status?: string;
  designer?: string;
  difficulty?: string;
  needleSize?: string;
  /** Yarn weight families. Several means "any of these". */
  yarnWeight?: string[];
  tags?: string[];
  sort?: string;
}

/** Mirrors `models.rs::Annotation`. */
export interface Annotation {
  id: string;
  patternId: string;
  kind: string;
  /** 1-based page for a PDF, chapter index for an EPUB. */
  page: number;
  /**
   * Rectangles for a highlight, or strokes for a drawing, as a JSON string.
   * Meaning depends on `kind`; see `src/annotations.ts`.
   */
  geometry: string;
  /**
   * The text this was made from. On an EPUB this is what re-finds the passage
   * after the text reflows, so it is stored even for a PDF, where it also
   * serves as a readable label.
   */
  quote: string;
  /** Which occurrence of `quote`, for when the same words appear more than once. */
  occurrence: number;
  color: string;
  /** Note body. Empty for the other kinds. */
  text: string;
  createdAt: number;
}

export interface AnnotationInput {
  kind: string;
  page: number;
  geometry: string;
  quote: string;
  occurrence: number;
  color: string;
  text: string;
}

export interface SectionState {
  current: number;
  totalRows: number;
}

/** Mirrors `models.rs::Pin`. */
export interface Pin {
  id: string;
  patternId: string;
  /** 1-based page the crop was taken from. */
  page: number;
  /** The cropped region, as a JSON string of one normalised page rectangle. */
  geometry: string;
  /** The text under the crop, when there was any. A label, nothing more. */
  quote: string;
  title: string;
  /** Card position and size, as a fraction of the reading pane. */
  offsetX: number;
  offsetY: number;
  width: number;
  hidden: boolean;
  z: number;
  /** File name of the crop inside `library/pins`. */
  imageFile: string;
  createdAt: number;
}

export interface PinInput {
  page: number;
  geometry: string;
  quote: string;
  title: string;
  /** The cropped area as JPEG bytes. */
  imageBytes: number[];
  imageMime: string;
}

export interface PinPlacement {
  offsetX: number;
  offsetY: number;
  width: number;
  hidden: boolean;
}

/**
 * How many pins a pattern may hold.
 *
 * Mirrors `models.rs::MAX_PINS`. The backend enforces it too — this copy is
 * only so the toolbar can grey the button out before the user is told off, and
 * it is not the thing that stops them at six.
 */
export const MAX_PINS = 5;


/** Mirrors `commands.rs::AiSettingsView`. */
export interface AiSettingsView {
  baseUrl: string;
  model: string;
  fallbackModel: string;
  hasApiKey: boolean;
  /** True when the model server looks like this machine or a private network. */
  isLocal: boolean;
  applyAutomatically: boolean;
  skipExisting: boolean;
  maxCharacters: number;
  reasoningEffort: string;
  rescanExisting: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
}

export interface AiConnectionTest {
  ok: boolean;
  modelCount: number;
  models: ModelInfo[];
}

/** Mirrors `models.rs::Suggestion`. */
export interface Suggestion {
  designer: string;
  difficulty: string;
  needleSize: string;
  yarn: string;
  tags: string[];
  summary: string;
}

/** Mirrors `models.rs::SuggestionResult`. */
export interface SuggestionResult {
  patternId: string;
  patternTitle: string;
  failed: boolean;
  error: string;
  suggestion: Suggestion;
  before: Pattern;
  after: Pattern;
  changedFields: string[];
  applied: boolean;
}

export interface CoverImage {
  patternId: string;
  fileName: string;
  bytes: number[];
  mime: string;
}

/** One pattern file found by `scan_pattern_folder`. */
export interface ScannedFile {
  /** Full path on disk; handed back to `add_pattern` as the source. */
  path: string;
  fileName: string;
}

/**
 * Whether an `add_pattern` failure is the duplicate case.
 *
 * The backend rejects a content-duplicate with a message that starts
 * `already in the library as "`, naming the pattern it matches. That is a
 * skip, not a failure — anything else means the file genuinely could not be
 * added. The message can arrive as a bare string or wrapped in an Error,
 * depending on where the rejection surfaced.
 */
export function isAlreadyHave(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.startsWith('already in the library as "');
}

export const STATUSES = [
  { value: "want-to-knit", label: "Want to knit" },
  { value: "in-progress", label: "In progress" },
  { value: "finished", label: "Finished" },
  { value: "abandoned", label: "Abandoned" },
];

export const DIFFICULTIES = [
  { value: "beginner", label: "Beginner" },
  { value: "easy", label: "Easy" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

/**
 * Suggestions for the yarn weight field.
 *
 * The standard names a knitter would reach for. Offered as a datalist rather
 * than a fixed dropdown, because a pattern may state its weight as a metre
 * figure instead and that has to stay typeable; the backend works out which
 * family any of them belongs to.
 */
export const YARN_WEIGHT_OPTIONS = [
  "Lace",
  "Fingering",
  "Sport",
  "DK",
  "Worsted",
  "Aran",
  "Bulky",
  "Chunky",
  "Super chunky",
  "Jumbo",
];

// A typed pass-through to the Rust commands, so the rest of the app never
// writes command names as raw strings.
export const api = {
  addPattern: (input: {
    title: string;
    designer: string;
    fileName: string;
    /** Yarn weight as stated; the family is derived from it on write. */
    yarnWeight?: string;
    /** Preferred: the backend copies from this path and no bytes are sent. */
    sourcePath?: string;
    /** Fallback for drag and drop, where only the contents are available. */
    bytes?: number[];
    status: string;
    difficulty: string;
    needleSize: string;
    tags: string[];
    notes: string;
  }) => invoke<Pattern>("add_pattern", { input }),

  listPatterns: (filter: Filter = {}) => invoke<Pattern[]>("list_patterns", { filter }),
  /**
   * Recursively walks a folder for PDFs and EPUBs, sorted by path. Paths only,
   * never contents: each one goes back to `addPattern` as a `sourcePath`, so no
   * bytes cross the boundary until the backend copies the file itself.
   */
  scanPatternFolder: (path: string) => invoke<ScannedFile[]>("scan_pattern_folder", { path }),
  getPattern: (id: string) => invoke<Pattern>("get_pattern", { id }),
  updatePattern: (pattern: Pattern) => invoke<Pattern>("update_pattern", { pattern }),
  deletePattern: (id: string) => invoke<void>("delete_pattern", { id }),
  getFacets: () => invoke<FacetValues>("get_facets"),
  savePosition: (id: string, page: number, scroll: number) =>
    invoke<void>("save_position", { id, page, scroll }),
  /**
   * Reads a pattern file. The command returns a raw binary payload, so this
   * resolves to bytes rather than a JSON array of numbers — the array form was
   * the single biggest cost in opening a large PDF.
   */
  readFile: (id: string) => invoke<ArrayBuffer | ArrayBufferView>("read_file", { id }),

  // Counters. `countRows` is the one counting action: it moves the project
  // total and every enabled counter together, which is why it is a single
  // command rather than the frontend adding up the pieces.
  listCounters: (patternId: string) => invoke<Counter[]>("list_counters", { patternId }),
  addCounter: (patternId: string, input: CounterInput) =>
    invoke<Counter>("add_counter", { patternId, input }),
  updateCounter: (id: string, name: string, target: number, excludedFromTotal: boolean) =>
    invoke<void>("update_counter", { id, name, target, excludedFromTotal }),
  setCounterEnabled: (patternId: string, id: string, enabled: boolean) =>
    invoke<CountOutcome>("set_counter_enabled", { patternId, id, enabled }),
  countRows: (patternId: string, delta: number) =>
    invoke<CountOutcome>("count_rows", { patternId, delta }),
  countCounter: (id: string, delta: number) => invoke<CountOutcome>("count_counter", { id, delta }),
  resetCounter: (id: string) => invoke<void>("reset_counter", { id }),
  deleteCounter: (id: string) => invoke<void>("delete_counter", { id }),

  getProgress: (patternId: string) => invoke<Progress>("get_progress", { patternId }),
  setTotalRows: (patternId: string, total: number) =>
    invoke<Progress>("set_total_rows", { patternId, total }),

  // Annotations: highlights, notes and drawings.
  listAnnotations: (patternId: string) => invoke<Annotation[]>("list_annotations", { patternId }),
  addAnnotation: (patternId: string, input: AnnotationInput) =>
    invoke<Annotation>("add_annotation", { patternId, input }),
  editAnnotation: (id: string, text: string, color: string) =>
    invoke<void>("edit_annotation", { id, text, color }),
  deleteAnnotation: (id: string) => invoke<void>("delete_annotation", { id }),

  // Pins: a cropped image of part of a page, kept beside the pattern.
  listPins: (patternId: string) => invoke<Pin[]>("list_pins", { patternId }),
  /** Counted separately so the toolbar can grey out before the user tries. */
  pinCount: (patternId: string) => invoke<number>("pin_count", { patternId }),
  addPin: (patternId: string, input: PinInput) => invoke<Pin>("add_pin", { patternId, input }),
  updatePin: (id: string, placement: PinPlacement) => invoke<Pin>("update_pin", { id, placement }),
  renamePin: (id: string, title: string) => invoke<void>("rename_pin", { id, title }),
  deletePin: (id: string) => invoke<void>("delete_pin", { id }),
  /** Raw binary; the caller makes a blob URL and lets the browser decode it. */
  getPinImage: (id: string) => invoke<ArrayBuffer | ArrayBufferView>("get_pin_image", { id }),

  getHighlight: (patternId: string) => invoke<HighlightSettings>("get_highlight", { patternId }),  saveHighlight: (settings: HighlightSettings) =>
    invoke<HighlightSettings>("save_highlight", { settings }),

  // Covers.
  setCover: (patternId: string, bytes: number[]) =>
    invoke<CoverImage>("set_cover", { patternId, bytes }),
  /** Raw binary; the caller works out whether it is JPEG or PNG. */
  getCover: (patternId: string) => invoke<ArrayBuffer | ArrayBufferView>("get_cover", { patternId }),
  removeCover: (patternId: string) => invoke<void>("remove_cover", { patternId }),
  patternsMissingCovers: () => invoke<string[]>("patterns_missing_covers"),

  // AI metadata.
  getAiSettings: () => invoke<AiSettingsView>("get_ai_settings"),
  saveAiSettings: (settings: AiSettingsView, apiKey?: string) =>
    invoke<AiSettingsView>("save_ai_settings", { settings, apiKey }),
  testAiConnection: () => invoke<AiConnectionTest>("test_ai_connection"),
  /**
   * Asks the model to describe a pattern.
   *
   * `images` carries rendered page pictures for a file with no text layer,
   * which is the only way to read a scan. Omit it when there is text: sending
   * both wastes the payload and some servers reject a mixed request.
   */
  suggestMetadata: (patternId: string, excerpt: string, images: string[] = []) =>
    invoke<SuggestionResult>("suggest_metadata", { patternId, excerpt, images }),
  applySuggestion: (patternId: string, after: Pattern) =>
    invoke<Pattern>("apply_suggestion", { patternId, after }),
  undoLastAiChange: (patternId: string) => invoke<Pattern | null>("undo_last_ai_change", {
    patternId,
  }),
  hasAiHistory: (patternId: string) => invoke<boolean>("has_ai_history", { patternId }),
  clearAiHistory: (patternId: string) => invoke<void>("clear_ai_history", { patternId }),
};
