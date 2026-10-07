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
  /** The key that counts this counter alone (a physical key code), or "". */
  hotkey: string;
}

/** The keys that count a row up and back down. Physical key codes. */
export interface CountKeys {
  up: string;
  down: string;
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

/** How the library's needle size filter spells each size. */
export type NeedleSizeFormat = "metric" | "us" | "both";

/**
 * One row of the needle size filter: the canonical mm key it filters on, the
 * metric label ("4 mm"), the US needle number ("" when there is none), and
 * how many patterns use it.
 */
export interface NeedleSizeFacet {
  key: string;
  mm: string;
  us: string;
  count: number;
}

/** A designer or tag, and how many patterns it is on. */
export interface FacetCount {
  value: string;
  count: number;
}

export interface FacetValues {
  designers: string[];
  /** The same designers, most used first, with their counts. */
  designerCounts: FacetCount[];
  /** The canonical needle sizes in use, smallest first, with their labels and counts. */
  needleSizes: NeedleSizeFacet[];
  /** Every family in the table, in order, whether or not it is used. */
  yarnWeights: YarnWeightFacet[];
  tags: string[];
  /** The tags, most used first, with their counts. */
  tagCounts: FacetCount[];
}

export interface Filter {
  search?: string;
  status?: string;
  designer?: string;
  difficulty?: string;
  /** Canonical needle size mm keys. Several means "any of these". */
  needleSizes?: string[];
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

/** Mirrors `models.rs::Bookmark`. */
/** A page shown turned, clockwise in degrees. Upright pages have none. */
export interface PageRotation {
  /** 1-based page. */
  page: number;
  rotation: number;
}

export interface Bookmark {
  id: string;
  patternId: string;
  /** 1-based page. */
  page: number;
  title: string;
  sortOrder: number;
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
  /** Describing patterns with a model is switched on. Off unless chosen. */
  enabled: boolean;
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

// ---------- updates ----------

/** Mirrors `commands.rs::UpdateSettingsView`. */
export interface UpdateSettings {
  includeBeta: boolean;
  checkOnStartup: boolean;
  /** The running app's version, reported back so the dialog can show it. */
  currentVersion: string;
}

/** One release that is newer than the running app. */
export interface UpdateInfo {
  tag: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  assetName: string;
  /** The API URL the installer is downloaded from; browsers cannot fetch it. */
  assetApiUrl: string;
  sizeBytes: number;
  /** The release's page, for "What's new"; empty if there is none. */
  pageUrl: string;
}

/** What a manual "Check for updates" found. */
export interface UpdateOutcome {
  currentVersion: string;
  /** Unix seconds. */
  checkedAt: number;
  update: UpdateInfo | null;
}

/**
 * What the quiet startup check found. `skipped` means the check was switched
 * off (or already ran today), and the frontend should show nothing at all.
 */
export interface StartupUpdateOutcome {
  skipped: boolean;
  currentVersion: string | null;
  checkedAt: number | null;
  update: UpdateInfo | null;
}

export interface CoverImage {
  patternId: string;
  fileName: string;
  bytes: number[];
  mime: string;
}

/** Mirrors `models.rs::YarnLot`. */
/**
 * One purchase of a yarn. The same yarn bought twice lives here twice, because
 * dye lots differ between purchases and mixing them shows in the knitting.
 */
export interface YarnLot {
  id: string;
  yarnId: string;
  dyeLot: string;
  balls: number;
  /** Grams left, weighed once balls are started; a partial ball is how much of it remains. */
  gramsLeft: number;
  /** Whether gramsLeft was weighed. Not weighed, the lot is its balls by the ball band. */
  weighed: boolean;
  /** Where it is kept, e.g. "under-bed box". */
  location: string;
  boughtAt: number | null;
  /** What a finished project left over; shown as a Leftover tag. */
  leftover: boolean;
}

/** Mirrors `models.rs::Yarn`. */
/** One fibre in a yarn and its share: 75 for "75% wool"; 0 when not known. */
export interface Fibre {
  name: string;
  percent: number;
}

/**
 * What a yarn is planned for: a pattern from the library, or a title typed
 * for one not got yet. Mirrors `models.rs::YarnPlan`; a linked pattern's
 * title comes back as it is now.
 */
export interface YarnPlan {
  patternId: string | null;
  title: string;
}

export interface Yarn {
  id: string;
  name: string;
  brand: string;
  colourway: string;
  /**
   * Yarn weight as stated, e.g. "DK" or "100 m/100g". Free text; the family
   * below is derived from it on write, exactly as for a pattern.
   */
  yarnWeight: string;
  /** Standard weight family key, e.g. "dk". Empty when unrecognised. */
  yarnWeightFamily: string;
  /** Per-ball figures off the ball band; 0 when unknown. */
  metresPerBall: number;
  gramsPerBall: number;
  /** File name of the photo inside the library's covers folder, or "". */
  photoPath: string;
  notes: string;
  /** What it is made of, as the ball band gives it. */
  fibres: Fibre[];
  /** Treated so it can go in the washing machine. */
  superwash: boolean;
  /** What it is planned for. */
  plans: YarnPlan[];
  /** When it was used up, into the stash's history; null while in the stash. */
  usedUpAt: number | null;
  /** Every project it was on, finished ones too: what it went into. */
  usedIn: string[];
  /** The plans (projects not started) it is meant for, by name. */
  plannedIn: string[];
  addedAt: number;
  lots: YarnLot[];
  // The last three are derived by the backend from the lots; they are sent
  // on every read so a card never adds them up for itself.
  /** Total grams left across every lot. */
  gramsLeft: number;
  /** Total balls across every lot. */
  ballsTotal: number;
  /** gramsLeft ÷ gramsPerBall × metresPerBall; 0 when the per-ball figures are unknown. */
  metresLeft: number;
  /** The active projects using it, by name; empty when it is free. */
  projects: string[];
  /**
   * What its ball band says of knitting it, shared by every colour of the
   * yarn. Always sent by the backend; left out of an update, it stays as it is.
   */
  details?: YarnDetails;
}

/** What a yarn's ball band says of knitting it, by brand and yarn name. 0 is not said. Mirrors `models.rs::YarnDetails`. */
export interface YarnDetails {
  /** The gauge to expect, per 10 cm. */
  gaugeSts: number;
  gaugeRows: number;
  /** The needles to use, in mm: one size, or a range. */
  needleFrom: number;
  needleTo: number;
  /** Its care symbols' ids (see views/care.ts), in the order a label is read. */
  care: string[];
}

export interface YarnLotInput {
  /** Present means "keep this lot"; absent means it is new. */
  id?: string | null;
  dyeLot: string;
  balls: number;
  gramsLeft: number;
  /** Left out, it is weighed when it gives grams or no balls. */
  weighed?: boolean;
  location: string;
  boughtAt: number | null;
  leftover: boolean;
}

/** What the yarn form sends; ids and derived figures are the backend's. */
export interface YarnInput {
  name: string;
  brand: string;
  colourway: string;
  /** Yarn weight as stated; the family is derived from it on write. */
  yarnWeight: string;
  metresPerBall: number;
  gramsPerBall: number;
  notes: string;
  fibres?: Fibre[];
  superwash?: boolean;
  plans: YarnPlan[];
  lots: YarnLotInput[];
  details?: YarnDetails;
}

/**
 * Yarn used, when: what a finished project took (weighed before and after),
 * or what was left of a yarn marked used up. Mirrors `models.rs::YarnUse`.
 */
export interface YarnUse {
  id: string;
  yarnId: string | null;
  yarnName: string;
  projectId: string | null;
  projectName: string;
  at: number;
  grams: number;
  /** By the yarn's ball band then; 0 when it had no metres per ball. */
  metres: number;
  source: "finished" | "used-up";
}

export interface YarnFilter {
  search?: string;
  /** "history" for the used up, "all" for everything; the stash by default. */
  used?: "history" | "all";
  /** Yarn weight families. Several means "any of these". */
  yarnWeight?: string[];
}

/** Same shape as `CoverImage`, keyed to a yarn. */
export interface YarnPhoto {
  yarnId: string;
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

/** A pattern's status; it can also have none (""), which is how one starts. */
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

// ---------- needles and hooks ----------

/** What a tool is. The same list, in the same spelling, as the backend's. */
export const TOOL_KINDS = [
  { key: "straight", label: "Straight needles" },
  { key: "circular", label: "Circular needle" },
  { key: "dpn", label: "Double-pointed needles" },
  { key: "tips", label: "Interchangeable tips" },
  { key: "cable", label: "Interchangeable cable" },
  { key: "hook", label: "Crochet hook" },
] as const;

export type ToolKind = (typeof TOOL_KINDS)[number]["key"];

/**
 * The materials known by name, suggested in the form and stored by key. Any
 * other material can be typed and is stored as typed. "other" predates that
 * and is no longer suggested, but still reads back.
 */
export const TOOL_MATERIALS = [
  { key: "metal", label: "Metal" },
  { key: "aluminium", label: "Aluminium" },
  { key: "steel", label: "Steel" },
  { key: "copper", label: "Copper" },
  { key: "bamboo", label: "Bamboo" },
  { key: "wood", label: "Wood" },
  { key: "carbon", label: "Carbon" },
  { key: "plastic", label: "Plastic" },
  { key: "other", label: "Other" },
] as const;

/** An interchangeable tip's or cable's connector size, smallest first. */
export const CABLE_SIZES = [
  { key: "mini", label: "Mini" },
  { key: "small", label: "Small" },
  { key: "standard", label: "Standard" },
  { key: "large", label: "Large" },
] as const;

/** A needle, a set of needles, a cable, or a hook. */
export interface Tool {
  id: string;
  kind: ToolKind;
  /** Millimetres; 0 for a cable. */
  sizeMm: number;
  /** Needle, tip or hook length in cm; 0 when not recorded or not applicable. */
  lengthCm: number;
  /** Circular needle (tip to tip) or cable length in cm. */
  cableCm: number;
  /** Connector size of tips or a cable, or "". */
  cableSize: string;
  brand: string;
  material: string;
  /** The active project it is on; null when it is free. */
  projectId: string | null;
  /** That project's name, or "". */
  projectName: string;
  notes: string;
  addedAt: number;
}

export type ToolInput = Omit<Tool, "id" | "projectName" | "addedAt">;

// ---------- projects ----------

/** One yarn on a project. Mirrors `models.rs::ProjectYarn`. */
export interface ProjectYarn {
  id: string;
  yarnId: string;
  yarnName: string;
  /** The lot it is from, when the yarn has more than one. */
  lotId: string | null;
  dyeLot: string;
  /** Grams left when the project finished; null while active or not recorded. */
  leftoverGrams: number | null;
  /** Grams the project is expected to take; null when not said. */
  plannedGrams: number | null;
}

/** Where a project is. Mirrors `models.rs::PROJECT_STATUSES`. */
export type ProjectStatus = "planned" | "active" | "paused" | "finished" | "frogged";

export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "finished", label: "Finished" },
  { value: "frogged", label: "Frogged" },
];

/** Active or paused: its needles and yarn are in use. */
export function isLive(status: string): boolean {
  return status === "active" || status === "paused";
}

/** Finished or frogged: a record of what it used, nothing in use any more. */
export function isRecord(status: string): boolean {
  return status === "finished" || status === "frogged";
}

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/** A piece of knitting, and what it is made with. Mirrors `models.rs::Project`. */
export interface Project {
  id: string;
  name: string;
  patternId: string | null;
  patternTitle: string;
  status: ProjectStatus;
  startedAt: number;
  finishedAt: number | null;
  notes: string;
  createdAt: number;
  /** The cover's file name, or "" when it has none. */
  coverPath: string;
  /** Who it is for; set with `setProjectPerson`, not with the details. */
  personId: string | null;
  personName: string;
  /** While active, the tools in use on it; once finished, those it used. */
  toolIds: string[];
  yarns: ProjectYarn[];
  /** A plan's time as said ("autumn"); empty when none. */
  planWhen: string;
  /** A plan's exact date, when there is one. */
  planDate: number | null;
  /** Where a plan is in the plans' order. */
  planOrder: number;
  /** A finished project is in the gallery by itself, unless hidden from it. */
  galleryHidden: boolean;
  /** The photos the gallery leaves out: "cover", or a log entry's id. */
  gallerySkip: string[];
}

export interface ProjectYarnInput {
  /** Present keeps an existing entry. */
  id?: string | null;
  yarnId: string;
  lotId: string | null;
  /** Grams it is expected to take; null (or 0) for not said. */
  plannedGrams?: number | null;
}

/** What the project dialog sends: the whole set of tools and yarns wanted. */
export interface ProjectInput {
  name: string;
  patternId: string | null;
  notes: string;
  startedAt: number | null;
  /** Kept only once finished; an active project has no end yet. */
  finishedAt?: number | null;
  toolIds: string[];
  yarns: ProjectYarnInput[];
  /** Made as a plan: not started; its yarn only meant for it. */
  planned?: boolean;
  planWhen?: string;
  planDate?: number | null;
}

/** What can go on a board, a project's or an inspiration board. */
export type BoardKind = "note" | "text" | "link" | "image" | "pattern" | "yarn" | "tool" | "swatch" | "log";

/** One thing on a board. Mirrors `models.rs::BoardItem`. */
export interface BoardItem {
  id: string;
  /** The board it is on: a project's id, or an inspiration board's. */
  boardId: string;
  kind: BoardKind;
  /** Board units: pixels at 100%. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking: higher is on top. */
  z: number;
  /** Its content, by kind: text, url and title, patternId, colour... */
  data: Record<string, unknown>;
  hasImage: boolean;
  createdAt: number;
}

export interface BoardItemPatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  toFront?: boolean;
  data?: Record<string, unknown>;
}

/** A board of its own, for ideas. Mirrors `models.rs::InspirationBoard`. */
export interface InspirationBoard {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  itemCount: number;
  /** A few of its pictures, for the card: its own, a pattern's cover, a yarn's photo. */
  pictures: { kind: "image" | "pattern" | "yarn"; id: string }[];
  colours: string[];
}

// ---------- shops and the wishlist ----------

/** A shop you buy from. Mirrors `models.rs::Shop`. */
export interface Shop {
  id: string;
  name: string;
  /** Always http or https; "" for a shop with no web address. */
  url: string;
  /** Your own words about it. */
  comment: string;
  /** Your own labels: yarn, deadstock, sale. */
  tags: string[];
  /** How many things still wanted are to be got here. */
  wanted: number;
  addedAt: number;
}

export type ShopInput = Pick<Shop, "name" | "url" | "comment" | "tags">;

/** What a wishlist item is. The same keys as `models.rs::WISH_KINDS`. */
export const WISH_KINDS = [
  { key: "yarn", label: "Yarn" },
  { key: "tool", label: "Needles & hooks" },
  { key: "pattern", label: "Pattern" },
  { key: "other", label: "Other" },
] as const;

export type WishKind = (typeof WISH_KINDS)[number]["key"];

/** Something you want to get. Mirrors `models.rs::Wish`. */
export interface Wish {
  id: string;
  kind: WishKind;
  name: string;
  brand: string;
  /** As typed: "5 balls", "500 g". */
  amount: string;
  /** As typed, with its currency. */
  price: string;
  /** A link to it, or "". */
  url: string;
  shopId: string | null;
  shopName: string;
  shopUrl: string;
  projectId: string | null;
  projectName: string;
  notes: string;
  /** Its picture's file name, or "". */
  photoPath: string;
  /** When it was ticked as got; null while still wanted. */
  gotAt: number | null;
  /** When it was added to the stash or Needles & hooks from the wishlist. */
  stashedAt: number | null;
  addedAt: number;
}

export type WishInput = Pick<Wish, "kind" | "name" | "brand" | "amount" | "price" | "url" | "shopId" | "projectId" | "notes">;

/** What a shop's page says about the thing on it; "" for what it does not say. */
export interface LinkPreview {
  /** Where the page ended up, after redirects. */
  url: string;
  title: string;
  brand: string;
  /** With its currency: "€4.95", or "Free". */
  price: string;
  imageUrl: string;
  siteName: string;
  /** What the shop calls itself, or "" when the page does not say. */
  shopName: string;
}

// ---------- a project's log ----------

/** One entry in a project's log. Mirrors `models.rs::LogEntry`. */
/** A photo in a finished project's log, for the gallery. Mirrors `models.rs::GalleryPhoto`. */
export interface GalleryPhoto {
  projectId: string;
  /** The log entry's id; its picture is that entry's photo. */
  id: string;
  at: number;
  text: string;
}

export interface LogEntry {
  id: string;
  projectId: string;
  /** When it happened. */
  at: number;
  text: string;
  /** Written by the app: started, paused, finished… */
  milestone: boolean;
  photoPath: string;
}

// ---------- gauge swatches ----------

/** A gauge swatch. Mirrors `models.rs::Swatch`. Counts are per 10 cm, 0 when not counted. */
export interface Swatch {
  id: string;
  /** The stash yarn it was knitted in; null for yarn not in the stash. */
  yarnId: string | null;
  /** The yarn as typed, for one not in the stash (or a removed one's name). */
  yarnText: string;
  /** What to call the yarn: the stash yarn's brand and name, or the text. */
  yarnName: string;
  yarnColourway: string;
  /** The needle from Needles & hooks; null for a size only. */
  toolId: string | null;
  needleMm: number;
  stitch: string;
  sts: number;
  rows: number;
  stsBlocked: number;
  rowsBlocked: number;
  projectId: string | null;
  projectName: string;
  photoPath: string;
  notes: string;
  madeAt: number;
  addedAt: number;
}

export type SwatchInput = Pick<
  Swatch,
  "yarnId" | "yarnText" | "toolId" | "needleMm" | "stitch" | "sts" | "rows" | "stsBlocked" | "rowsBlocked" | "projectId" | "notes"
> & { madeAt: number | null };

// ---------- colourwork charts ----------

/** One colour of a chart. Mirrors `models.rs::ChartColour`. */
export interface ChartColour {
  name: string;
  /** "#rrggbb". */
  hex: string;
}

/**
 * A round yoke's stretch of rounds with the same stitches in each repeat.
 * Mirrors `models.rs::ChartSection`: from `row` (0 is the first round
 * knitted) to the next section, `sts` stitches each repeat; `cols` are the
 * columns its wider neighbour has and it does not.
 */
export interface ChartSection {
  row: number;
  sts: number;
  cols: number[];
}

/**
 * What a chart is. Mirrors `models.rs::ChartData`. Rows are in the order
 * they are knitted, row 0 first (drawn at the bottom); columns left to right
 * as drawn, so stitch 1 is the last column.
 */
export interface ChartData {
  kind: "standard" | "yoke";
  width: number;
  height: number;
  /** One character per square, row by row from row 0: a colour's index in hex. */
  cells: string;
  colours: ChartColour[];
  /** A standard chart worked flat, in right- and wrong-side rows; else in the round. */
  flat: boolean;
  /** A yoke's repeats around. */
  repeats: number;
  /** A yoke knitted from the neck down; else from the hem up. */
  topDown: boolean;
  /** A yoke's shaping, the first at row 0; none for a standard chart. */
  sections: ChartSection[];
  /** Stitches and rows per 10 cm; 0 when not given. */
  gauge: { sts: number; rows: number };
  /** Symbols on the squares as well as colours. */
  symbols: boolean;
  /** Floats longer than this many stitches are pointed out; 0 for never. */
  floatLimit: number;
  notes: string;
}

/** Mirrors `models.rs::Chart`. */
export interface Chart {
  id: string;
  name: string;
  data: ChartData;
  createdAt: number;
  updatedAt: number;
}

// ---------- people and their measurements ----------

/**
 * The measurements every person has a row for, in order, with how to take
 * each. The keys are `models.rs::MEASUREMENTS`. All are lengths, stored in
 * centimetres.
 */
export const MEASUREMENTS = [
  { key: "height", label: "Height", hint: "Standing straight, without shoes." },
  { key: "chest", label: "Chest / bust", hint: "Around the fullest part of the chest, under the arms." },
  { key: "waist", label: "Waist", hint: "Around the narrowest part." },
  { key: "hips", label: "Hips", hint: "Around the fullest part." },
  { key: "neck", label: "Neck", hint: "Around the base of the neck." },
  { key: "shoulders", label: "Shoulder width", hint: "Across the back, from one shoulder point to the other." },
  { key: "upper_arm", label: "Upper arm", hint: "Around the fullest part." },
  { key: "wrist", label: "Wrist", hint: "Around the wrist bone." },
  { key: "arm_length", label: "Arm length", hint: "From the underarm to the wrist, with the arm straight." },
  { key: "armhole_depth", label: "Armhole depth", hint: "From the top of the shoulder straight down to the underarm." },
  { key: "back_length", label: "Back length", hint: "From the bone at the nape of the neck down to the waist." },
  { key: "head", label: "Head", hint: "Around the forehead, just above the ears." },
  { key: "hand", label: "Hand", hint: "Around the knuckles, without the thumb." },
  { key: "foot_length", label: "Foot length", hint: "From the back of the heel to the longest toe." },
  { key: "foot_around", label: "Foot", hint: "Around the ball of the foot, where it is widest." },
] as const;

export type MeasurementKey = (typeof MEASUREMENTS)[number]["key"];

/** How lengths are shown and typed; always stored in centimetres. */
export type MeasureUnit = "cm" | "in";

/** One time someone was measured. Mirrors `models.rs::MeasurementSet`. */
export interface MeasurementSet {
  id: string;
  personId: string;
  measuredAt: number;
  /** Centimetres, by a MEASUREMENTS key or `x:` and one of the person's own. */
  values: Record<string, number>;
  /** As bought: "EU 39". */
  shoeSize: string;
}

export type MeasurementSetInput = Omit<MeasurementSet, "id" | "personId">;

/** Someone knitted for. Mirrors `models.rs::Person`. */
export interface Person {
  id: string;
  name: string;
  notes: string;
  /** Their own measurements' names, beyond the standard ones. */
  extra: string[];
  /** Newest first. */
  sets: MeasurementSet[];
  projectCount: number;
  addedAt: number;
}

export type PersonInput = Pick<Person, "name" | "notes" | "extra">;

/** Patterns that look like copies of each other. Mirrors `models.rs::DuplicateGroup`. */
export interface DuplicateGroup {
  /** The files are identical; otherwise only the names match. */
  exact: boolean;
  /** The one suggested to keep. */
  keep: string;
  patterns: {
    pattern: Pattern;
    projects: number;
    marks: number;
    rows: number;
    fileSize: number;
  }[];
}

/** How much of one of a project's yarns is left; 0 is used up, null unknown. */
/** One of a project's yarns when finishing it: what is left, or what it used. */
export interface YarnLeftover {
  entryId: string;
  /** Grams left; 0 for used up. */
  grams: number | null;
  /** Grams it used. */
  usedGrams?: number;
  /** Balls it used, each the ball band's weight. */
  usedBalls?: number;
}

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
  /** Only the status; "" is none. */
  setPatternStatus: (id: string, status: string) => invoke<Pattern>("set_pattern_status", { id, status }),
  findDuplicatePatterns: () => invoke<DuplicateGroup[]>("find_duplicate_patterns"),
  /** Keeps one, folds the others into it, and removes them. */
  mergeDuplicatePatterns: (keep: string, remove: string[]) => invoke<Pattern>("merge_duplicate_patterns", { keep, remove }),
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
  setCounterKey: (id: string, hotkey: string) => invoke<void>("set_counter_key", { id, hotkey }),
  getCountKeys: () => invoke<CountKeys>("get_count_keys"),
  saveCountKeys: (keys: CountKeys) => invoke<CountKeys>("save_count_keys", { keys }),

