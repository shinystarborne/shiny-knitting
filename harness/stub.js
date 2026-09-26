/**
 * Test harness. Loads the real app code in a browser with a fake Tauri IPC
 * layer backed by an in-memory store, so the whole UI can be exercised
 * without a Tauri window.
 *
 * Not part of the app build; used only by tools/harness.
 */

const store = {
  patterns: [],
  sections: [],
  progress: new Map(),
  highlights: new Map(),
  covers: new Map(),
  aiHistory: new Map(),
  aiSettings: null,
  apiKey: null,
  nextId: 1,
};

const clone = (v) => JSON.parse(JSON.stringify(v));

function seed() {
  const now = Date.now();
  const pdfId = "p1";
  const epubId = "p2";
  store.patterns = [
    {
      id: pdfId,
      title: "Featherweight Lace Sock",
      designer: "Jess Leslie",
      filePath: "library/originals/p1.pdf",
      fileName: "sample-pattern.pdf",
      format: "pdf",
      status: "in-progress",
      difficulty: "intermediate",
      needleSize: "4mm",
      yarnWeight: "fingering",
      yarnWeightFamily: "fingering",
      tags: ["lace", "socks"],
      notes: "Note: decrease 2 sts before the heel turn.",
      addedAt: now - 5000,
      lastOpenedAt: null,
      lastPage: 0,
      lastScroll: 0,
      coverPath: "",
    },
    {
      id: epubId,
      title: "Featherweight Lace Sock (EPUB)",
      designer: "Jess Leslie",
      filePath: "library/originals/p2.epub",
      fileName: "sample-pattern.epub",
      format: "epub",
      status: "want-to-knit",
      difficulty: "intermediate",
      needleSize: "4mm",
      yarnWeight: "fingering",
      yarnWeightFamily: "fingering",
      tags: ["lace"],
      notes: "",
      addedAt: now - 1000,
      lastOpenedAt: null,
      lastPage: 0,
      lastScroll: 0,
      coverPath: "",
    },
    {
      id: "p3",
      title: "Long Sock (40 pages)",
      designer: "Long Format",
      filePath: "library/originals/p3.pdf",
      fileName: "long-pattern.pdf",
      format: "pdf",
      status: "in-progress",
      difficulty: "intermediate",
      needleSize: "3mm",
      yarnWeight: "DK",
      yarnWeightFamily: "dk",
      tags: ["socks", "long"],
      notes: "",
      addedAt: now - 2000,
      lastOpenedAt: null,
      lastPage: 0,
      lastScroll: 0,
      coverPath: "",
    },
    {
      // A scan: pages of pure image with no text layer at all. This is the
      // case the AI's image fallback exists for, so it has to be a real
      // text-less PDF rather than a pattern with the text stripped in the stub.
      id: "p4",
      title: "Scanned Shawl (no text layer)",
      designer: "",
      filePath: "library/originals/p4.pdf",
      fileName: "scanned-pattern.pdf",
      format: "pdf",
      status: "want-to-knit",
      difficulty: "",
      needleSize: "",
      yarnWeight: "aran",
      yarnWeightFamily: "aran",
      tags: [],
      notes: "",
      addedAt: now - 3000,
      lastOpenedAt: null,
      lastPage: 0,
      lastScroll: 0,
      coverPath: "",
    },
  ];
  // Enough patterns that the library grid overflows, so the layout checks
  // exercise a pane that genuinely has to scroll.
  //
  // The yarn weights are deliberately varied: named families, a metre figure
  // with no name, an unusual name, and one pattern with none at all, so the
  // filter has something to separate and the "unrecognised" path is exercised.
  const filler = [
    ["Honeycomb Cardigan", "Elizabeth Zimmermann", "colourwork", "beginner", ["colourwork", "socks"], "aran"],
    ["Cabled Pullover", "Jess Leslie", "5mm", "intermediate", ["cables", "sweater"], "DK"],
    ["Lace Camisole", "Larva", "3mm", "advanced", ["lace", "top"], "lace weight"],
    ["Ribbed Beanie", "Any", "4mm", "easy", ["ribbing", "hat"], "100 m/100g"],
    ["Mossy Socks", "Yarn Sub", "3.5mm", "intermediate", ["colourwork", "socks"], "4-ply worsted"],
    ["Felted Bowl", "Kneed", "6mm", "easy", ["felt", "home"], "super bulky"],
    ["Stebner Vest", "Stebner", "4.5mm", "intermediate", ["vest", "lace"], "75 m/100g"],
    ["Corrugated Purse", "Kneed", "5mm", "advanced", ["knit", "bag"], "hand-dyed local spin"],
    ["Waffle Blanket", "Sample Author", "6mm", "intermediate", ["blanket", "texture"], "chunky"],
    ["Lace Mittens", "Larva", "2.75mm", "advanced", ["lace", "mittens"], "fingering"],
    ["Watch Cap", "Any", "4mm", "easy", ["hat", "ribbing"], ""],
  ];
  for (const [title, designer, needle, difficulty, tags, yarnWeight] of filler) {
    const id = `f${store.patterns.length + 1}`;
    store.patterns.push({
      id,
      title,
      designer,
      filePath: `library/originals/${id}.pdf`,
      fileName: "sample-pattern.pdf",
      format: "pdf",
      status: title === "Waffle Blanket" ? "in-progress" : "want-to-knit",
      difficulty,
      needleSize: needle,
      yarnWeight,
      yarnWeightFamily: yarnFamily(yarnWeight),
      tags,
      notes: "",
      addedAt: now - store.patterns.length * 1000,
      lastOpenedAt: null,
      lastPage: 0,
      lastScroll: 0,
      coverPath: "",
    });
  }

  for (const p of store.patterns) {
    store.progress.set(p.id, {
      patternId: p.id,
      totalRows: 0,
      updatedAt: now,
    });
    store.highlights.set(p.id, {
      patternId: p.id,
      enabled: true,
      offsetY: 0.35,
      thickness: 3,
      width: 0,
      insetX: 24,
      color: "#e5484d",
      opacity: 0.3,
      animate: true,
      animationMs: 260,
    });
  }
  // Counters, seeded to cover the cases worth seeing side by side: one on, one
  // switched off, one on its target, and one that keeps its own total.
  store.counters = [
    {
      id: "c1",
      patternId: pdfId,
      name: "Lace repeat",
      target: 8,
      current: 0,
      enabled: true,
      excludedFromTotal: false,
      position: 0,
    },
    {
      id: "c2",
      patternId: pdfId,
      name: "Front",
      target: 340,
      current: 0,
      enabled: true,
      excludedFromTotal: false,
      position: 1,
    },
    {
      id: "c3",
      patternId: pdfId,
      name: "Sleeve",
      target: 180,
      current: 0,
      // Off, so the sidebar shows both states at once.
      enabled: false,
      excludedFromTotal: false,
      position: 2,
    },
    {
      id: "c4",
      patternId: pdfId,
      name: "Cast on",
      target: 0,
      current: 0,
      enabled: true,
      excludedFromTotal: true,
      position: 3,
    },
  ];
}

