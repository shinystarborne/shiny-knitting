/**
 * Checks for crochet diagrams: rounds and rows read as a pattern writes them
 * (one in each, or all into one place; repeats; around; in same; chain
 * spaces; US and UK terms; what it does not know said), laid out into the
 * stitches before, drawn; and Constructors' page: a new one from its
 * example, written in and kept, a stitch it does not know said, put on a
 * project's board from the board's Chart, drawn there, and opened back in
 * Constructors from it.
 *
 * Run with the harness open:
 *   window.__crochetChecks()
 */
import type { CrochetDiagram, Project } from "../src/api";
import { diagramSvg, layout, readRow, stepsOf, type CrochetData } from "../src/views/crochet";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

/** Each row's stitches and chains, "11/3". */
const counts = (data: CrochetData) => layout(data).rows.map((r) => `${r.stitches}/${r.chains}`).join(" ");

function pure(results: CheckResult[]): void {
  const places = (text: string, around = 12, terms: "us" | "uk" = "us") =>
    stepsOf(readRow(text, terms), around).map((s) => (s.kind === "place" ? `${s.stitches.join("+")}${s.same ? "@same" : ""}${s.space ? "@sp" : ""}` : s.kind === "chain" ? `ch${s.n}` : s.kind === "skip" ? `sk${s.n}` : "join"));
  check(results, "3 dc is one in each of three; 5 dc in next is a fan in one", places("3 dc").join(",") === "dc,dc,dc" && places("5 dc in next").join(",") === "dc+dc+dc+dc+dc", places("5 dc in next").join(","));
  check(results, "11 dc in ring is eleven round the ring", places("11 dc in ring").length === 11);
  check(results, "brackets go into one place; in next sp under the chains", places("(3 dc, ch 2, 3 dc) in next sp").join(",") === "dc+dc+dc+ch+ch+dc+dc+dc@sp");
  check(results, "*…* x 3 is three times; around fills the round before", places("*sc, ch 3, sk 1* x 3").length === 9 && places("*sc, sk 1* around", 12).filter((p) => p === "sc").length === 6, places("*sc, sk 1* around", 12).join(","));
  check(results, "2 sc in each st around: a pair into each of the 6", places("2 sc in each st around", 6).join(",") === "sc+sc,sc+sc,sc+sc,sc+sc,sc+sc,sc+sc");
  check(results, "ch 3, dc in same st; sl st to join", places("ch 3, dc in same st, sl st to join").join(",") === "ch3,dc@same,join");
  check(results, "UK terms: dc is US sc, tr is US dc, ss a slip stitch", places("3 dc, 2 tr in next, ss to join", 0, "uk").join(",") === "sc,sc,sc,dc+dc,join", places("3 dc, 2 tr in next, ss to join", 0, "uk").join(","));
  const odd = readRow("3 dc, 2 bobbles, sk 1", "us");
  check(results, "what it does not know is said, the rest kept", odd.errors.length === 1 && /bobbles/.test(odd.errors[0]) && stepsOf(odd, 0).length === 4, JSON.stringify(odd.errors));

  check(results, "a flat circle in sc: 6, 12, 18 round", counts({ shape: "rounds", terms: "us", rows: ["6 sc in ring", "2 sc in each st around", "*sc, 2 sc in next* around"] }) === "6/0 12/0 18/0");
  const circle = layout({ shape: "rounds", terms: "us", rows: ["6 sc in ring", "2 sc in each st around"] });
  check(results, "…each round worked into all of the one before", circle.rows[1].into === 6 && circle.rows[1].of === 6);
  check(results, "…and drawn round a ring, round 1 marked as the start", circle.marks.some((m) => m.kind === "ring") && circle.marks.filter((m) => m.kind === "label" && m.first).length === 1);
  const r = (m: { x: number; y: number }) => Math.hypot(m.x, m.y);
  const tops = (row: number) => circle.marks.filter((m) => m.kind === "stitch" && m.row === row).map((m) => (m.kind === "stitch" ? r(m.top) : 0));
  check(results, "…the second round outside the first", Math.min(...tops(2)) > Math.max(...tops(1)), `${Math.min(...tops(2))} ${Math.max(...tops(1))}`);
  const rows = layout({ shape: "rows", terms: "us", rows: ["ch 10", "sk 1, sc in each ch across"] });
  check(results, "rows: a foundation chain of 10, 9 sc worked back along it", rows.rows.map((x) => `${x.stitches}/${x.chains}`).join(" ") === "0/10 9/0" && rows.rows[1].into === 10);
  const rose = layout({ shape: "spiral", terms: "us", rows: ["ch 40", "*sk 2, (5 dc) in next* around"] });
  check(results, "a spiral rose: 40 chains, 13 fans of 5 along them", rose.rows[1].stitches === 65 && rose.used.has("dc") && rose.used.has("ch"));
  const svg = diagramSvg({ shape: "spiral", terms: "us", rows: ["ch 40", "*sk 2, (5 dc) in next* around"] }, "Rose");
  check(results, "drawn as an SVG with its numbers", /^<svg/.test(svg) && />1</.test(svg) && />2</.test(svg) && (svg.match(/<ellipse/g) ?? []).length >= 40);
  const shells = layout({ shape: "rounds", terms: "us", rows: ["ch 4, join", "ch 1, 8 sc in ring, sl st to join", "*ch 5, sk 1, sc* around", "*(sc, hdc, 3 dc, hdc, sc) in next sp* around"] });
  check(results, "petals: one shell in each of the 4 chain loops", shells.rows[3].stitches === 28, String(shells.rows[3].stitches));
}