  // How the library's needle size filter spells each size.
  getNeedleSizeDisplay: () => invoke<NeedleSizeFormat>("get_needle_size_display"),
  saveNeedleSizeDisplay: (display: NeedleSizeFormat) =>
    invoke<void>("save_needle_size_display", { display }),

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

  // Opening outside the app.
  /** An http, https or mailto link, in the default browser or mail app. */
  openLink: (url: string) => invoke<void>("open_link", { url }),
  /** A pattern's own file, in the program Windows uses for it. */
  openPatternFile: (id: string) => invoke<void>("open_pattern_file", { id }),

  // Bookmarks: named pages to jump back to.
  listBookmarks: (patternId: string) => invoke<Bookmark[]>("list_bookmarks", { patternId }),
  addBookmark: (patternId: string, page: number, title: string) =>
    invoke<Bookmark>("add_bookmark", { patternId, page, title, position: null }),
  renameBookmark: (id: string, title: string) => invoke<Bookmark>("rename_bookmark", { id, title }),
  deleteBookmark: (id: string) => invoke<void>("delete_bookmark", { id }),

  // Turned pages, for charts printed sideways.
  listPageRotations: (patternId: string) => invoke<PageRotation[]>("list_page_rotations", { patternId }),
  /** Returns the rotation the page now has, brought round to 0, 90, 180 or 270. */
  setPageRotation: (patternId: string, page: number, rotation: number) =>
    invoke<number>("set_page_rotation", { patternId, page, rotation }),

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

