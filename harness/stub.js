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
  pins: [],
  pinImages: new Map(),
  aiHistory: new Map(),
  aiSettings: null,
  updateSettings: null,
  apiKey: null,
  // Yarn stash. Photos share the `covers` blob store — yarn and pattern ids
  // never collide (`y…` vs `p…`).
  yarns: [],
  // Pseudo content hashes of added patterns, for the duplicate rule in
  // add_pattern (see below).
  contentHashes: new Map(),
  nextId: 1,
};

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- bulk add fixtures ----------
//
// A test seeds a fake folder tree with window.__seedFolder(path, entries),
// where entries are relative file names using "/" for nesting, and sets
// window.__nextDialogPick to the path the dialog should "return". The
// scan_pattern_folder handler below then mirrors the backend: .pdf/.epub only
// (case-insensitive), recursive, sorted by path. An unseeded path scans as
// empty.
const seededFolders = new Map();
window.__seedFolder = (path, entries) => {
  seededFolders.set(String(path).replace(/\/+$/, ""), entries.slice());
};
window.__nextDialogPick = null;

/**
 * A small deterministic string hash, used as a stand-in for the backend's
 * content hash. Note what it hashes: the source PATH, not the file's
 * contents, so the duplicate the stub can detect is same-path-twice. Real
 * content duplicates with different paths are the backend's job and are not
 * reproducible here.
 */
function pseudoHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

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
    ["Honeycomb Cardigan", "Elizabeth Zimmermann", "4.5mm", "beginner", ["colourwork", "socks"], "aran"],
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
  store.annotations = [];
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

  // The stash, seeded to cover the cases worth seeing side by side: a yarn
  // bought twice (two dye lots), a partial lot where the weighed grams are
  // less than balls × grams-per-ball, and one with no per-ball figures at
  // all, so the metres line has nothing to derive from. The derived totals
  // are computed on read (see withYarnTotals), as the backend does.
  store.yarns = [
    {
      id: "y1",
      name: "Shetland Sock",
      brand: "Jamieson's",
      colourway: "Peat",
      yarnWeight: "fingering",
      metresPerBall: 400,
      gramsPerBall: 100,
      photoPath: "",
      notes: "For colourwork yokes.",
      addedAt: now - 4000,
      lots: [
        { id: "l1", yarnId: "y1", dyeLot: "L42", balls: 3, gramsLeft: 300, location: "Cedar chest", boughtAt: now - 90 * 86400000 },
        { id: "l2", yarnId: "y1", dyeLot: "L57", balls: 2, gramsLeft: 200, location: "Cedar chest", boughtAt: now - 30 * 86400000 },
      ],
    },
    {
      id: "y2",
      name: "Merino DK",
      brand: "Cascade",
      colourway: "Heather",
      yarnWeight: "DK",
      metresPerBall: 220,
      gramsPerBall: 100,
      photoPath: "",
      notes: "",
      addedAt: now - 3000,
      lots: [
        // A partial lot: four balls bought, 240 g weighed left.
        { id: "l3", yarnId: "y2", dyeLot: "8042", balls: 4, gramsLeft: 240, location: "Under-bed box", boughtAt: null },
      ],
    },
    {
      id: "y3",
      name: "Handspun",
      brand: "",
      colourway: "Natural grey",
      yarnWeight: "handspun",
      metresPerBall: 0,
      gramsPerBall: 0,
      photoPath: "",
      notes: "Gift from Mo; no ball band.",
      addedAt: now - 2000,
      lots: [
        { id: "l4", yarnId: "y3", dyeLot: "", balls: 1, gramsLeft: 87, location: "Basket by the sofa", boughtAt: null },
      ],
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
  const m = lower.match(/(\d+(?:\.\d+)?)\s*m(?:etres|eters|trs)?\s*(?:\/|\s*per\s*|\s*at\s*)100\s*g/);
  if (m) {
    const metres = Math.round(parseFloat(m[1]));
    const row = YARN_FAMILIES.find(([, , min, max]) => metres >= min && metres < max);
    if (row) return row[0];
  }
  return "";
}

/**
 * The image format a byte sequence actually is, by magic number, mirroring
 * `covers.rs::sniff`: [extension, mime], or null for anything that is not a
 * recognised image.
 */
function sniffImage(bytes) {
  const starts = (sig) => sig.every((v, i) => bytes[i] === v);
  if (starts([0xff, 0xd8, 0xff])) return ["jpg", "image/jpeg"];
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ["png", "image/png"];
  // "GIF87a" / "GIF89a"
  if (starts([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || starts([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return ["gif", "image/gif"];
  }
  // "RIFF"...."WEBP"
  if (bytes.length > 12 && starts([0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return ["webp", "image/webp"];
  }
  // "BM"
  if (bytes.length > 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return ["bmp", "image/bmp"];
  return null;
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

/**
 * A stored yarn with the derived figures the backend computes on every read:
 * the family, the totals over the lots, and the metres left, which is weighed
 * grams scaled by the ball band — 0 when the per-ball figures are unknown.
 */
function withYarnTotals(yarn) {
  const out = clone(yarn);
  out.yarnWeightFamily = yarnFamily(yarn.yarnWeight);
  out.gramsLeft = out.lots.reduce((n, l) => n + (l.gramsLeft || 0), 0);
  out.ballsTotal = out.lots.reduce((n, l) => n + (l.balls || 0), 0);
  out.metresLeft =
    out.gramsPerBall > 0 && out.metresPerBall > 0
      ? Math.round((out.gramsLeft / out.gramsPerBall) * out.metresPerBall)
      : 0;
  return out;
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
    // The sort keys the library view offers, mirroring the ORDER BY the
    // backend builds (db/mod.rs); anything unrecognised is newest first.
    switch (filter?.sort) {
      case "title":
        out.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
        break;
      case "oldest":
        out.sort((a, b) => a.addedAt - b.addedAt);
        break;
      case "lastOpened":
        // DESC NULLS LAST: never-opened patterns sort after opened ones.
        out.sort((a, b) => {
          if (a.lastOpenedAt == null && b.lastOpenedAt == null) return 0;
          if (a.lastOpenedAt == null) return 1;
          if (b.lastOpenedAt == null) return -1;
          return b.lastOpenedAt - a.lastOpenedAt;
        });
        break;
      default:
        out.sort((a, b) => b.addedAt - a.addedAt);
    }
    return clone(out);
  },
  get_pattern: ({ id }) => {
    const p = store.patterns.find((x) => x.id === id);
    // The backend's NotFound serialises as this string; a missing row is an
    // error there, not a null.
    if (!p) throw new Error(`pattern not found: ${id}`);
    return clone(p);
  },
  update_pattern: ({ pattern }) => {
    const i = store.patterns.findIndex((p) => p.id === pattern.id);
    if (i < 0) throw new Error(`pattern not found: ${pattern.id}`);
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
      // touch_pattern records the open as well as the position, which is what
      // the "recently read" sort reads.
      p.lastOpenedAt = Date.now();
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
  // ---------- annotations ----------
  //
  // An unknown kind is stored as a highlight and a missing id is an error,
  // matching the backend. A stub that accepted anything would let the frontend
  // save a mark the real app then refuses to draw.
  list_annotations: ({ patternId }) =>
    clone(
      store.annotations
        .filter((a) => a.patternId === patternId)
        .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt),
    ),
  add_annotation: ({ patternId, input }) => {
    const a = {
      id: `a${store.nextId++}`,
      patternId,
      kind: ["highlight", "note", "draw"].includes(input.kind) ? input.kind : "highlight",
      page: Math.max(1, input.page || 1),
      geometry: input.geometry || "[]",
      quote: input.quote || "",
      occurrence: input.occurrence || 0,
      color: input.color || "#e5484d",
      text: input.text || "",
      createdAt: Date.now(),
    };
    store.annotations.push(a);
    return clone(a);
  },
  edit_annotation: ({ id, text, color }) => {
    const a = store.annotations.find((x) => x.id === id);
    if (!a) throw new Error("no annotation with that id");
    a.text = text;
    a.color = color;
  },
  delete_annotation: ({ id }) => {
    const before = store.annotations.length;
    store.annotations = store.annotations.filter((a) => a.id !== id);
    if (store.annotations.length === before) throw new Error("no annotation with that id");
  },

  // ---------- pins ----------
  //
  // The five-pin limit, the empty-crop refusal and the placement clamping all
  // live in the backend. A stub that skipped them would let the frontend look
  // right here and then fail against the real thing, which is the whole reason
  // this stub mirrors the rules rather than just the shapes.
  list_pins: ({ patternId }) =>
    // Highest z first, so the pin just made is the one on top.
    clone(store.pins.filter((p) => p.patternId === patternId).sort((a, b) => b.z - a.z)),
  pin_count: ({ patternId }) => store.pins.filter((p) => p.patternId === patternId).length,
  add_pin: ({ patternId, input }) => {
    if (store.pins.filter((p) => p.patternId === patternId).length >= 5) {
      throw new Error("This pattern already has 5 pins. Remove one before adding another.");
    }
    if (!input.imageBytes || input.imageBytes.length === 0) {
      throw new Error("There was nothing to pin.");
    }
    const id = `pin${store.nextId++}`;
    const pin = {
      id,
      patternId,
      page: Math.max(1, input.page || 1),
      geometry: input.geometry || "[]",
      quote: input.quote || "",
      title: input.title || "",
      offsetX: 0.72,
      offsetY: 0.18,
      width: 0.24,
      hidden: false,
      // Above this pattern's existing pins; other patterns' z values are
      // irrelevant, as in the backend's MAX(z) ... WHERE pattern_id.
      z: store.pins
        .filter((p) => p.patternId === patternId)
        .reduce((top, p) => Math.max(top, p.z), -1) + 1,
      imageFile: `${id}.jpg`,
      createdAt: Date.now(),
    };
    store.pins.push(pin);
    store.pinImages.set(id, input.imageBytes);
    return clone(pin);
  },
  update_pin: ({ id, placement }) => {
    const pin = store.pins.find((p) => p.id === id);
    if (!pin) throw new Error("no pin with that id");
    // Clamped exactly as the command does, so a card dragged off the pane
    // comes back to the same place here as it does in the app.
    pin.offsetX = Math.min(0.98, Math.max(0, placement.offsetX));
    pin.offsetY = Math.min(0.98, Math.max(0, placement.offsetY));
    pin.width = Math.min(0.9, Math.max(0.1, placement.width));
    pin.hidden = !!placement.hidden;
    return clone(pin);
  },
  rename_pin: ({ id, title }) => {
    const pin = store.pins.find((p) => p.id === id);
    if (!pin) throw new Error("no pin with that id");
    pin.title = (title || "").trim();
  },
  delete_pin: ({ id }) => {
    const before = store.pins.length;
    store.pins = store.pins.filter((p) => p.id !== id);
    if (store.pins.length === before) throw new Error("no pin with that id");
    store.pinImages.delete(id);
  },
  get_pin_image: ({ id }) => {
    const bytes = store.pinImages.get(id);
    if (!bytes) throw new Error("This pin has no image.");
    return Uint8Array.from(bytes).buffer;
  },

  get_highlight: ({ patternId }) => {
    const h = store.highlights.get(patternId);
    if (!h) throw new Error(`pattern not found: ${patternId}`);
    return clone(h);
  },
  save_highlight: ({ settings }) => {
    store.highlights.set(settings.patternId, clone(settings));
    return clone(settings);
  },

  // ---------- covers ----------
  //
  // Content is checked rather than trusted, as covers.rs does: a renamed
  // script must be refused, and the reported mime comes from the magic bytes.
  set_cover: ({ patternId, bytes }) => {
    if (!bytes || bytes.length === 0) throw new Error("That file is empty.");
    if (bytes.length > 20 * 1024 * 1024) {
      throw new Error("That image is too large to be a cover (limit 20 MB).");
    }
    const found = sniffImage(bytes);
    if (!found) throw new Error("That file does not look like an image.");
    const [ext, mime] = found;
    const fileName = `${patternId}.${ext}`;
    const p = store.patterns.find((x) => x.id === patternId);
    if (p) p.coverPath = fileName;
    store.covers.set(patternId, bytes);
    return { patternId, fileName, bytes, mime };
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

  // ---------- yarn stash ----------
  //
  // The lot reconcile, the family derivation and the cascade delete live in
  // the backend, so the stub reimplements them rather than trusting what it
  // is sent. A stored lot keeps only what the backend owns; derived figures
  // and ids are recomputed here.
  list_yarns: ({ filter }) => {
    let out = store.yarns.slice();
    if (filter?.search) {
      const t = filter.search.toLowerCase();
      out = out.filter(
        (y) =>
          y.name.toLowerCase().includes(t) ||
          y.brand.toLowerCase().includes(t) ||
          y.colourway.toLowerCase().includes(t) ||
          y.notes.toLowerCase().includes(t),
      );
    }
    // Several families mean "any of these", as in list_patterns.
    if (filter?.yarnWeight?.length) {
      out = out.filter((y) => filter.yarnWeight.includes(yarnFamily(y.yarnWeight)));
    }
    out.sort((a, b) => b.addedAt - a.addedAt);
    return out.map(withYarnTotals);
  },
  get_yarn: ({ id }) => {
    const y = store.yarns.find((x) => x.id === id);
    // As with patterns: a missing row is an error, not a null.
    if (!y) throw new Error(`yarn not found: ${id}`);
    return withYarnTotals(y);
  },
  add_yarn: ({ input }) => {
    const id = `y${store.nextId++}`;
    const y = {
      id,
      name: input.name,
      brand: input.brand || "",
      colourway: input.colourway || "",
      yarnWeight: input.yarnWeight || "",
      metresPerBall: input.metresPerBall || 0,
      gramsPerBall: input.gramsPerBall || 0,
      photoPath: "",
      notes: input.notes || "",
      addedAt: Date.now(),
      lots: (input.lots || []).map((lot) => ({
        id: `l${store.nextId++}`,
        yarnId: id,
        dyeLot: lot.dyeLot || "",
        balls: lot.balls || 0,
        gramsLeft: lot.gramsLeft || 0,
        location: lot.location || "",
        boughtAt: lot.boughtAt ?? null,
      })),
    };
    store.yarns.push(y);
    return withYarnTotals(y);
  },
  update_yarn: ({ yarn }) => {
    const i = store.yarns.findIndex((x) => x.id === yarn.id);
    if (i < 0) throw new Error(`yarn not found: ${yarn.id}`);
    const existing = store.yarns[i];
    // The lot reconcile: an id that comes back is kept, a stored lot missing
    // from the list is gone, and a lot without an id is new.
    const lots = (yarn.lots || []).map((lot) => ({
      id: lot.id || `l${store.nextId++}`,
      yarnId: yarn.id,
      dyeLot: lot.dyeLot || "",
      balls: lot.balls || 0,
      gramsLeft: lot.gramsLeft || 0,
      location: lot.location || "",
      boughtAt: lot.boughtAt ?? null,
    }));
    const next = {
      ...clone(yarn),
      lots,
      // addedAt and photoPath are the backend's, not the client's to rewrite.
      addedAt: existing.addedAt,
      photoPath: existing.photoPath,
    };
    // The store holds no derived fields; they are computed on read.
    delete next.yarnWeightFamily;
    delete next.gramsLeft;
    delete next.ballsTotal;
    delete next.metresLeft;
    store.yarns[i] = next;
    return withYarnTotals(next);
  },
  delete_yarn: ({ id }) => {
    store.yarns = store.yarns.filter((y) => y.id !== id);
    // The photo goes too, as deleting a pattern takes its cover.
    store.covers.delete(id);
  },
  yarn_facets: () =>
    // Every family in the table, whether or not it is used, in table order.
    YARN_FAMILIES.map(([key, label]) => ({
      key,
      label,
      count: store.yarns.filter((y) => yarnFamily(y.yarnWeight) === key).length,
    })),
  set_yarn_photo: ({ yarnId, bytes }) => {
    // Same rules as set_cover: content is checked, not trusted.
    if (!bytes || bytes.length === 0) throw new Error("That file is empty.");
    if (bytes.length > 20 * 1024 * 1024) {
      throw new Error("That image is too large to be a photo (limit 20 MB).");
    }
    const found = sniffImage(bytes);
    if (!found) throw new Error("That file does not look like an image.");
    const y = store.yarns.find((x) => x.id === yarnId);
    if (!y) throw new Error(`yarn not found: ${yarnId}`);
    const [ext, mime] = found;
    const fileName = `${yarnId}.${ext}`;
    y.photoPath = fileName;
    store.covers.set(yarnId, bytes);
    return { yarnId, fileName, bytes, mime };
  },
  get_yarn_photo: ({ yarnId }) => {
    const bytes = store.covers.get(yarnId);
    if (!bytes) throw new Error("This yarn has no photo.");
    // Raw bytes, as the real command returns them.
    return Uint8Array.from(bytes).buffer;
  },
  remove_yarn_photo: ({ yarnId }) => {
    store.covers.delete(yarnId);
    const y = store.yarns.find((x) => x.id === yarnId);
    if (y) y.photoPath = "";
  },

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
      yarnWeight: "fingering",
      yarn: "Shetland wool",
      tags: ["lace", "socks", "chart"],
      summary: "A fine gauge lace sock worked from a chart.",
    };
    // The merge below mirrors ai::metadata::apply_to exactly: with skipExisting
    // on, a field the user already filled in is left alone; the yarn line and
    // the tags are merged regardless, because they lose nothing.
    const keepExisting = (current) => skip && String(current || "").trim() !== "";
    const after = clone(p);
    if (!keepExisting(p.designer) && suggestion.designer) after.designer = suggestion.designer;
    if (!keepExisting(p.difficulty) && suggestion.difficulty) after.difficulty = suggestion.difficulty;
    if (!keepExisting(p.needleSize) && suggestion.needleSize) after.needleSize = suggestion.needleSize;
    if (!keepExisting(p.yarnWeight) && suggestion.yarnWeight) {
      after.yarnWeight = suggestion.yarnWeight;
      // The family is derived, so it follows the weight rather than being
      // asked of the model.
      after.yarnWeightFamily = yarnFamily(suggestion.yarnWeight);
    }
    // Yarn is folded into the notes, below anything already there.
    if (suggestion.yarn && !p.notes.includes(suggestion.yarn)) {
      after.notes = after.notes.trim() === ""
        ? `Yarn: ${suggestion.yarn}`
        : `${after.notes.trimEnd()}\nYarn: ${suggestion.yarn}`;
    }
    // Tags are a set, not a value: merge rather than replace, so a tag the
    // user added is never lost.
    if (suggestion.tags.length) {
      const merged = [...after.tags];
      for (const tag of suggestion.tags) {
        if (!merged.some((t) => t.toLowerCase() === tag.toLowerCase())) merged.push(tag);
      }
      merged.sort();
      after.tags = [...new Set(merged)];
    }
    // The summary becomes the notes only when there is nothing there yet.
    if (suggestion.summary && !after.notes.includes(suggestion.summary.trim()) &&
      after.notes.trim() === "") {
      after.notes = suggestion.summary;
    }

    // Mirrors ai::metadata::changed_fields, including naming a notes change by
    // what caused it.
    const changed = [];
    if (before.designer !== after.designer) changed.push("Designer");
    if (before.difficulty !== after.difficulty) changed.push("Difficulty");
    if (before.needleSize !== after.needleSize) changed.push("Needle size");
    if (before.yarnWeight !== after.yarnWeight) changed.push("Yarn weight");
    if (JSON.stringify(before.tags) !== JSON.stringify(after.tags)) changed.push("Tags");
    if (before.notes !== after.notes) {
      changed.push(
        after.notes.includes("Yarn:") && !before.notes.includes("Yarn:") ? "Yarn" : "Summary",
      );
    }

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
    const current = clone(store.patterns[i]);
    const restored = clone(entry.before);
    // The restore is written through the same path as any update, so the
    // family is re-derived as the backend's update_pattern does.
    restored.yarnWeightFamily = yarnFamily(restored.yarnWeight);
    store.patterns[i] = restored;
    // Restoring is itself a change and gets its own undo point (commands.rs),
    // so a second undo re-applies the AI change rather than doing nothing.
    store.aiHistory.set(patternId, { before: current, after: clone(restored) });
    return clone(restored);
  },
  has_ai_history: ({ patternId }) => store.aiHistory.has(patternId),
  clear_ai_history: ({ patternId }) => {
    store.aiHistory.delete(patternId);
  },

  // ---------- updates ----------
  //
  // Test fixtures, all on window: __nextUpdate drives check_for_update (null =
  // up to date, an object = the update payload, { error } = reject with that
  // message), and __startupUpdate drives startup_update_check the same way,
  // except unset means the check was skipped. __lastUpdateCheckBeta records
  // the includeBeta a check was run with, and __installedUpdate the installer
  // path install_update was handed.
  get_update_settings: () => {
    if (!store.updateSettings) {
      store.updateSettings = { includeBeta: false, checkOnStartup: true };
    }
    return { ...clone(store.updateSettings), currentVersion: "0.2.1" };
  },
  save_update_settings: (args) => {
    const s = args.settings ?? args;
    store.updateSettings = { includeBeta: !!s.includeBeta, checkOnStartup: !!s.checkOnStartup };
  },
  check_for_update: ({ includeBeta }) => {
    window.__lastUpdateCheckBeta = !!includeBeta;
    const next = window.__nextUpdate ?? null;
    if (next && next.error) throw new Error(next.error);
    return { currentVersion: "0.2.1", checkedAt: Date.now(), update: next ? clone(next) : null };
  },
  startup_update_check: () => {
    const next = window.__startupUpdate ?? null;
    if (!next) return { skipped: true, currentVersion: null, checkedAt: null, update: null };
    if (next.error) throw new Error(next.error);
    return { skipped: false, currentVersion: "0.2.1", checkedAt: Date.now(), update: clone(next) };
  },
  download_update: () => "C:\\Temp\\ShinyKnitting-update-setup.exe",
  install_update: ({ path }) => {
    window.__installedUpdate = path;
  },

  // ---------- bulk add ----------
  //
  // The dialog plugin's open command. Returns whatever the test set on
  // window.__nextDialogPick (a string path, an array, or null for cancel);
  // the default is a cancelled dialog.
  "plugin:dialog|open": () => window.__nextDialogPick ?? null,
  scan_pattern_folder: ({ path }) => {
    const base = String(path || "").replace(/\/+$/, "");
    const entries = seededFolders.get(base) || [];
    return entries
      .filter((rel) => /\.(pdf|epub)$/i.test(rel))
      .map((rel) => ({ path: `${base}/${rel}`, fileName: rel.split("/").pop() }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  },

  add_pattern: async ({ input }) => {
    // A real macrotask pause per add, so a bulk run yields between items and a
    // click on the panel's Stop button is processed mid-run rather than after
    // the last file — without this, a fast stub makes Stop untestable.
    await new Promise((r) => setTimeout(r, 20));
    // A source path is authoritative about the file's name, as the backend is.
    let fileName = input.fileName;
    if (input.sourcePath && input.sourcePath.trim()) {
      fileName = input.sourcePath.split(/[\\/]/).pop() || fileName;
    }
    const dot = fileName.lastIndexOf(".");
    const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
    if (ext !== "pdf" && ext !== "epub") {
      throw new Error(
        `could not determine the file type for .${ext} (only pdf and epub are supported)`,
      );
    }
    // The duplicate rule, mirroring the backend's content-duplicate rejection.
    // The hash is of the source path (see pseudoHash), so the duplicate case
    // reproducible here is adding the same path twice.
    const basis = input.sourcePath && input.sourcePath.trim()
      ? `path:${input.sourcePath}`
      : `bytes:${(input.bytes || []).length}`;
    const contentHash = pseudoHash(basis);
    const duplicate = store.contentHashes.get(contentHash);
    if (duplicate) throw new Error(`already in the library as "${duplicate}"`);
    const id = `p${store.nextId++}`;
    const p = {
      id,
      title: input.title,
      designer: input.designer,
      filePath: `library/originals/${id}.${ext}`,
      fileName,
      format: ext,
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
    store.contentHashes.set(contentHash, p.title);
    store.progress.set(id, { patternId: id, totalRows: 0, updatedAt: Date.now() });
    store.highlights.set(id, {
      patternId: id, enabled: true, offsetY: 0.35, thickness: 3, width: 0,
      insetX: 24, color: "#e5484d", opacity: 0.3, animate: true, animationMs: 260,
    });
    return clone(p);
  },
};

seed();

// Update fixtures, unset by default: no newer release, no startup update.
window.__nextUpdate = null;
window.__startupUpdate = null;
window.__installedUpdate = null;
window.__lastUpdateCheckBeta = null;

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