export async function verifyCrochet() {
  const results: CheckResult[] = [];
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const editor = () => document.querySelector<HTMLElement>(".crochet-editor");
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const kept = await invoke<CrochetDiagram[]>("list_crochet_diagrams");
  let projectId = "";
  try {
    pure(results);

    tab("calculators");
    await waitFor(() => !!document.querySelector('.calc-pick[data-calc="crochet"]'), "Constructors");
    (document.querySelector('.calc-pick[data-calc="crochet"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".crochet-list"), "the diagrams");
    check(results, "Constructors has Crochet diagrams, a new one in rounds, rows or along a spiral", document.querySelectorAll(".crochet-new [data-act=new]").length === 3);
    (document.querySelector('.crochet-new [data-shape="rounds"]') as HTMLElement).click();
    await waitFor(() => !!editor()?.querySelector(".crochet-drawing svg"), "the new diagram");
    const made = (await invoke<CrochetDiagram[]>("list_crochet_diagrams")).find((d) => !kept.some((k) => k.id === d.id))!;
    check(results, "a new one starts from its example, kept, and drawn", made?.data.rows.length === 3 && editor()!.querySelectorAll(".crochet-row").length === 3 && /11 stitches/.test(editor()!.querySelector(".crochet-row [data-el=count]")!.textContent ?? ""));
    check(results, "…with a legend of the stitches in it", /double crochet/.test(editor()!.querySelector("[data-el=legend]")!.textContent ?? ""));

    // Written in: drawn as typed, kept a moment after.
    const name = editor()!.querySelector<HTMLInputElement>('[data-f="name"]')!;
    name.value = "Coaster";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const third = editor()!.querySelectorAll<HTMLTextAreaElement>('.crochet-row textarea')[2];
    third.value = "ch 1, *sc, 2 popcorns* around";
    third.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(50);
    const error = editor()!.querySelectorAll<HTMLElement>('[data-el="row-error"]')[2];
    check(results, "a stitch it does not know is said, under its round, with what it knows", !error.hidden && /popcorns/.test(error.textContent ?? "") && /hdc/.test(error.textContent ?? ""), error.textContent ?? "");
    third.value = "ch 1, *sc, ch 3, sk 1* around, sl st to join";
    third.dispatchEvent(new Event("input", { bubbles: true }));
    (editor()!.querySelector('[data-act="add-row"]') as HTMLElement).click();
    const fourth = editor()!.querySelectorAll<HTMLTextAreaElement>('.crochet-row textarea')[3];
    fourth.value = "*(sc, hdc, dc, hdc, sc) in next sp* around";
    fourth.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(900);
    const saved = (await invoke<CrochetDiagram[]>("list_crochet_diagrams")).find((d) => d.id === made.id)!;
    check(results, "kept as written a moment after: its name and a fourth round", saved.name === "Coaster" && saved.data.rows[3] === "*(sc, hdc, dc, hdc, sc) in next sp* around", JSON.stringify(saved.data.rows));
    check(results, "…the fourth round drawn: 12 shells of 5", /60 stitches/.test(editor()!.querySelectorAll(".crochet-row [data-el=count]")[3].textContent ?? ""), editor()!.querySelectorAll(".crochet-row [data-el=count]")[3].textContent ?? "");
    const terms = editor()!.querySelector<HTMLSelectElement>('[data-f="terms"]')!;
    terms.value = "uk";
    terms.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => !/single crochet/.test(editor()?.querySelector("[data-el=legend]")?.textContent ?? ""), "UK terms");
    const ukError = editor()!.querySelectorAll<HTMLElement>('[data-el="row-error"]')[3];
    check(results, "UK terms: the same rounds read in them, dc a UK double crochet, hdc not a UK word", /dc\s*double crochet/.test(editor()!.querySelector("[data-el=legend]")!.textContent ?? "") && !ukError.hidden && /hdc/.test(ukError.textContent ?? "") && /htr/.test(ukError.textContent ?? ""), ukError.textContent ?? "");
    terms.value = "us";
    terms.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(900);

    // On a board, from its Chart.
    const project = await invoke<Project>("add_project", { input: { name: "Coasters", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    projectId = project.id;
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
    await waitFor(() => !!page()?.querySelector('.board-tools [data-add="chart"]'), "the project's board");
    (page()!.querySelector('.board-tools [data-add="chart"]') as HTMLElement).click();
    await waitFor(() => !!dialog()?.querySelector("select.dialog-choices"), "the choice of chart");
    const option = dialog()!.querySelector<HTMLOptionElement>(`option[value="crochet:${made.id}"]`);
    check(results, "the board's Chart offers it under Drawn in Constructors: crochet", option?.closest("optgroup")?.label === "Drawn in Constructors: crochet");
    dialog()!.querySelector<HTMLSelectElement>("select.dialog-choices")!.value = `crochet:${made.id}`;
    (dialog()!.querySelector("button.primary") as HTMLElement).click();
    const card = () => page()?.querySelector<HTMLElement>(".board-item.kind-crochet") ?? null;
    await waitFor(() => !!card()?.querySelector("svg"), "the diagram on the board");
    check(results, "on the board: its name, drawn as it is", /Coaster/.test(card()!.querySelector(".board-chart-bar")!.textContent ?? "") && (card()!.querySelectorAll("svg ellipse").length > 20));
    (card()!.querySelector('[data-act="open"]') as HTMLElement).click();
    await waitFor(() => (editor()?.querySelector<HTMLInputElement>('[data-f="name"]')?.value ?? "") === "Coaster", "the diagram in Constructors");
    check(results, "Open ↗ opens it in Constructors, to change", true);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (dialog()) (dialog()!.querySelector("button.ghost, button") as HTMLElement)?.click();
    await wait(800);
    for (const d of await invoke<CrochetDiagram[]>("list_crochet_diagrams")) if (!kept.some((k) => k.id === d.id)) await invoke("delete_crochet_diagram", { id: d.id });
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    (document.querySelector('[data-act="list"]') as HTMLElement | null)?.click();
    await wait(100);
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__crochetChecks = verifyCrochet;
