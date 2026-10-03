import { WEIGHTS, familyOf } from "../src/views/yarn-weight";
import { sizesOf, mmLabel, usLabel } from "../src/views/needle-size";

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
  bookmarks: [],
  rotations: [],
  aiHistory: new Map(),
  aiSettings: null,
  updateSettings: null,
  apiKey: null,
  // Yarn stash. Photos share the `covers` blob store — yarn and pattern ids
  // never collide (`y…` vs `p…`).
  yarns: [],
  // Needles and hooks. `patternTitle` is not stored; it is joined in on read,
  // as the backend's LEFT JOIN does.
  tools: [],
  // Projects and what is on them, as the backend's three tables.
  projects: [],
  projectTools: [],
  projectYarns: [],
  // Boards' items, keyed by board: a project's id or an inspiration board's.
  // Pictures and covers share the `covers` blob store, under "board:<id>" and
  // "project:<id>".
  boardItems: [],
  inspirationBoards: [],
  // Shops and the wishlist. A wish's shop and project names are joined in on
  // read, as the backend's LEFT JOINs do.
  shops: [],
  wishes: [],
  // Gauge swatches. Photos share the `covers` blob store, under "swatch:<id>".
  swatches: [],
  // People and their measurement sets, as the backend's two tables.
  people: [],
  measurementSets: [],
  // Pseudo content hashes of added patterns, for the duplicate rule in
  // add_pattern (see below).
  contentHashes: new Map(),
  // Starts well past the seeded ids (p1…, y1…, l1…, pr1…), so an id made
  // here can never be one the seed already used.
  nextId: 1000,
};

const clone = (v) => JSON.parse(JSON.stringify(v));

/** annotations.rs::clean_title. */
const bookmarkTitle = (raw) => (String(raw ?? "").trim() || "Untitled").slice(0, 120);

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
      hotkey: "",
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
      hotkey: "",
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
      hotkey: "",
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
      hotkey: "",
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

  // Needles and hooks, seeded with one of each state worth seeing: on a
  // project from a pattern, on one without, and free, across kinds that each
  // keep different measurements.
  const tool = (id, fields) => ({
    id,
    kind: "circular",
    sizeMm: 0,
    lengthCm: 0,
    cableCm: 0,
    cableSize: "",
    brand: "",
    material: "",
    notes: "",
    addedAt: now,
    ...fields,
  });
  store.tools = [
    tool("t1", { kind: "dpn", sizeMm: 2.5, lengthCm: 20, brand: "HiyaHiya", material: "metal" }),
    tool("t2", { kind: "circular", sizeMm: 4, cableCm: 80, brand: "ChiaoGoo", material: "metal" }),
    tool("t3", { kind: "circular", sizeMm: 4, cableCm: 40, brand: "Addi", material: "bamboo" }),
    tool("t4", { kind: "hook", sizeMm: 5, lengthCm: 15, brand: "Clover", material: "aluminium" }),
    tool("t5", { kind: "tips", sizeMm: 3.5, lengthCm: 13, cableSize: "small", brand: "chiaogoo", material: "metal" }),
    tool("t6", { kind: "cable", cableCm: 60, cableSize: "small", brand: "ChiaoGoo" }),
  ];
  // Two active projects, as the backend's migration would make from needles
  // put on a pattern (t1) and on a project named in words (t2).
  store.projects = [
    { id: "pr1", name: "Featherweight Lace Sock", patternId: pdfId, status: "active", startedAt: now - 86400000 * 3, finishedAt: null, notes: "", createdAt: now - 86400000 * 3 },
    { id: "pr2", name: "Gift hat", patternId: null, status: "active", startedAt: now - 86400000, finishedAt: null, notes: "", createdAt: now - 86400000 },
  ];
  store.projectTools = [
    { projectId: "pr1", toolId: "t1", addedAt: now, releasedAt: null },
    { projectId: "pr2", toolId: "t2", addedAt: now, releasedAt: null },
  ];
  store.projectYarns = [];

  // Swatches: two in a stash yarn, on a needle from the box and on a size
  // only, one blocked; and one in a yarn not in the stash.
  const swatch = (id, fields) => ({
    id, yarnId: null, yarnText: "", toolId: null, needleMm: 0, stitch: "", sts: 0, rows: 0, stsBlocked: 0, rowsBlocked: 0,
    projectId: null, photoPath: "", notes: "", madeAt: now, addedAt: now, ...fields,
  });
  store.swatches = [
    swatch("sw1", { yarnId: "y1", toolId: "t1", needleMm: 2.5, stitch: "Stockinette", sts: 32, rows: 44, stsBlocked: 30, rowsBlocked: 42, madeAt: now - 86400000 * 20 }),
    swatch("sw2", { yarnId: "y1", needleMm: 3, stitch: "Garter", sts: 28, rows: 52, madeAt: now - 86400000 * 10 }),
    swatch("sw3", { yarnText: "Friend's merino", needleMm: 4, stitch: "Stockinette", sts: 22, rows: 30, madeAt: now - 86400000 * 400 }),
  ];

  // People: a child measured twice, a year apart, with one measurement of
  // her own, and the gift hat knitted for her; and someone not measured yet.
  const year = 365 * 86400000;
  store.people = [
    { id: "pe1", name: "Mo", notes: "Loves green. No mohair: it itches.", extra: ["Thumb length"], addedAt: now - 2 * year },
    { id: "pe2", name: "Anna", notes: "", extra: [], addedAt: now - 1000 },
  ];
  store.measurementSets = [
    { id: "ms1", personId: "pe1", measuredAt: now - year, values: { height: 110, chest: 58, head: 50, foot_length: 17 }, shoeSize: "EU 28" },
    { id: "ms2", personId: "pe1", measuredAt: now - 86400000, values: { height: 116, chest: 60, head: 51, foot_length: 18.5, "x:Thumb length": 4 }, shoeSize: "EU 30" },
    { id: "ms3", personId: "pe2", measuredAt: now - 1000, values: {}, shoeSize: "" },
  ];
  store.projects.find((p) => p.id === "pr2").personId = "pe1";

  // Shops: one with a comment worth searching, one on a subdomain-free site,
  // and one with no web address. The wishlist has one of each kind, one from
  // each state worth seeing: from a shop and for a project, from no shop,
  // and already got.
  store.shops = [
    { id: "s1", name: "Wolle Rödel", url: "https://www.wolle-roedel.com", comment: "Drops is the cheapest here.", tags: ["yarn", "Sale"], addedAt: now - 3000 },
    { id: "s2", name: "Deadstock Yarns", url: "https://deadstock.example.com", tags: ["yarn", "deadstock"], comment: "Great prices on deadstock.\nSlow to ship.", addedAt: now - 2000 },
    { id: "s3", name: "The yarn shop in town", url: "", comment: "Saturday mornings only.", tags: ["needles"], addedAt: now - 1000 },
  ];
  const wish = (id, fields) => ({
    id, kind: "yarn", name: "", brand: "", amount: "", price: "", url: "", shopId: null, projectId: null, notes: "", photoPath: "", gotAt: null, stashedAt: null, addedAt: now, ...fields,
  });
  store.wishes = [
    wish("w1", { name: "Drops Alpaca, light grey mix", amount: "6 balls", price: "€3.95 a ball", url: "https://www.wolle-roedel.com/drops-alpaca", shopId: "s1", projectId: "pr2", addedAt: now - 4000 }),
    wish("w2", { kind: "tool", name: "4 mm circular, 60 cm", notes: "For sleeves", addedAt: now - 3000 }),
    wish("w3", { kind: "pattern", name: "Ankers Summer Shirt", url: "https://example.com/ankers", addedAt: now - 2000 }),
    wish("w4", { name: "Merino leftovers", shopId: "s2", gotAt: now - 86400000 * 5, addedAt: now - 86400000 * 9 }),
  ];
}