/**
 * The standard yarn weight table, mirroring `src-tauri/src/yarn.rs`.
 *
 * The harness reimplements the derivation rather than importing the app's
 * code, because the point of the stub is to stand in for the backend. It is
 * kept deliberately small and honest: if the two ever disagree the frontend
 * tests are measuring the wrong thing, which is why the metre bands and the
 * ordering are spelled out here.
 */
const YARN_FAMILIES = [
  ["lace", "Lace", 200, Infinity],
  ["fingering", "Fingering", 170, 200],
  ["sport", "Sport", 120, 170],
  ["dk", "DK", 100, 120],
  ["worsted", "Worsted", 80, 100],
  ["aran", "Aran", 60, 80],
  ["bulky", "Bulky", 40, 60],
  ["chunky", "Chunky", 30, 40],
  ["super-chunky", "Super chunky", 20, 30],
  ["jumbo", "Jumbo", 0, 20],
];

const YARN_KEYWORDS = [
  ["super chunky", "super-chunky"],
  ["super-chunky", "super-chunky"],
  ["super bulky", "super-chunky"],
  ["double knit", "dk"],
  ["sock weight", "fingering"],
  ["4-ply", "worsted"],
  ["4 ply", "worsted"],
  ["3-ply", "chunky"],
  ["2-ply", "super-chunky"],
  ["2 ply", "super-chunky"],
  ["afghan", "worsted"],
  ["fingering", "fingering"],
  ["finger", "fingering"],
  ["worsted", "worsted"],
  ["chunky", "chunky"],
  ["bulky", "bulky"],
  ["sport", "sport"],
  ["jumbo", "jumbo"],
  ["thread", "lace"],
  ["cobweb", "lace"],
  ["lace", "lace"],
  ["aran", "aran"],
  ["dk", "dk"],
];

