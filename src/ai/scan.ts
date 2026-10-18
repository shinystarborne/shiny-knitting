import { api, toBytes, type AiSettingsView, type Pattern, type SuggestionResult } from "../api";
import { excerptImages, extractExcerpt, pageCount } from "./excerpt";
import { forgetCover } from "../covers";

/**
 * The result of scanning one pattern, as the UI needs it.
 */
export interface ScanOutcome {
  patternId: string;
  title: string;
  ok: boolean;
  error: string;
  changed: string[];
  applied: boolean;
}

/**
 * Runs a metadata scan over a set of patterns.
 *
 * Patterns are handled one at a time rather than all at once, because a
 * single local model cannot usefully serve parallel requests, and because a
 * failure partway through should not lose the work already done. Progress is
 * reported per pattern so the user can watch it move and stop it.
 *
 * Nothing is thrown: a failure becomes an outcome with a message, since one
 * unreadable pattern should not end the run.
 */
export class MetadataScanner {
  private settings: AiSettingsView;

  constructor(settings: AiSettingsView) {
    this.settings = settings;
  }

  /** Patterns worth scanning, given what has already been filled in. */
  /**
   * PDFs described already but not books, whose length has not been looked
   * at on this computer: Describe files the long ones as books (see
   * `booksByLength`), without asking the model.
   */
  static unmeasured(patterns: Pattern[], settings: AiSettingsView): Pattern[] {
    const described = new Set(MetadataScanner.candidates(patterns, settings).map((p) => p.id));
    const seen = measured();
    return patterns.filter((p) => p.format === "pdf" && !described.has(p.id) && !p.tags.some((t) => t.toLowerCase() === "book") && !seen.has(measureKey(p)));
  }

  static candidates(patterns: Pattern[], settings: AiSettingsView): Pattern[] {
    return patterns.filter((p) => {
      if (settings.rescanExisting) return true;
      // Skip anything that already looks described, so a rescan is not
      // repeated work.
      return !p.designer || !p.difficulty || p.tags.length === 0;
    });
  }

  async scan(
    patterns: Pattern[],
    onEach: (outcome: ScanOutcome, index: number, total: number) => void,
    shouldStop: () => boolean,
  ): Promise<ScanOutcome[]> {
    const results: ScanOutcome[] = [];
    const total = patterns.length;

    for (let i = 0; i < total; i++) {
      if (shouldStop()) break;
      const pattern = patterns[i];
      const outcome = await this.scanOne(pattern);
      results.push(outcome);
      onEach(outcome, i, total);
    }
    return results;
  }

  private async scanOne(pattern: Pattern): Promise<ScanOutcome> {
    const base = { patternId: pattern.id, title: pattern.title };
    try {
      if (!this.settings.baseUrl.trim()) {
        return { ...base, ok: false, error: "No model server is set up.", changed: [], applied: false };
      }

      // Read the file to get the excerpt. A pattern whose file has gone
      // missing is reported rather than thrown.
      const bytes = toBytes(await api.readFile(pattern.id));
      const excerpt = await extractExcerpt(
        pattern.format,
        bytes,
        this.settings.maxCharacters,
      );

      const result: SuggestionResult = await api.suggestMetadata(
        pattern.id,
        excerpt,
        // Scans and photographs have no text layer at all, so when there is
        // none the pages are rendered and sent as pictures instead.
        excerpt.trim() ? [] : await excerptImages(pattern.format, bytes),
        // The length says a good deal about whether it is a book.
        (await pageCount(pattern.format, bytes)) || null,
      );
      if (result.failed) {
        return { ...base, ok: false, error: result.error, changed: [], applied: false };
      }
      if (!result.changedFields.length) {
        return {
          ...base,
          ok: true,
          error: "",
          changed: [],
          applied: false,
        };
      }
      return {
        ...base,
        ok: true,
        error: "",
        changed: result.changedFields,
        applied: result.applied,
      };
    } catch (err) {
      return {
        ...base,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        changed: [],
        applied: false,
      };
    }
  }
}

/** Pages from which a PDF is a book: as the backend's `ai::BOOK_PAGES`. */
export const BOOK_PAGES = 50;

const MEASURED_KEY = "describe:measured";

/** A pattern as measured: its id and file, so a file replaced is measured again. */
function measureKey(p: Pattern): string {
  return `${p.id}:${p.fileName}`;
}

/** The PDFs whose length was looked at, on this computer. */
function measured(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(MEASURED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Described PDFs that are long enough to be books, filed as books: tagged
 * "book", the model not asked. Each is measured once on this computer.
 * Returns the ones moved.
 */
export async function booksByLength(patterns: Pattern[]): Promise<Pattern[]> {
  const seen = measured();
  const moved: Pattern[] = [];
  for (const p of patterns) {
    try {
      const pages = await pageCount("pdf", toBytes(await api.readFile(p.id)));
      if (pages >= BOOK_PAGES) moved.push(await api.updatePattern({ ...p, tags: [...p.tags, "book"].sort() }));
      seen.add(measureKey(p));
    } catch {
      // A file gone missing is measured another time.
    }
  }
  try {
    localStorage.setItem(MEASURED_KEY, JSON.stringify([...seen]));
  } catch {
    // Measured again next time.
  }
  return moved;
}

/**
 * A single pattern, used by the "describe this one" action in the reader.
 * Returns the result so the caller can show what changed.
 */
export async function scanOne(
  pattern: Pattern,
  settings: AiSettingsView,
): Promise<SuggestionResult> {
  const bytes = toBytes(await api.readFile(pattern.id));
  const excerpt = await extractExcerpt(
    pattern.format,
    bytes,
    settings.maxCharacters,
  );
  return api.suggestMetadata(
    pattern.id,
    excerpt,
    // See the note in the scanner: no text means the pages are sent as
    // pictures for a model that can see them.
    excerpt.trim() ? [] : await excerptImages(pattern.format, bytes),
    (await pageCount(pattern.format, bytes)) || null,
  );
}

/**
 * Rewinds a pattern to before the last AI change. Used by the undo button,
 * which appears on any card the model has touched.
 */
export async function undoPattern(patternId: string): Promise<Pattern | null> {
  const restored = await api.undoLastAiChange(patternId);
  if (restored) forgetCover(patternId);
  return restored;
}

/** Summarises a run, for the line under the progress bar. */
export function summarise(outcomes: ScanOutcome[]): string {
  const ok = outcomes.filter((o) => o.ok && o.changed.length);
  const unchanged = outcomes.filter((o) => o.ok && !o.changed.length);
  const failed = outcomes.filter((o) => !o.ok);

  const parts: string[] = [];
  if (ok.length) {
    parts.push(
      `${ok.length} pattern${ok.length === 1 ? "" : "s"} described${
        ok.every((o) => o.applied) ? " and saved" : ""
      }`,
    );
  }
  if (unchanged.length) parts.push(`${unchanged.length} already complete`);
  if (failed.length) parts.push(`${failed.length} could not be read`);
  return parts.join(" · ") || "Nothing to do";
}