  // The yarn stash. Lots go in whole on every write: an id the backend knows
  // is kept, one it does not is new, and a stored lot missing from the list is
  // gone. The derived totals come back on the returned yarn.
  // Needles and hooks. Listed whole and filtered here: even a large
  // collection is a few hundred rows.
  listTools: () => invoke<Tool[]>("list_tools"),
  addTool: (input: ToolInput) => invoke<Tool>("add_tool", { input }),
  updateTool: (id: string, input: ToolInput) => invoke<Tool>("update_tool", { id, input }),
  /** Puts a tool on an active project, moving it off any other; null frees it. */
  setToolProject: (id: string, projectId: string | null) =>
    invoke<Tool>("set_tool_project", { id, projectId }),
  deleteTool: (id: string) => invoke<void>("delete_tool", { id }),

  // Projects: what puts needles and yarn in use.
  /** The plans in the order given, as dragged. */
  setPlanOrder: (ids: string[]) => invoke<void>("set_plan_order", { ids }),
  listProjects: () => invoke<Project[]>("list_projects"),
  addProject: (input: ProjectInput) => invoke<Project>("add_project", { input }),
  updateProject: (id: string, input: ProjectInput) => invoke<Project>("update_project", { id, input }),
  /** Releases its tools and records each yarn's leftover in the stash. */
  finishProject: (id: string, leftovers: YarnLeftover[], finishedAt: number | null = null) =>
    invoke<Project>("finish_project", { id, input: { finishedAt, leftovers } }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  /** Active, paused or frogged; finishing goes through finishProject. */
  setProjectStatus: (id: string, status: ProjectStatus) => invoke<Project>("set_project_status", { id, status }),
  setProjectCover: (projectId: string, bytes: number[]) => invoke<void>("set_project_cover", { projectId, bytes }),
  /** Raw binary, as `getCover` returns it. */
  getProjectCover: (projectId: string) => invoke<ArrayBuffer | ArrayBufferView>("get_project_cover", { projectId }),
  removeProjectCover: (projectId: string) => invoke<void>("remove_project_cover", { projectId }),

  // Boards: a project's, by its id, or an inspiration board.
  listBoardItems: (boardId: string) => invoke<BoardItem[]>("list_board_items", { boardId }),
  addBoardItem: (boardId: string, input: { kind: BoardKind; x: number; y: number; w: number; h: number; data?: Record<string, unknown> }) =>
    invoke<BoardItem>("add_board_item", { boardId, input }),
  updateBoardItem: (id: string, patch: BoardItemPatch) => invoke<BoardItem>("update_board_item", { id, patch }),
  deleteBoardItem: (id: string) => invoke<void>("delete_board_item", { id }),
  setBoardImage: (id: string, bytes: number[]) => invoke<BoardItem>("set_board_image", { id, bytes }),
  getBoardImage: (id: string) => invoke<ArrayBuffer | ArrayBufferView>("get_board_image", { id }),
  listInspirationBoards: () => invoke<InspirationBoard[]>("list_inspiration_boards"),
  getInspirationBoard: (id: string) => invoke<InspirationBoard>("get_inspiration_board", { id }),
  addInspirationBoard: (name: string) => invoke<InspirationBoard>("add_inspiration_board", { name }),
  renameInspirationBoard: (id: string, name: string) => invoke<InspirationBoard>("rename_inspiration_board", { id, name }),
  deleteInspirationBoard: (id: string) => invoke<void>("delete_inspiration_board", { id }),

  // A project's log: newest first, milestones written by the backend itself.
  listProjectLog: (projectId: string) => invoke<LogEntry[]>("list_project_log", { projectId }),
  /** Every photo in a finished project's log, oldest first. */
  listGalleryPhotos: () => invoke<GalleryPhoto[]>("list_gallery_photos"),
  /** A finished project hidden from the gallery or shown, and the photos it leaves out. */
  setProjectGallery: (id: string, hidden: boolean, skip: string[]) => invoke<Project>("set_project_gallery", { id, hidden, skip }),
  /** Dated now. */
  addLogEntry: (projectId: string, text: string) => invoke<LogEntry>("add_log_entry", { projectId, text }),
  updateLogEntry: (id: string, text: string, at: number) => invoke<LogEntry>("update_log_entry", { id, text, at }),
  deleteLogEntry: (id: string) => invoke<void>("delete_log_entry", { id }),
  setLogPhoto: (id: string, bytes: number[]) => invoke<void>("set_log_photo", { id, bytes }),
  /** Raw binary, as `getCover` returns it. */
  getLogPhoto: (id: string) => invoke<ArrayBuffer | ArrayBufferView>("get_log_photo", { id }),
  removeLogPhoto: (id: string) => invoke<void>("remove_log_photo", { id }),

  // Gauge swatches. Listed whole: even a cork board's worth is a few hundred.
  listSwatches: () => invoke<Swatch[]>("list_swatches"),
  addSwatch: (input: SwatchInput) => invoke<Swatch>("add_swatch", { input }),
  updateSwatch: (id: string, input: SwatchInput) => invoke<Swatch>("update_swatch", { id, input }),
  deleteSwatch: (id: string) => invoke<void>("delete_swatch", { id }),
  setSwatchPhoto: (id: string, bytes: number[]) => invoke<void>("set_swatch_photo", { id, bytes }),
  /** Raw binary, as `getCover` returns it. */
  getSwatchPhoto: (id: string) => invoke<ArrayBuffer | ArrayBufferView>("get_swatch_photo", { id }),
  removeSwatchPhoto: (id: string) => invoke<void>("remove_swatch_photo", { id }),

  // Colourwork charts. Listed whole, squares and all: the list draws them.
  listCharts: () => invoke<Chart[]>("list_charts"),
  getChart: (id: string) => invoke<Chart>("get_chart", { id }),
  addChart: (name: string, data: ChartData) => invoke<Chart>("add_chart", { input: { name, data } }),
  updateChart: (id: string, name: string, data: ChartData) => invoke<Chart>("update_chart", { id, input: { name, data } }),
  deleteChart: (id: string) => invoke<void>("delete_chart", { id }),
  /**
   * Asks where to save an exported file (a chart, a pattern's pages) and writes
   * it: the path, or null if the dialog was cancelled. The bytes go raw, the
   * name and kind in headers.
   */
  saveFile: (kind: "pdf" | "png", name: string, bytes: Uint8Array) =>
    invoke<string | null>("save_file", bytes, { headers: { "x-kind": kind, "x-name": encodeURIComponent(name) } }),

  // People and their measurements. Each change returns the whole person, so
  // the page shows what was stored.
  listPeople: () => invoke<Person[]>("list_people"),
  getPerson: (id: string) => invoke<Person>("get_person", { id }),
  /** Comes with a first, empty set of measurements dated now. */
  addPerson: (input: PersonInput) => invoke<Person>("add_person", { input }),
  /** A measurement of their own left out of `extra` takes its values with it. */
  updatePerson: (id: string, input: PersonInput) => invoke<Person>("update_person", { id, input }),
  deletePerson: (id: string) => invoke<void>("delete_person", { id }),
  addMeasurementSet: (personId: string, input: MeasurementSetInput) => invoke<Person>("add_measurement_set", { personId, input }),
  updateMeasurementSet: (id: string, input: MeasurementSetInput) => invoke<Person>("update_measurement_set", { id, input }),
  deleteMeasurementSet: (id: string) => invoke<Person>("delete_measurement_set", { id }),
  /** Who a project is for, or no one with null. */
  setProjectPerson: (projectId: string, personId: string | null) => invoke<Project>("set_project_person", { projectId, personId }),
  getMeasureUnit: () => invoke<MeasureUnit>("get_measure_unit"),
  saveMeasureUnit: (unit: MeasureUnit) => invoke<MeasureUnit>("save_measure_unit", { unit }),

  // Shops, and the wishlist. Web addresses are tidied by the backend, so use
  // the one that comes back.
  listShops: () => invoke<Shop[]>("list_shops"),
  addShop: (input: ShopInput) => invoke<Shop>("add_shop", { input }),
  updateShop: (id: string, input: ShopInput) => invoke<Shop>("update_shop", { id, input }),
  /** What was to be got there stays on the wishlist, with no shop. */
  deleteShop: (id: string) => invoke<void>("delete_shop", { id }),
  listWishes: () => invoke<Wish[]>("list_wishes"),
  addWish: (input: WishInput) => invoke<Wish>("add_wish", { input }),
  updateWish: (id: string, input: WishInput) => invoke<Wish>("update_wish", { id, input }),
  /** Ticks it as got, today, or puts it back as still wanted. */
  setWishGot: (id: string, got: boolean) => invoke<Wish>("set_wish_got", { id, got }),
  /** It went into the stash or Needles & hooks: that makes it got, too. */
  setWishStashed: (id: string) => invoke<Wish>("set_wish_stashed", { id }),
  deleteWish: (id: string) => invoke<void>("delete_wish", { id }),
  setWishPhoto: (id: string, bytes: number[]) => invoke<void>("set_wish_photo", { id, bytes }),
  /** Raw binary, as `getCover` returns it. */
  getWishPhoto: (id: string) => invoke<ArrayBuffer | ArrayBufferView>("get_wish_photo", { id }),
  removeWishPhoto: (id: string) => invoke<void>("remove_wish_photo", { id }),
  /** Reads a shop's page for the name, brand, price and picture of what is on it. */
  fetchLinkPreview: (url: string) => invoke<LinkPreview>("fetch_link_preview", { url }),
  /** What a shop calls itself, read from its home page; "" when it does not say. */
  fetchShopName: (url: string) => invoke<string>("fetch_shop_name", { url }),
  /** A picture from the web, raw, for the form to downscale before storing. */
  fetchLinkImage: (url: string) => invoke<ArrayBuffer | ArrayBufferView>("fetch_link_image", { url }),

  listYarns: (filter: YarnFilter = {}) => invoke<Yarn[]>("list_yarns", { filter }),
  getYarn: (id: string) => invoke<Yarn>("get_yarn", { id }),
  addYarn: (input: YarnInput) => invoke<Yarn>("add_yarn", { input }),
  updateYarn: (yarn: Yarn) => invoke<Yarn>("update_yarn", { yarn }),
  deleteYarn: (id: string) => invoke<void>("delete_yarn", { id }),
  /** Every family in the weight table, in order, with a count of yarns in it. */
  yarnFacets: () => invoke<YarnWeightFacet[]>("yarn_facets"),

  // Yarn photos. Stored in the same covers folder as pattern covers.
  setYarnPhoto: (yarnId: string, bytes: number[]) =>
    invoke<YarnPhoto>("set_yarn_photo", { yarnId, bytes }),
  /** Raw binary, as `getCover` returns it. */
  getYarnPhoto: (yarnId: string) =>
    invoke<ArrayBuffer | ArrayBufferView>("get_yarn_photo", { yarnId }),
  removeYarnPhoto: (yarnId: string) => invoke<void>("remove_yarn_photo", { yarnId }),
  /** Used up, into the stash's history; or, with false, back in the stash. */
  setYarnUsedUp: (id: string, used: boolean) => invoke<Yarn>("set_yarn_used_up", { id, used }),
  /** Every use of yarn recorded, the newest first. */
  listYarnUsage: () => invoke<YarnUse[]>("list_yarn_usage"),


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

  // Updates. `startupUpdateCheck` is the quiet daily check; it answers
  // `skipped` when there is nothing to say, and its errors are ignored rather
  // than shown — a failed convenience check must never interrupt startup.
  getUpdateSettings: () => invoke<UpdateSettings>("get_update_settings"),
  saveUpdateSettings: (settings: { includeBeta: boolean; checkOnStartup: boolean }) =>
    invoke<void>("save_update_settings", {
      includeBeta: settings.includeBeta,
      checkOnStartup: settings.checkOnStartup,
    }),
  checkForUpdate: (args: { includeBeta: boolean }) =>
    invoke<UpdateOutcome>("check_for_update", args),
  startupUpdateCheck: () => invoke<StartupUpdateOutcome>("startup_update_check"),
  /** Resolves to the downloaded installer's path. */
  downloadUpdate: (args: { assetApiUrl: string; fileName: string }) =>
    invoke<string>("download_update", args),
  /** Runs the installer; the app exits, so this normally never resolves. */
  installUpdate: (args: { path: string }) => invoke<void>("install_update", args),
};