function yarnFamily(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower.trim()) return "";
  for (const [word, family] of YARN_KEYWORDS) {
    const re = new RegExp(`(^|[^a-z0-9])${word.replace(/[-]/g, "\\-")}([^a-z0-9]|$)`);
    if (re.test(lower)) return family;
  }
  const m = lower.match(/(\d+(?:\.\d+)?)\s*m(?:etres|eters|trs)?\s*(?:\/|\s*per\s*)100\s*g/);
  if (m) {
    const metres = Math.round(parseFloat(m[1]));
    const row = YARN_FAMILIES.find(([, , min, max]) => metres >= min && metres < max);
    if (row) return row[0];
  }
  return "";
}

/**
 * Returns fixture bytes as an ArrayBuffer, matching what the real commands
 * send back. They are raw payloads, not JSON arrays of numbers, and the
 * harness has to exercise the same shape or it hides the cost the raw form
 * was introduced to avoid.
 */
async function fetchFixture(name) {
  const res = await fetch(`/fixtures/${name}`);
  if (!res.ok) throw new Error(`fixture ${name} not found (${res.status})`);
  return res.arrayBuffer();
}

/** One counter's new count, held inside its own limits, as the backend does. */
function clampCount(current, delta, target) {
  return target > 0
    ? Math.min(Math.max(current + delta, 0), target)
    : Math.max(current + delta, 0);
}

function newProgress(patternId) {
  return { patternId, totalRows: 0, updatedAt: Date.now() };
}

function requireCounter(id) {
  const c = store.counters.find((x) => x.id === id);
  if (!c) throw new Error(`no counter with id ${id}`);
  return c;
}