// The rules of `tools::clean`, so the harness refuses what the app would.
const TOOL_KINDS = ["straight", "circular", "dpn", "tips", "cable", "hook"];
const TOOL_MATERIALS = ["metal", "aluminium", "steel", "copper", "bamboo", "wood", "carbon", "plastic", "other"];
// A known material by its key, whatever its case; anything else as typed.
const toolMaterial = (v) => {
  const typed = String(v || "").split(/\s+/).filter(Boolean).join(" ");
  const aliases = { aluminum: "aluminium", "stainless steel": "steel", "carbon fibre": "carbon", "carbon fiber": "carbon" };
  const lower = aliases[typed.toLowerCase()] ?? typed.toLowerCase();
  return TOOL_MATERIALS.includes(lower) ? lower : typed.slice(0, 40);
};
const CABLE_SIZES = ["mini", "small", "standard", "large"];
function cleanTool(input) {
  const kind = String(input.kind || "").trim().toLowerCase();
  if (!TOOL_KINDS.includes(kind)) throw new Error("Choose what kind of needle or hook this is.");
  const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
  const measure = (v, places, max, what, unit) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n < 0) throw new Error(`The ${what} has to be a number of ${unit}.`);
    if (n > max) throw new Error(`${n} ${unit} is more than any ${what} — is it in the right unit?`);
    return round(n, places);
  };
  const oneOf = (v, allowed, what) => {
    const w = String(v || "").trim().toLowerCase();
    if (w && !allowed.includes(w)) throw new Error(`“${String(v).trim()}” is not a ${what} this knows.`);
    return w;
  };
  let sizeMm = 0;
  if (kind !== "cable") {
    sizeMm = measure(input.sizeMm, 2, 50, "size", "mm");
    if (sizeMm <= 0) throw new Error("Give the size in millimetres, e.g. 4 or 3.75.");
  }
  const projectId = input.projectId && String(input.projectId).trim() ? String(input.projectId).trim() : null;
  return {
    kind,
    sizeMm,
    lengthCm: ["straight", "dpn", "tips", "hook"].includes(kind) ? measure(input.lengthCm, 1, 200, "length", "cm") : 0,
    cableCm: ["circular", "cable"].includes(kind) ? measure(input.cableCm, 1, 500, "cable length", "cm") : 0,
    cableSize: ["tips", "cable"].includes(kind) ? oneOf(input.cableSize, CABLE_SIZES, "cable size") : "",
    brand: String(input.brand || "").trim().slice(0, 80),
    material: toolMaterial(input.material),
    projectId,
    notes: String(input.notes || ""),
  };
}
// The rules of `shopping::clean_shop` and `clean_wish`.
const WISH_KINDS = ["yarn", "tool", "pattern", "other"];
/** `shopping::web_address`: https:// added when missing, anything but http(s) refused. */
function webAddress(value) {
  const typed = String(value || "").trim();
  if (!typed) return "";
  const refuse = () => new Error(`“${typed.slice(0, 60)}” is not a web address. Give one like https://www.drops.com, or drops.com.`);
  if (/[\s\x00-\x1f]/.test(typed) || typed.length > 2000) throw refuse();
  let url;
  if (/^https?:\/\//i.test(typed)) url = typed.replace(/^[a-z]+/i, (m) => m.toLowerCase());
  else if (typed.includes("://") || /^[a-z][a-z0-9+-]*:/i.test(typed)) throw refuse();
  else url = `https://${typed.replace(/^\/+/, "")}`;
  const host = url.split("://")[1].split(/[/?#]/)[0].split("@").pop().split(":")[0];
  if (!host.includes(".")) throw refuse();
  return url;
}
const oneLine = (v, max) => String(v || "").split(/\s+/).filter(Boolean).join(" ").slice(0, max);
function cleanShop(input) {
  const url = webAddress(input.url);
  let name = oneLine(input.name, 120);
  if (!name && url) name = url.split("://")[1].split(/[/?#:]/)[0].toLowerCase().replace(/^www\./, "");
  if (!name) throw new Error("Give the shop a name, or its web address.");
  const tags = [];
  for (const raw of input.tags || []) {
    const tag = oneLine(String(raw).trim().replace(/^#+/, ""), 40);
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  return { name, url, comment: String(input.comment || "").trim().slice(0, 4000), tags: tags.slice(0, 30) };
}
function cleanWish(input) {
  const kind = String(input.kind || "").trim().toLowerCase();
  if (!WISH_KINDS.includes(kind)) throw new Error("Choose what kind of thing this is.");
  const name = oneLine(input.name, 200);
  if (!name) throw new Error("Say what it is you want to get.");
  const link = (v) => (v && String(v).trim() ? String(v).trim() : null);
  const out = {
    kind,
    name,
    brand: oneLine(input.brand, 80),
    amount: oneLine(input.amount, 80),
    price: oneLine(input.price, 80),
    url: webAddress(input.url),
    shopId: link(input.shopId),
    projectId: link(input.projectId),
    notes: String(input.notes || "").trim().slice(0, 4000),
  };
  if (out.shopId && !store.shops.some((x) => x.id === out.shopId)) throw new Error("That shop is no longer there.");
  if (out.projectId && !store.projects.some((x) => x.id === out.projectId)) throw new Error("That project is no longer there.");
  return out;
}
/** A shop as the backend returns it, with how many wanted things are to be got there. */
function shopOut(sh) {
  return clone({ ...sh, wanted: store.wishes.filter((w) => w.shopId === sh.id && w.gotAt === null).length });
}
/** A wish as the backend returns it, its shop's and project's names joined in. */
function wishOut(w) {
  const sh = store.shops.find((x) => x.id === w.shopId);
  const pr = store.projects.find((x) => x.id === w.projectId);
  return clone({ ...w, shopName: sh?.name ?? "", shopUrl: sh?.url ?? "", projectName: pr?.name ?? "" });
}

// The rules of `swatches::clean`.
function cleanSwatch(input) {
  const link = (v) => (v && String(v).trim() ? String(v).trim() : null);
  const count = (v, what) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n < 0) throw new Error(`The ${what} have to be a number.`);
    if (n > 150) throw new Error(`${n} ${what} in 10 cm is more than any swatch has — count over 10 cm only.`);
    return Math.round(n * 10) / 10;
  };
  const yarnId = link(input.yarnId);
  const toolId = link(input.toolId);
  const toolSize = toolId ? store.tools.find((t) => t.id === toolId)?.sizeMm : 0;
  const needle = toolSize > 0 ? toolSize : Number(input.needleMm || 0);
  if (!Number.isFinite(needle) || needle < 0 || needle > 50) throw new Error("Give the needle size in millimetres, e.g. 4 or 3.75.");
  if (yarnId && !store.yarns.some((y) => y.id === yarnId)) throw new Error("That yarn is no longer in the stash.");
  if (toolId && !store.tools.some((t) => t.id === toolId)) throw new Error("That needle is no longer in Needles & hooks.");
  const projectId = link(input.projectId);
  if (projectId && !store.projects.some((p) => p.id === projectId)) throw new Error("That project is no longer there.");
  return {
    yarnId,
    yarnText: yarnId ? "" : oneLine(input.yarnText, 120),
    toolId,
    needleMm: Math.round(needle * 100) / 100,
    stitch: oneLine(input.stitch, 60),
    sts: count(input.sts, "stitches"),
    rows: count(input.rows, "rows"),
    stsBlocked: count(input.stsBlocked, "stitches"),
    rowsBlocked: count(input.rowsBlocked, "rows"),
    projectId,
    notes: String(input.notes || "").trim().slice(0, 4000),
    madeAt: input.madeAt > 0 ? input.madeAt : null,
  };
}
/** A swatch as the backend returns it: its yarn's and project's names joined in. */
function swatchOut(s) {
  const yarn = store.yarns.find((y) => y.id === s.yarnId);
  return clone({
    ...s,
    yarnName: yarn ? [yarn.brand, yarn.name].filter(Boolean).join(" ") : s.yarnText,
    yarnColourway: yarn?.colourway ?? "",
    projectName: store.projects.find((p) => p.id === s.projectId)?.name ?? "",
  });
}

// The rules of `people::clean_person` and `clean_set`.
const MEASUREMENT_KEYS = ["height", "chest", "waist", "hips", "neck", "shoulders", "upper_arm", "wrist", "arm_length", "armhole_depth", "back_length", "head", "hand", "foot_length", "foot_around"];
function cleanPerson(input) {
  const name = oneLine(input.name, 120);
  if (!name) throw new Error("Give them a name.");
  const extra = [];
  for (const raw of input.extra || []) {
    const e = oneLine(raw, 40);
    if (e && !extra.some((x) => x.toLowerCase() === e.toLowerCase())) extra.push(e);
  }
  return { name, notes: String(input.notes || "").trim().slice(0, 4000), extra: extra.slice(0, 30) };
}
function cleanSet(input, extra) {
  const values = {};
  for (const [key, value] of Object.entries(input.values || {})) {
    const known = MEASUREMENT_KEYS.includes(key) || (key.startsWith("x:") && extra.includes(key.slice(2)));
    if (!known) throw new Error(`“${key}” is not one of their measurements.`);
    if (!Number.isFinite(value) || value < 0) throw new Error("A measurement has to be a number of centimetres.");
    if (value > 300) throw new Error(`${value} cm is more than anyone measures — is it in the right unit?`);
    if (value > 0) values[key] = Math.round(value * 100) / 100;
  }
  if (!(input.measuredAt > 0)) throw new Error("Give the date they were measured.");
  return { measuredAt: input.measuredAt, values, shoeSize: oneLine(input.shoeSize, 20) };
}
/** A person as the backend returns them: every set, newest first, and their project count. */
function personOut(p) {
  const sets = store.measurementSets
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.personId === p.id)
    .sort((a, b) => b.s.measuredAt - a.s.measuredAt || b.i - a.i)
    .map(({ s }) => s);
  return clone({ ...p, sets, projectCount: store.projects.filter((pr) => pr.personId === p.id).length });
}
function findPerson(id) {
  const p = store.people.find((x) => x.id === id);
  if (!p) throw new Error("That person is no longer there.");
  return p;
}
function setOwner(id) {
  const s = store.measurementSets.find((x) => x.id === id);
  if (!s) throw new Error("Those measurements are no longer there.");
  return s;
}

/** A stored tool as the backend returns it: the active project it is on joined in. */
function toolOut(t) {
  const link = store.projectTools.find(
    (l) => l.toolId === t.id && ["active", "paused"].includes(store.projects.find((pr) => pr.id === l.projectId)?.status),
  );
  const pr = link ? store.projects.find((x) => x.id === link.projectId) : null;
  const { projectId: _ignored, ...rest } = t;
  return clone({ ...rest, projectId: pr ? pr.id : null, projectName: pr ? pr.name : "" });
}

/** `place_tool`: on an active project (off any other), or free with null. */
/** An inspiration board as the backend sends it: with its card's pictures and colours. */
function inspirationOut(b) {
  const items = store.boardItems.filter((i) => i.boardId === b.id).sort((x, y) => y.createdAt - x.createdAt);
  const pictures = items
    .map((i) =>
      i.kind === "image" && i.hasImage ? { kind: "image", id: i.id }
      : i.kind === "pattern" && store.patterns.find((p) => p.id === i.data.patternId)?.coverPath ? { kind: "pattern", id: i.data.patternId }
      : i.kind === "yarn" && store.yarns.find((y) => y.id === i.data.yarnId)?.photoPath ? { kind: "yarn", id: i.data.yarnId }
      : null,
    )
    .filter(Boolean)
    .slice(0, 4);
  const colours = items.filter((i) => i.kind === "swatch" && i.data.colour).map((i) => i.data.colour).slice(0, 6);
  return clone({ ...b, itemCount: items.length, pictures, colours });
}

function boardName(name) {
  const n = String(name ?? "").trim();
  return n ? n.slice(0, 120) : "Untitled board";
}

/** Something on an inspiration board changed, so it sorts first. */
function touchBoard(id) {
  const b = store.inspirationBoards.find((x) => x.id === id);
  if (b) b.updatedAt = Math.max(Date.now(), b.updatedAt + 1);
}

/** As db::title_key. */
function titleKey(title) {
  let t = title.toLowerCase().replace(/\.(pdf|epub)$/, "");
  const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  while (words.length > 1 && (["copy", "kopie", "kopia"].includes(words.at(-1)) || /^\d{1,2}$/.test(words.at(-1)))) words.pop();
  return words.join(" ");
}

/** As db::by_use: each value counted once per pattern, most used first. */
function countedByUse(lists) {
  const counts = new Map();
  for (const list of lists) for (const v of new Set(list)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.toLowerCase().localeCompare(b.value.toLowerCase()));
}

/** As db::tidy_fibres. */
function tidyFibres(fibres) {
  const out = [];
  for (const f of fibres || []) {
    const name = String(f.name || "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const percent = Number.isFinite(f.percent) ? Math.round(Math.min(100, Math.max(0, f.percent)) * 10) / 10 : 0;
    const same = out.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (same) same.percent = Math.min(100, same.percent + percent);
    else out.push({ name, percent });
  }
  return out;
}

/** Active or paused: its needles and yarn are in use. */
function isLive(status) {
  return status === "active" || status === "paused";
}

function inProgress(patternId) {
  const p = patternId && store.patterns.find((x) => x.id === patternId);
  if (p) p.status = "in-progress";
}

function placeTool(toolId, projectId) {
  if (projectId) {
    const pr = store.projects.find((x) => x.id === projectId);
    if (!pr) throw new Error("That project is no longer there.");
    if (!isLive(pr.status)) throw new Error("That project is finished or frogged, so nothing more can go on it.");
  }
  store.projectTools = store.projectTools.filter(
    (l) => !(l.toolId === toolId && l.projectId !== projectId && ["active", "paused"].includes(store.projects.find((pr) => pr.id === l.projectId)?.status)),
  );
  if (projectId && !store.projectTools.some((l) => l.toolId === toolId && l.projectId === projectId)) {
    store.projectTools.push({ projectId, toolId, addedAt: Date.now(), releasedAt: null });
  }
}

/** A project as the backend returns it: pattern title, tools and yarns joined in. */
function projectOut(pr) {
  const pattern = pr.patternId ? store.patterns.find((x) => x.id === pr.patternId) : null;
  return clone({
    ...pr,
    patternId: pattern ? pr.patternId : null,
    patternTitle: pattern ? pattern.title : "",
    coverPath: pr.coverPath || "",
    personId: store.people.some((p) => p.id === pr.personId) ? pr.personId : null,
    personName: store.people.find((p) => p.id === pr.personId)?.name ?? "",
    toolIds: store.projectTools.filter((l) => l.projectId === pr.id).map((l) => l.toolId),
    yarns: store.projectYarns
      .filter((e) => e.projectId === pr.id)
      .map((e) => {
        const yarn = store.yarns.find((y) => y.id === e.yarnId);
        const lot = yarn?.lots.find((l) => l.id === e.lotId);
        return { id: e.id, yarnId: e.yarnId, yarnName: yarn ? yarn.name : "", lotId: e.lotId, dyeLot: lot ? lot.dyeLot : "", leftoverGrams: e.leftoverGrams };
      }),
  });
}

/** `sync_links`: an active project's tools and yarns brought to what was sent. */
function syncLinks(id, input) {
  const want = [...new Set((input.toolIds || []).filter(Boolean))];
  store.projectTools = store.projectTools.filter((l) => l.projectId !== id || want.includes(l.toolId));
  for (const toolId of want) {
    if (!store.tools.some((t) => t.id === toolId)) throw new Error("One of those needles or hooks is no longer there.");
    placeTool(toolId, id);
  }
  const keep = (input.yarns || []).map((y) => y.id).filter(Boolean);
  store.projectYarns = store.projectYarns.filter((e) => e.projectId !== id || keep.includes(e.id));
  for (const y of input.yarns || []) {
    const yarn = store.yarns.find((x) => x.id === y.yarnId);
    if (!yarn) throw new Error("One of those yarns is no longer in the stash.");
    if (y.lotId && !yarn.lots.some((l) => l.id === y.lotId)) throw new Error("That lot is not one of that yarn's.");
    const existing = y.id && store.projectYarns.find((e) => e.id === y.id);
    if (existing) {
      existing.yarnId = y.yarnId;
      existing.lotId = y.lotId ?? null;
    } else {
      store.projectYarns.push({ id: `py${store.nextId++}`, projectId: id, yarnId: y.yarnId, lotId: y.lotId ?? null, addedAt: Date.now(), releasedAt: null, leftoverGrams: null });
    }
  }
}

function projectName(input) {
  const typed = String(input.name || "").split(/\s+/).filter(Boolean).join(" ");
  if (typed) return typed.slice(0, 120);
  const title = input.patternId ? store.patterns.find((p) => p.id === input.patternId)?.title : "";
  return title && title.trim() ? title : "Untitled project";
}

/**
 * The standard yarn weight table and the reading of a weight, from the same
 * module the yarn form uses, which mirrors `src-tauri/src/yarn.rs`. A copy
 * kept here had drifted from the backend -- other metre bands, 4 ply as
 * worsted -- so there is one now.
 */
const YARN_FAMILIES = WEIGHTS.map((w) => [w.key, w.label, w.min, w.max]);

function yarnFamily(text) {
  return familyOf(String(text || ""));
}

/**
 * The canonical mm sizes of a pattern's free-text needle size, from the same
 * module the sidebar's labels come from, which mirrors
 * `src-tauri/src/needle_size.rs`. The backend stores them in a derived column
 * on write; the stub derives them on read instead, the same place it derives
 * the yarn family, so a corrected size filters under the new key at once.
 */
function needleSizesOf(pattern) {
  return sizesOf(String(pattern.needleSize || ""));
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
  out.lots = out.lots.map((l) => ({ leftover: false, ...l }));
  out.fibres = tidyFibres(out.fibres);
  out.superwash = !!out.superwash;
  out.projects = [
    ...new Set(
      store.projectYarns
        .filter((e) => e.yarnId === yarn.id)
        .map((e) => store.projects.find((pr) => pr.id === e.projectId))
        .filter((pr) => pr && isLive(pr.status))
        .map((pr) => pr.name),
    ),
  ].sort();
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
    // Several canonical sizes mean "any of these", matching the EXISTS the
    // real backend builds over the derived sizes.
    if (filter?.needleSizes?.length) {
      out = out.filter((p) => needleSizesOf(p).some((s) => filter.needleSizes.includes(s)));
    }
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
  set_pattern_status: ({ id, status }) => {
    const p = store.patterns.find((x) => x.id === id);
    if (!p) throw new Error(`pattern not found: ${id}`);
    p.status = ["want-to-knit", "in-progress", "finished", "abandoned"].includes(status) ? status : "";
    return clone(p);
  },
  // As db::duplicate_groups: the same file (a seeded `fileHash`), or the same
  // title once a download's "(1)" and punctuation are left out, by the same
  // designer or with one unnamed.
  find_duplicate_patterns: () => {
    const list = [...store.patterns].sort((a, b) => a.addedAt - b.addedAt);
    const parent = list.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    const join = (a, b) => {
      const [ra, rb] = [root(a), root(b)];
      if (ra !== rb) parent[rb] = ra;
    };
    list.forEach((a, i) =>
      list.forEach((b, j) => {
        if (j <= i) return;
        if (a.fileHash && a.fileHash === b.fileHash) join(i, j);
        const [da, db] = [a.designer.trim().toLowerCase(), b.designer.trim().toLowerCase()];
        if (titleKey(a.title) && titleKey(a.title) === titleKey(b.title) && (!da || !db || da === db)) join(i, j);
      }),
    );
    const groups = new Map();
    list.forEach((p, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), p]));
    return [...groups.values()]
      .filter((g) => g.length > 1)
      .map((g) => {
        const entries = g.map((p) => ({
          pattern: clone(p),
          projects: store.projects.filter((pr) => pr.patternId === p.id).length,
          marks: store.pins.filter((x) => x.patternId === p.id).length + store.bookmarks.filter((x) => x.patternId === p.id).length,
          rows: 0,
          fileSize: 1000 + p.title.length,
        }));
        const best = [...entries].sort((a, b) => b.projects - a.projects || b.marks - a.marks)[0];
        return { exact: !!g[0].fileHash && g.every((p) => p.fileHash === g[0].fileHash), keep: best.pattern.id, patterns: entries };
      });
  },
  merge_duplicate_patterns: ({ keep, remove }) => {
    const kept = store.patterns.find((p) => p.id === keep);
    if (!kept) throw new Error(`pattern not found: ${keep}`);
    for (const id of remove.filter((r) => r !== keep)) {
      const copy = store.patterns.find((p) => p.id === id);
      if (!copy) throw new Error(`pattern not found: ${id}`);
      for (const pr of store.projects) if (pr.patternId === id) pr.patternId = keep;
      for (const item of store.boardItems) if (item.kind === "pattern" && item.data.patternId === id) item.data.patternId = keep;
      for (const t of copy.tags) if (!kept.tags.some((k) => k.toLowerCase() === t.toLowerCase())) kept.tags.push(t);
      if (!kept.status) kept.status = copy.status;
      if (copy.notes.trim() && !kept.notes.includes(copy.notes.trim())) kept.notes = kept.notes.trim() ? `${kept.notes.trimEnd()}\n\n${copy.notes.trim()}` : copy.notes.trim();
      for (const f of ["designer", "difficulty", "needleSize", "yarnWeight"]) if (!kept[f].trim()) kept[f] = copy[f];
      store.patterns = store.patterns.filter((p) => p.id !== id);
      store.covers.delete(id);
    }
    return clone(kept);
  },
  delete_pattern: ({ id }) => {
    store.patterns = store.patterns.filter((p) => p.id !== id);
    // ON DELETE SET NULL: its projects stay, without a pattern.
    for (const pr of store.projects) if (pr.patternId === id) pr.patternId = null;
  },
  get_facets: () => ({
    designers: [...new Set(store.patterns.map((p) => p.designer).filter(Boolean))].sort(),
    needleSizes: (() => {
      // Each derived size counted once per pattern that uses it (sizesOf
      // already dedupes within a pattern), smallest first, with the labels
      // travelling with the facet as the backend's NeedleSizeFacet does.
      const counts = new Map();
      for (const p of store.patterns) {
        for (const key of needleSizesOf(p)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts]
        .map(([key, count]) => ({ key, mm: mmLabel(key), us: usLabel(key), count }))
        .sort((a, b) => parseFloat(a.key) - parseFloat(b.key));
    })(),
    // Every family is listed whether or not it is used, in table order, so the
    // sidebar reads the same way it does in the real app.
    yarnWeights: YARN_FAMILIES.map(([key, label]) => ({
      key,
      label,
      count: store.patterns.filter((p) => yarnFamily(p.yarnWeight) === key).length,
    })),
    tags: [...new Set(store.patterns.flatMap((p) => p.tags))].sort(),
    designerCounts: countedByUse(store.patterns.map((p) => p.designer).filter(Boolean).map((d) => [d])),
    tagCounts: countedByUse(store.patterns.map((p) => p.tags)),
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
      hotkey: "",
    };
    store.counters.push(c);
    return clone(c);
  },
  set_counter_key: ({ id, hotkey }) => {
    requireCounter(id).hotkey = String(hotkey ?? "").trim();
  },
  // Mirrors commands.rs: J and K by default, and two different keys required.
  get_count_keys: () => clone(store.countKeys ?? { up: "KeyJ", down: "KeyK" }),
  save_count_keys: ({ keys }) => {
    if (!keys.up?.trim() || !keys.down?.trim() || keys.up === keys.down) {
      throw new Error("Count up and count down need two different keys.");
    }
    store.countKeys = { up: keys.up, down: keys.down };
    return clone(store.countKeys);
  },
  // How the sidebar spells the needle sizes: an app_settings-backed pair, as
  // get_count_keys/save_count_keys above, defaulting to both systems.
  get_needle_size_display: () => store.needleSizeDisplay ?? "both",
  save_needle_size_display: ({ display }) => {
    store.needleSizeDisplay = display;
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
  // ---------- opening outside the app ----------
  //
  // Recorded rather than opened, so a test can see what would have been.
  open_link: ({ url }) => {
    const lower = String(url).trim().toLowerCase();
    if (!/^(https?:\/\/|mailto:)/.test(lower)) throw new Error("Only web and email links can be opened.");
    (window.__opened ??= []).push(url);
  },
  open_pattern_file: ({ id }) => {
    const p = store.patterns.find((x) => x.id === id);
    if (!p) throw new Error("no pattern with that id");
    (window.__opened ??= []).push(p.filePath);
  },
  // ---------- bookmarks ----------
  //
  // Mirrors annotations.rs: a blank title becomes "Untitled", titles are cut
  // at 120 characters, and a page below 1 is raised to 1.
  list_bookmarks: ({ patternId }) =>
    clone(store.bookmarks.filter((b) => b.patternId === patternId).sort((a, b) => a.sortOrder - b.sortOrder)),
  add_bookmark: ({ patternId, page, title }) => {
    const mine = store.bookmarks.filter((b) => b.patternId === patternId);
    const b = {
      id: `bm${store.nextId++}`,
      patternId,
      page: Math.max(1, page),
      title: bookmarkTitle(title),
      sortOrder: mine.length,
      createdAt: Date.now(),
    };
    store.bookmarks.push(b);
    return clone(b);
  },
  rename_bookmark: ({ id, title }) => {
    const b = store.bookmarks.find((x) => x.id === id);
    if (!b) throw new Error("no bookmark with that id");
    b.title = bookmarkTitle(title);
    return clone(b);
  },
  delete_bookmark: ({ id }) => {
    const before = store.bookmarks.length;
    store.bookmarks = store.bookmarks.filter((b) => b.id !== id);
    if (store.bookmarks.length === before) throw new Error("no bookmark with that id");
  },
  list_page_rotations: ({ patternId }) =>
    clone(store.rotations.filter((r) => r.patternId === patternId).sort((a, b) => a.page - b.page))
      .map(({ page, rotation }) => ({ page, rotation })),
  set_page_rotation: ({ patternId, page, rotation }) => {
    if (page < 1) throw new Error(`There is no page ${page}.`);
    if (rotation % 90 !== 0) throw new Error(`A page turns in quarter turns, not ${rotation}°.`);
    const normal = ((rotation % 360) + 360) % 360;
    store.rotations = store.rotations.filter((r) => !(r.patternId === patternId && r.page === page));
    if (normal) store.rotations.push({ patternId, page, rotation: normal });
    return normal;
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

  // ---------- needles and hooks ----------
  list_tools: () =>
    store.tools
      .slice()
      .sort((a, b) => a.sizeMm - b.sizeMm || a.kind.localeCompare(b.kind) || a.addedAt - b.addedAt)
      .map(toolOut),
  add_tool: ({ input }) => {
    // Not `t${n}`: that would collide with the seeded t1..t6.
    const { projectId, ...fields } = cleanTool(input);
    const t = { id: `tool-${store.nextId++}`, ...fields, addedAt: Date.now() };
    placeTool(t.id, projectId);
    store.tools.push(t);
    return toolOut(t);
  },
  update_tool: ({ id, input }) => {
    const i = store.tools.findIndex((t) => t.id === id);
    if (i < 0) throw new Error(`No needle or hook with id ${id}.`);
    const { projectId, ...fields } = cleanTool(input);
    placeTool(id, projectId);
    store.tools[i] = { ...store.tools[i], ...fields };
    return toolOut(store.tools[i]);
  },
  set_tool_project: ({ id, projectId }) => {
    const t = store.tools.find((x) => x.id === id);
    if (!t) throw new Error(`No needle or hook with id ${id}.`);
    placeTool(id, projectId && String(projectId).trim() ? String(projectId).trim() : null);
    return toolOut(t);
  },
  delete_tool: ({ id }) => {
    for (const s of store.swatches) if (s.toolId === id) s.toolId = null;
    const before = store.tools.length;
    store.tools = store.tools.filter((t) => t.id !== id);
    if (store.tools.length === before) throw new Error(`No needle or hook with id ${id}.`);
    store.projectTools = store.projectTools.filter((l) => l.toolId !== id);
  },

  // ---------- projects ----------
  list_projects: () =>
    store.projects
      .slice()
      .sort((a, b) => ["active", "paused"].indexOf(b.status) - ["active", "paused"].indexOf(a.status) || b.startedAt - a.startedAt)
      .map(projectOut),
  add_project: ({ input }) => {
    if (input.patternId && !store.patterns.some((p) => p.id === input.patternId)) throw new Error("That pattern is no longer in the library.");
    const now = Date.now();
    const pr = { id: `pr${store.nextId++}`, name: projectName(input), patternId: input.patternId || null, status: "active", startedAt: input.startedAt ?? now, finishedAt: null, notes: input.notes || "", createdAt: now };
    store.projects.push(pr);
    try {
      syncLinks(pr.id, input);
    } catch (e) {
      store.projects = store.projects.filter((x) => x.id !== pr.id);
      store.projectTools = store.projectTools.filter((l) => l.projectId !== pr.id);
      store.projectYarns = store.projectYarns.filter((x) => x.projectId !== pr.id);
      throw e;
    }
    // A pattern being knitted is in progress.
    inProgress(pr.patternId);
    return projectOut(pr);
  },
  update_project: ({ id, input }) => {
    const pr = store.projects.find((x) => x.id === id);
    if (!pr) throw new Error("That project is no longer there.");
    if (input.patternId && !store.patterns.some((p) => p.id === input.patternId)) throw new Error("That pattern is no longer in the library.");
    pr.name = projectName(input);
    if (pr.status === "active" && (input.patternId || null) !== pr.patternId) inProgress(input.patternId);
    pr.patternId = input.patternId || null;
    pr.startedAt = input.startedAt ?? pr.startedAt;
    pr.notes = input.notes || "";
    // A finished project's end can be corrected; an active one has none.
    if (!isLive(pr.status) && input.finishedAt != null) pr.finishedAt = input.finishedAt;
    if (isLive(pr.status)) syncLinks(id, input);
    return projectOut(pr);
  },
  // As db::set_project_status.
  set_project_status: ({ id, status }) => {
    const pr = store.projects.find((x) => x.id === id);
    if (!pr) throw new Error("That project is no longer there.");
    if (!["active", "paused", "finished", "frogged"].includes(status)) throw new Error(`A project cannot be “${status}”.`);
    if (pr.status === status) return projectOut(pr);
    const now = Date.now();
    if (pr.status === "finished") throw new Error("A finished project stays finished.");
    if (status === "finished") throw new Error("Finishing a project asks about its leftovers: use Finish.");
    if (isLive(pr.status) && isLive(status)) pr.status = status;
    else if (isLive(pr.status) && status === "frogged") {
      pr.status = "frogged";
      pr.finishedAt = now;
      for (const l of store.projectTools) if (l.projectId === id && !l.releasedAt) l.releasedAt = now;
      for (const e of store.projectYarns) if (e.projectId === id && !e.releasedAt) e.releasedAt = now;
    } else if (pr.status === "frogged") {
      const busy = (toolId) => store.projectTools.some((l) => l.toolId === toolId && l.projectId !== id && isLive(store.projects.find((x) => x.id === l.projectId)?.status));
      store.projectTools = store.projectTools.filter((l) => l.projectId !== id || !busy(l.toolId));
      for (const l of store.projectTools) if (l.projectId === id) l.releasedAt = null;
      for (const e of store.projectYarns) if (e.projectId === id) e.releasedAt = null;
      pr.status = status;
      pr.finishedAt = null;
      if (status === "active") inProgress(pr.patternId);
    }
    return projectOut(pr);
  },
  finish_project: ({ id, input }) => {
    const pr = store.projects.find((x) => x.id === id);
    if (!pr) throw new Error("That project is no longer there.");
    if (!isLive(pr.status)) throw new Error("That project is already finished or frogged.");
    const now = Date.now();
    for (const left of input.leftovers || []) {
      if (left.grams == null) continue;
      if (left.grams < 0) throw new Error("Leftovers are a number of grams, 0 or more.");
      if (!store.projectYarns.some((e) => e.id === left.entryId && e.projectId === id)) throw new Error("That yarn is not on this project.");
    }
    pr.status = "finished";
    pr.finishedAt = input.finishedAt ?? now;
    for (const l of store.projectTools) if (l.projectId === id && !l.releasedAt) l.releasedAt = now;
    for (const e of store.projectYarns) if (e.projectId === id && !e.releasedAt) e.releasedAt = now;
    for (const left of input.leftovers || []) {
      if (left.grams == null) continue;
      const e = store.projectYarns.find((x) => x.id === left.entryId);
      e.leftoverGrams = left.grams;
      const yarn = store.yarns.find((y) => y.id === e.yarnId);
      if (!yarn) continue;
      let lot = yarn.lots.find((l) => l.id === e.lotId) ?? yarn.lots[0];
      if (!lot) {
        lot = { id: `l${store.nextId++}`, yarnId: yarn.id, dyeLot: "", balls: 0, gramsLeft: 0, location: "", boughtAt: null, leftover: false };
        yarn.lots.push(lot);
      }
      lot.gramsLeft = left.grams;
      lot.leftover = left.grams > 0;
    }
    return projectOut(pr);
  },
  delete_project: ({ id }) => {
    if (!store.projects.some((x) => x.id === id)) throw new Error("That project is no longer there.");
    for (const item of store.boardItems.filter((i) => i.boardId === id)) store.covers.delete(`board:${item.id}`);
    store.boardItems = store.boardItems.filter((i) => i.boardId !== id);
    store.covers.delete(`project:${id}`);
    store.projects = store.projects.filter((x) => x.id !== id);
    store.projectTools = store.projectTools.filter((l) => l.projectId !== id);
    store.projectYarns = store.projectYarns.filter((e) => e.projectId !== id);
    for (const w of store.wishes) if (w.projectId === id) w.projectId = null;
    for (const s of store.swatches) if (s.projectId === id) s.projectId = null;
  },

  set_project_cover: ({ projectId, bytes }) => {
    const pr = store.projects.find((x) => x.id === projectId);
    if (!pr) throw new Error("That project is no longer there.");
    if (!bytes || !bytes.length || !sniffImage(bytes)) throw new Error("That file does not look like an image.");
    pr.coverPath = `${projectId}.${sniffImage(bytes)[0]}`;
    store.covers.set(`project:${projectId}`, bytes);
  },
  get_project_cover: ({ projectId }) => {
    const bytes = store.covers.get(`project:${projectId}`);
    if (!bytes) throw new Error("This project has no cover.");
    return Uint8Array.from(bytes).buffer;
  },
  remove_project_cover: ({ projectId }) => {
    const pr = store.projects.find((x) => x.id === projectId);
    if (pr) pr.coverPath = "";
    store.covers.delete(`project:${projectId}`);
  },

  // ---------- boards ----------
  list_board_items: ({ boardId }) =>
    clone(store.boardItems.filter((i) => i.boardId === boardId).sort((a, b) => a.z - b.z || a.createdAt - b.createdAt)),
  add_board_item: ({ boardId, input }) => {
    if (!store.projects.some((x) => x.id === boardId) && !store.inspirationBoards.some((b) => b.id === boardId)) {
      throw new Error("That board is no longer there.");
    }
    const kinds = ["note", "text", "link", "image", "pattern", "yarn", "tool", "swatch"];
    if (!kinds.includes(input.kind)) throw new Error(`A board cannot hold a “${input.kind}”.`);
    const data = input.data ?? {};
    if (typeof data !== "object" || Array.isArray(data)) throw new Error("A board item holds an object.");
    const top = Math.max(0, ...store.boardItems.filter((i) => i.boardId === boardId).map((i) => i.z));
    const size = (v, f) => (Number.isFinite(v) && v > 0 ? Math.min(4000, Math.max(40, v)) : f);
    const item = {
      id: `b${store.nextId++}`, boardId, kind: input.kind,
      x: input.x || 0, y: input.y || 0, w: size(input.w, 220), h: size(input.h, 160),
      z: top + 1, data: clone(data), hasImage: false, createdAt: Date.now(),
    };
    store.boardItems.push(item);
    touchBoard(boardId);
    return clone(item);
  },
  update_board_item: ({ id, patch }) => {
    const item = store.boardItems.find((i) => i.id === id);
    if (!item) throw new Error("That is no longer on the board.");
    const size = (v, f) => (Number.isFinite(v) && v > 0 ? Math.min(4000, Math.max(40, v)) : f);
    if (patch.x != null) item.x = patch.x;
    if (patch.y != null) item.y = patch.y;
    if (patch.w != null) item.w = size(patch.w, item.w);
    if (patch.h != null) item.h = size(patch.h, item.h);
    if (patch.data) item.data = clone(patch.data);
    if (patch.toFront) {
      const top = Math.max(0, ...store.boardItems.filter((i) => i.boardId === item.boardId).map((i) => i.z));
      if (top !== item.z) item.z = top + 1;
    }
    touchBoard(item.boardId);
    return clone(item);
  },
  delete_board_item: ({ id }) => {
    const gone = store.boardItems.find((i) => i.id === id);
    if (!gone) throw new Error("That is no longer on the board.");
    touchBoard(gone.boardId);
    store.boardItems = store.boardItems.filter((i) => i.id !== id);
    store.covers.delete(`board:${id}`);
  },
  set_board_image: ({ id, bytes }) => {
    const item = store.boardItems.find((i) => i.id === id);
    if (!item) throw new Error("That is no longer on the board.");
    if (!bytes || !bytes.length || !sniffImage(bytes)) throw new Error("That file does not look like an image.");
    store.covers.set(`board:${id}`, bytes);
    item.hasImage = true;
    return clone(item);
  },
  get_board_image: ({ id }) => {
    const bytes = store.covers.get(`board:${id}`);
    if (!bytes) throw new Error("That picture is no longer there.");
    return Uint8Array.from(bytes).buffer;
  },

  // ---------- gauge swatches ----------
  list_swatches: () => [...store.swatches].sort((a, b) => b.madeAt - a.madeAt || b.addedAt - a.addedAt).map(swatchOut),
  add_swatch: ({ input }) => {
    const now = Date.now();
    const clean = cleanSwatch(input);
    const s = { id: `sw${store.nextId++}`, ...clean, madeAt: clean.madeAt ?? now, photoPath: "", addedAt: now };
    store.swatches.push(s);
    return swatchOut(s);
  },
  update_swatch: ({ id, input }) => {
    const s = store.swatches.find((x) => x.id === id);
    if (!s) throw new Error("That swatch is no longer there.");
    const clean = cleanSwatch(input);
    Object.assign(s, clean, { madeAt: clean.madeAt ?? s.madeAt });
    return swatchOut(s);
  },
  delete_swatch: ({ id }) => {
    if (!store.swatches.some((x) => x.id === id)) throw new Error("That swatch is no longer there.");
    store.covers.delete(`swatch:${id}`);
    store.swatches = store.swatches.filter((x) => x.id !== id);
  },
  set_swatch_photo: ({ id, bytes }) => {
    const s = store.swatches.find((x) => x.id === id);
    if (!s) throw new Error("That swatch is no longer there.");
    if (!bytes || !bytes.length || !sniffImage(bytes)) throw new Error("That file does not look like an image.");
    store.covers.set(`swatch:${id}`, Uint8Array.from(bytes));
    s.photoPath = `${id}.jpg`;
  },
  get_swatch_photo: ({ id }) => {
    const bytes = store.covers.get(`swatch:${id}`);
    if (!bytes) throw new Error("This swatch has no photo.");
    return Uint8Array.from(bytes).buffer;
  },
  remove_swatch_photo: ({ id }) => {
    const s = store.swatches.find((x) => x.id === id);
    if (!s) throw new Error("That swatch is no longer there.");
    store.covers.delete(`swatch:${id}`);
    s.photoPath = "";
  },

  // ---------- people and their measurements ----------
  list_people: () =>
    store.people
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.addedAt - b.addedAt)
      .map(personOut),
  get_person: ({ id }) => personOut(findPerson(id)),
  add_person: ({ input }) => {
    const now = Date.now();
    const p = { id: `pe${store.nextId++}`, ...cleanPerson(input), addedAt: now };
    store.people.push(p);
    store.measurementSets.push({ id: `ms${store.nextId++}`, personId: p.id, measuredAt: now, values: {}, shoeSize: "" });
    return personOut(p);
  },
  update_person: ({ id, input }) => {
    const p = findPerson(id);
    const clean = cleanPerson(input);
    const gone = p.extra.filter((e) => !clean.extra.includes(e)).map((e) => `x:${e}`);
    for (const s of store.measurementSets) if (s.personId === id) for (const k of gone) delete s.values[k];
    Object.assign(p, clean);
    return personOut(p);
  },
  delete_person: ({ id }) => {
    findPerson(id);
    for (const pr of store.projects) if (pr.personId === id) pr.personId = null;
    store.measurementSets = store.measurementSets.filter((s) => s.personId !== id);
    store.people = store.people.filter((p) => p.id !== id);
  },
  add_measurement_set: ({ personId, input }) => {
    const p = findPerson(personId);
    store.measurementSets.push({ id: `ms${store.nextId++}`, personId, ...cleanSet(input, p.extra) });
    return personOut(p);
  },
  update_measurement_set: ({ id, input }) => {
    const s = setOwner(id);
    const p = findPerson(s.personId);
    Object.assign(s, cleanSet(input, p.extra));
    return personOut(p);
  },
  delete_measurement_set: ({ id }) => {
    const s = setOwner(id);
    store.measurementSets = store.measurementSets.filter((x) => x.id !== id);
    return personOut(findPerson(s.personId));
  },
  set_project_person: ({ projectId, personId }) => {
    const pr = store.projects.find((x) => x.id === projectId);
    if (personId) findPerson(personId);
    if (!pr) throw new Error("That project is no longer there.");
    pr.personId = personId || null;
    return projectOut(pr);
  },
  get_measure_unit: () => store.measureUnit ?? "cm",
  save_measure_unit: ({ unit }) => {
    store.measureUnit = unit;
    return unit;
  },

  // ---------- shops and the wishlist ----------
  list_shops: () =>
    store.shops
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.addedAt - b.addedAt)
      .map(shopOut),
  add_shop: ({ input }) => {
    const sh = { id: `shop-${store.nextId++}`, ...cleanShop(input), addedAt: Date.now() };
    store.shops.push(sh);
    return shopOut(sh);
  },
  update_shop: ({ id, input }) => {
    const sh = store.shops.find((x) => x.id === id);
    if (!sh) throw new Error("That shop is no longer there.");
    Object.assign(sh, cleanShop(input));
    return shopOut(sh);
  },
  delete_shop: ({ id }) => {
    if (!store.shops.some((x) => x.id === id)) throw new Error("That shop is no longer there.");
    for (const w of store.wishes) if (w.shopId === id) w.shopId = null;
    store.shops = store.shops.filter((x) => x.id !== id);
  },
  list_wishes: () =>
    store.wishes
      .slice()
      .sort((a, b) => Number(a.gotAt !== null) - Number(b.gotAt !== null) || (b.gotAt ?? 0) - (a.gotAt ?? 0) || b.addedAt - a.addedAt)
      .map(wishOut),
  add_wish: ({ input }) => {
    const w = { id: `wish-${store.nextId++}`, ...cleanWish(input), gotAt: null, addedAt: Date.now() };
    store.wishes.push(w);
    return wishOut(w);
  },
  update_wish: ({ id, input }) => {
    const w = store.wishes.find((x) => x.id === id);
    if (!w) throw new Error("That is no longer on the wishlist.");
    Object.assign(w, cleanWish(input));
    return wishOut(w);
  },
  set_wish_got: ({ id, got }) => {
    const w = store.wishes.find((x) => x.id === id);
    if (!w) throw new Error("That is no longer on the wishlist.");
    w.gotAt = got ? Date.now() : null;
    if (!got) w.stashedAt = null;
    return wishOut(w);
  },
  set_wish_stashed: ({ id }) => {
    const w = store.wishes.find((x) => x.id === id);
    if (!w) throw new Error("That is no longer on the wishlist.");
    const now = Date.now();
    w.gotAt = w.gotAt ?? now;
    w.stashedAt = now;
    return wishOut(w);
  },
  delete_wish: ({ id }) => {
    if (!store.wishes.some((x) => x.id === id)) throw new Error("That is no longer on the wishlist.");
    store.covers.delete(`wish:${id}`);
    store.wishes = store.wishes.filter((x) => x.id !== id);
  },
  set_wish_photo: ({ id, bytes }) => {
    const w = store.wishes.find((x) => x.id === id);
    if (!w) throw new Error("That is no longer on the wishlist.");
    if (!bytes || !bytes.length || !sniffImage(bytes)) throw new Error("That file does not look like an image.");
    store.covers.set(`wish:${id}`, Uint8Array.from(bytes));
    w.photoPath = `${id}.jpg`;
  },
  get_wish_photo: ({ id }) => {
    const bytes = store.covers.get(`wish:${id}`);
    if (!bytes) throw new Error("This has no picture.");
    return Uint8Array.from(bytes).buffer;
  },
  remove_wish_photo: ({ id }) => {
    const w = store.wishes.find((x) => x.id === id);
    if (!w) throw new Error("That is no longer on the wishlist.");
    store.covers.delete(`wish:${id}`);
    w.photoPath = "";
  },
  // Pages are not fetched: a test seeds what a page says in
  // window.__linkPages, by address, as a preview or as the error to give.
  // Each read is recorded in window.__linkReads.
  fetch_link_preview: ({ url }) => {
    const clean = webAddress(url);
    if (!clean) throw new Error("Paste a link first.");
    (window.__linkReads ??= []).push(clean);
    const page = (window.__linkPages ?? {})[clean];
    if (page === undefined) throw new Error("The page could not be reached. Check the link, and that you are online.");
    if (typeof page === "string") throw new Error(page);
    return clone({ url: clean, title: "", brand: "", price: "", imageUrl: "", siteName: "", ...page });
  },
  // A shop's name, seeded by site in window.__shopNames: a name, or false for
  // a shop that refuses to be read. A site not seeded does not say its name.
  fetch_shop_name: ({ url }) => {
    const clean = webAddress(url);
    if (!clean) throw new Error("Give the shop's web address first.");
    const site = clean.split("://")[1].split(/[/?#:]/)[0].toLowerCase().replace(/^www[.]/, "");
    (window.__shopLookups ??= []).push(site);
    const named = (window.__shopNames ?? {})[site];
    if (named === false) throw new Error("The page answered 403.");
    return named ?? "";
  },
  // Any picture address answers with a small drawn picture.
  fetch_link_image: async ({ url }) => {
    if (!webAddress(url)) throw new Error("There is no picture to fetch.");
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#c98bd0";
    ctx.fillRect(0, 0, 48, 48);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return await blob.arrayBuffer();
  },

  // ---------- inspiration boards ----------
  list_inspiration_boards: () =>
    [...store.inspirationBoards].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt).map(inspirationOut),
  get_inspiration_board: ({ id }) => {
    const b = store.inspirationBoards.find((x) => x.id === id);
    if (!b) throw new Error("That board is no longer there.");
    return inspirationOut(b);
  },
  add_inspiration_board: ({ name }) => {
    const now = Date.now();
    const b = { id: `ib${store.nextId++}`, name: boardName(name), createdAt: now, updatedAt: now };
    store.inspirationBoards.push(b);
    return inspirationOut(b);
  },
  rename_inspiration_board: ({ id, name }) => {
    const b = store.inspirationBoards.find((x) => x.id === id);
    if (!b) throw new Error("That board is no longer there.");
    b.name = boardName(name);
    b.updatedAt = Date.now();
    return inspirationOut(b);
  },
  delete_inspiration_board: ({ id }) => {
    if (!store.inspirationBoards.some((x) => x.id === id)) throw new Error("That board is no longer there.");
    for (const item of store.boardItems.filter((i) => i.boardId === id)) store.covers.delete(`board:${item.id}`);
    store.boardItems = store.boardItems.filter((i) => i.boardId !== id);
    store.inspirationBoards = store.inspirationBoards.filter((x) => x.id !== id);
  },

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
      fibres: tidyFibres(input.fibres),
      superwash: !!input.superwash,
      addedAt: Date.now(),
      lots: (input.lots || []).map((lot) => ({
        id: `l${store.nextId++}`,
        yarnId: id,
        dyeLot: lot.dyeLot || "",
        balls: lot.balls || 0,
        gramsLeft: lot.gramsLeft || 0,
        location: lot.location || "",
        boughtAt: lot.boughtAt ?? null,
        leftover: !!lot.leftover,
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
      leftover: !!lot.leftover,
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
    delete next.projects;
    store.yarns[i] = next;
    return withYarnTotals(next);
  },
  delete_yarn: ({ id }) => {
    // Its swatches stay, and still say what they were knitted in.
    const gone = store.yarns.find((y) => y.id === id);
    for (const s of store.swatches) {
      if (s.yarnId !== id) continue;
      s.yarnText = `${[gone.brand, gone.name].filter(Boolean).join(" ")}${gone.colourway ? `, ${gone.colourway}` : ""}`;
      s.yarnId = null;
    }
    store.yarns = store.yarns.filter((y) => y.id !== id);
    store.projectYarns = store.projectYarns.filter((e) => e.yarnId !== id);
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
        enabled: false,
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
    if (!store.aiSettings?.enabled) throw new Error("Describing with a model is switched off in Settings.");
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
    return { currentVersion: "0.2.1", checkedAt: Math.floor(Date.now() / 1000), update: next ? clone(next) : null };
  },
  startup_update_check: () => {
    const next = window.__startupUpdate ?? null;
    if (!next) return { skipped: true, currentVersion: null, checkedAt: null, update: null };
    if (next.error) throw new Error(next.error);
    return { skipped: false, currentVersion: "0.2.1", checkedAt: Math.floor(Date.now() / 1000), update: clone(next) };
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