/** The whole counting state, as `count_rows` returns it. */
function outcome(patternId) {
  const pr = store.progress.get(patternId) || newProgress(patternId);
  store.progress.set(patternId, pr);
  return {
    patternId,
    totalRows: pr.totalRows,
    counters: clone(store.counters.filter((c) => c.patternId === patternId)
      .sort((a, b) => a.position - b.position)),
  };
}
const handlers = {
  list_patterns: ({ filter }) => {
    let out = store.patterns.slice();
    if (filter?.search) {
      const t = filter.search.toLowerCase();
      out = out.filter(
        (p) =>
          p.title.toLowerCase().includes(t) ||
          p.designer.toLowerCase().includes(t) ||
          p.notes.toLowerCase().includes(t) ||
          JSON.stringify(p.tags).toLowerCase().includes(t),
      );
    }
    if (filter?.status) out = out.filter((p) => p.status === filter.status);
    if (filter?.difficulty) out = out.filter((p) => p.difficulty === filter.difficulty);
    if (filter?.needleSize) out = out.filter((p) => p.needleSize === filter.needleSize);
    if (filter?.designer) out = out.filter((p) => p.designer === filter.designer);
    // Several weights mean "any of these", matching the SQL IN (...) the real
    // backend builds.
    if (filter?.yarnWeight?.length) {
      out = out.filter((p) => filter.yarnWeight.includes(yarnFamily(p.yarnWeight)));
    }
    if (filter?.tags?.length) {
      out = out.filter((p) => filter.tags.every((t) => p.tags.includes(t)));
    }
    return clone(out);
  },
  get_pattern: ({ id }) => clone(store.patterns.find((p) => p.id === id)),
  update_pattern: ({ pattern }) => {
    const i = store.patterns.findIndex((p) => p.id === pattern.id);
    // The family is derived on write by the real backend, not sent by the
    // client, so it is re-derived here. Otherwise a corrected weight would
    // keep filtering under the old family.
    const next = clone(pattern);
    next.yarnWeightFamily = yarnFamily(next.yarnWeight);
    store.patterns[i] = next;
    return clone(store.patterns[i]);
  },
  delete_pattern: ({ id }) => {
    store.patterns = store.patterns.filter((p) => p.id !== id);
  },
  get_facets: () => ({
    designers: [...new Set(store.patterns.map((p) => p.designer).filter(Boolean))].sort(),
    needleSizes: [...new Set(store.patterns.map((p) => p.needleSize).filter(Boolean))].sort(),
    // Every family is listed whether or not it is used, in table order, so the
    // sidebar reads the same way it does in the real app.
    yarnWeights: YARN_FAMILIES.map(([key, label]) => ({
      key,
      label,
      count: store.patterns.filter((p) => yarnFamily(p.yarnWeight) === key).length,
    })),
    tags: [...new Set(store.patterns.flatMap((p) => p.tags))].sort(),
  }),
  save_position: ({ id, page, scroll }) => {
    const p = store.patterns.find((x) => x.id === id);
    if (p) {
      p.lastPage = page;
      p.lastScroll = scroll;
    }
  },
  read_file: async ({ id }) => {
    const p = store.patterns.find((x) => x.id === id);
    if (p.fileName === "long-pattern.pdf") return fetchFixture("long-pattern.pdf");
    if (p.fileName === "scanned-pattern.pdf") return fetchFixture("scanned-pattern.pdf");
    return fetchFixture(p.format === "epub" ? "sample-pattern.epub" : "sample-pattern.pdf");
  },
  // ---------- counters ----------
  //
  // The clamping and the "total always counts" rule live in the Rust data
  // layer, so the stub reimplements them rather than faking the result. A stub
  // that returned the wrong numbers would let the counting rules drift
  // untested on the frontend side.
  // The real `list_counters` returns a plain array; only the counting commands
  // return the whole outcome.
  list_counters: ({ patternId }) =>
    clone(store.counters.filter((c) => c.patternId === patternId).sort((a, b) => a.position - b.position)),
  add_counter: ({ patternId, input }) => {
    const c = {
      id: `c${store.nextId++}`,
      patternId,
      name: input.name,
      target: input.target,
      current: 0,
      enabled: input.enabled,
      excludedFromTotal: input.excludedFromTotal,
      position: store.counters.filter((x) => x.patternId === patternId).length,
    };
    store.counters.push(c);
    return clone(c);
  },
  update_counter: ({ id, name, target, excludedFromTotal }) => {
    const c = requireCounter(id);
    Object.assign(c, { name, target, excludedFromTotal });
  },
  set_counter_enabled: ({ patternId, id, enabled }) => {
    requireCounter(id).enabled = enabled;
    return outcome(patternId);
  },
  count_rows: ({ patternId, delta }) => {
    const pr = store.progress.get(patternId) || newProgress(patternId);
    // The total always moves, whatever any counter does.
    pr.totalRows = Math.max(0, pr.totalRows + delta);
    for (const c of store.counters) {
      if (c.patternId !== patternId || !c.enabled) continue;
      c.current = clampCount(c.current, delta, c.target);
    }
    return outcome(patternId);
  },
  count_counter: ({ id, delta }) => {
    const c = requireCounter(id);
    const pr = store.progress.get(c.patternId) || newProgress(c.patternId);
    const next = clampCount(c.current, delta, c.target);
    const applied = next - c.current;
    c.current = next;
    if (!c.excludedFromTotal) pr.totalRows = Math.max(0, pr.totalRows + applied);
    return outcome(c.patternId);
  },
  reset_counter: ({ id }) => {
    requireCounter(id).current = 0;
  },
  delete_counter: ({ id }) => {
    store.counters = store.counters.filter((c) => c.id !== id);
  },
  get_progress: ({ patternId }) => {
    if (!store.progress.has(patternId)) store.progress.set(patternId, newProgress(patternId));
    return clone(store.progress.get(patternId));
  },
  set_total_rows: ({ patternId, total }) => {
    const pr = store.progress.get(patternId) || newProgress(patternId);
    pr.totalRows = Math.max(0, total);
    return clone(pr);
  },
  get_highlight: ({ patternId }) => clone(store.highlights.get(patternId)),
  save_highlight: ({ settings }) => {
    store.highlights.set(settings.patternId, clone(settings));
    return clone(settings);
  },

  // ---------- covers ----------
  set_cover: ({ patternId, bytes }) => {
    const p = store.patterns.find((x) => x.id === patternId);
    if (p) p.coverPath = `cover-${patternId}.jpg`;
    store.covers.set(patternId, bytes);
    return { patternId, fileName: p?.coverPath || "", bytes, mime: "image/jpeg" };
  },
  get_cover: ({ patternId }) => {
    const bytes = store.covers.get(patternId);
    if (!bytes) throw new Error("This pattern has no cover.");
    // Raw bytes, as the real command returns them.
    return Uint8Array.from(bytes).buffer;
  },
  remove_cover: ({ patternId }) => {
    store.covers.delete(patternId);
    const p = store.patterns.find((x) => x.id === patternId);
    if (p) p.coverPath = "";
  },
  patterns_missing_covers: () =>
    store.patterns.filter((p) => !p.coverPath).map((p) => p.id),

  // ---------- AI metadata ----------
  get_ai_settings: () => {
    if (!store.aiSettings) {
      store.aiSettings = {
        baseUrl: "https://gen2.zeroval.eu/v1",
        model: "Qwen3.6-27B",
        fallbackModel: "Qwen3.6-27B",
        hasApiKey: false,
        isLocal: false,
        applyAutomatically: true,
        skipExisting: true,
        maxCharacters: 4000,
        reasoningEffort: "low",
        rescanExisting: false,
      };
    }
    return clone(store.aiSettings);
  },
  save_ai_settings: ({ settings, apiKey }) => {
    store.aiSettings = { ...settings, hasApiKey: !!(apiKey || settings.hasApiKey) };
    if (apiKey) store.apiKey = apiKey;
    return clone(store.aiSettings);
  },
  test_ai_connection: () => ({
    ok: true,
    modelCount: 2,
    models: [
      { id: "Qwen3.6-27B", label: "Qwen3.6-27B" },
      { id: "Qwen3.8-27B", label: "Qwen3.8-27B" },
    ],
  }),
  suggest_metadata: ({ patternId, excerpt, images }) => {
    const p = store.patterns.find((x) => x.id === patternId);
    if (!p) throw new Error("not found");
    // Record what the frontend actually sent, so the image fallback can be
    // checked without a model server: a scan should arrive as pictures, and a
    // readable pattern should arrive as text and nothing else.
    store.lastAiRequest = {
      patternId,
      excerptLength: (excerpt || "").trim().length,
      images: (images || []).length,
      imageBytes: (images || []).reduce((n, i) => n + i.length, 0),
    };
    const before = clone(p);
    const skip = store.aiSettings?.skipExisting !== false;
    const suggestion = {
      designer: "Jess Leslie",
      difficulty: "intermediate",
      needleSize: "2.25mm",
      yarn: "Shetland wool",
      tags: ["lace", "socks", "chart"],
      summary: "A fine gauge lace sock worked from a chart.",
    };
    const after = clone(p);
    if (!skip || !after.designer) after.designer = suggestion.designer;
    if (!skip || !after.difficulty) after.difficulty = suggestion.difficulty;
    if (!skip || !after.needleSize) after.needleSize = suggestion.needleSize;
    if (!after.tags.length) after.tags = [...suggestion.tags];
    if (!after.notes) after.notes = `Yarn: ${suggestion.yarn}`;

    const changed = [];
    if (before.designer !== after.designer) changed.push("Designer");
    if (before.difficulty !== after.difficulty) changed.push("Difficulty");
    if (before.needleSize !== after.needleSize) changed.push("Needle size");
    if (JSON.stringify(before.tags) !== JSON.stringify(after.tags)) changed.push("Tags");
    if (before.notes !== after.notes) changed.push("Yarn");

    let applied = false;
    if (store.aiSettings?.applyAutomatically !== false && changed.length) {
      const i = store.patterns.findIndex((x) => x.id === patternId);
      store.patterns[i] = clone(after);
      store.aiHistory.set(patternId, { before, after: clone(after) });
      applied = true;
    }
    return {
      patternId,
      patternTitle: p.title,
      failed: false,
      error: "",
      suggestion,
      before,
      after,
      changedFields: changed,
      applied,
    };
  },
  apply_suggestion: ({ patternId, after }) => {
    const i = store.patterns.findIndex((x) => x.id === patternId);
    const before = clone(store.patterns[i]);
    const merged = clone(store.patterns[i]);
    for (const f of ["designer", "difficulty", "needleSize", "notes"]) merged[f] = after[f];
    merged.tags = after.tags;
    store.patterns[i] = merged;
    store.aiHistory.set(patternId, { before, after: clone(merged) });
    return clone(merged);
  },
  undo_last_ai_change: ({ patternId }) => {
    const entry = store.aiHistory.get(patternId);
    if (!entry) return null;
    const i = store.patterns.findIndex((x) => x.id === patternId);
    store.patterns[i] = clone(entry.before);
    return clone(entry.before);
  },
  has_ai_history: ({ patternId }) => store.aiHistory.has(patternId),
  clear_ai_history: ({ patternId }) => {
    store.aiHistory.delete(patternId);
  },

  add_pattern: ({ input }) => {
    const id = `p${store.nextId++}`;
    const p = {
      id,
      title: input.title,
      designer: input.designer,
      filePath: `library/originals/${id}`,
      fileName: input.fileName,
      format: (input.sourcePath || input.fileName).toLowerCase().endsWith(".epub") ? "epub" : "pdf",
      status: input.status,
      difficulty: input.difficulty,
      needleSize: input.needleSize,
      yarnWeight: input.yarnWeight || "",
      yarnWeightFamily: yarnFamily(input.yarnWeight),
      tags: input.tags,
      notes: input.notes,
      addedAt: Date.now(),
      lastOpenedAt: null,
      lastPage: 0,
      lastScroll: 0,
      coverPath: "",
    };
    store.patterns.push(p);
    store.progress.set(id, { patternId: id, totalRows: 0, updatedAt: Date.now() });
    store.highlights.set(id, {
      patternId: id, enabled: true, offsetY: 0.35, thickness: 3, width: 0,
      insetX: 24, color: "#e5484d", opacity: 0.3, animate: true, animationMs: 260,
    });
    return clone(p);
  },
};

seed();

// Expose the store for assertions from the test driver.
window.__store = store;
window.__errors = [];

window.addEventListener("error", (e) => window.__errors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) =>
  window.__errors.push(String(e.reason?.message || e.reason)),
);

// Stand in for @tauri-apps/api/core's invoke.
window.__TAURI_INTERNALS__ = {
  invoke(cmd, args) {
    const handler = handlers[cmd];
    if (!handler) return Promise.reject(new Error(`no stub for command ${cmd}`));
    return Promise.resolve(handler(args || {}));
  },
  transformCallback(cb) {
    return cb;
  },
};

