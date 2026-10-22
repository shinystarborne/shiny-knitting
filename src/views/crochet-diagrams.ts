import { api, isRecord, type CrochetDiagram, type Project } from "../api";
import { askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";
import { EXAMPLES, STITCHES, diagramSvg, layout, legendHtml, rowWord, type Shape, type Terms } from "./crochet";

/**
 * Constructors → Crochet diagrams: the diagrams kept, and one open to write
 * in. Each round or row is written as a pattern writes it and drawn as it is
 * typed, in the standard symbols; it is kept as it is written, a moment
 * after the typing stops. A diagram can go on a project's board, or be saved
 * as a picture to print.
 */

const SHAPES: { shape: Shape; label: string; hint: string }[] = [
  { shape: "rounds", label: "In rounds", hint: "From a ring, round and round: a circle, a granny square, a flower" },
  { shape: "rows", label: "In rows", hint: "Back and forth, turned at each end" },
  { shape: "spiral", label: "Along a spiral", hint: "A strip whose rows are worked along a spiral chain, as a rose is" },
];

/** How long after the last keystroke a diagram is kept. */
const SAVE_MS = 600;

/** The diagram open, kept while the app is open: coming back to Constructors comes back to it. */
let openId: string | null = null;

/** Opens Constructors on this diagram next. */
export function openCrochetDiagram(id: string): void {
  openId = id;
}

export class CrochetDiagrams {
  private host: HTMLElement;
  private forProject: { id: string; name: string } | null;
  private diagrams: CrochetDiagram[] = [];
  private projects: Project[] = [];
  /** The one open, as being written. */
  private current: CrochetDiagram | null = null;
  private saving: number | null = null;

  constructor(host: HTMLElement, forProject: { id: string; name: string } | null) {
    this.host = host;
    this.forProject = forProject;
  }

  async mount(): Promise<void> {
    [this.diagrams, this.projects] = await Promise.all([
      api.listCrochetDiagrams().catch(() => [] as CrochetDiagram[]),
      api.listProjects().catch(() => [] as Project[]),
    ]);
    this.host.addEventListener("click", (e) => void this.onClick(e));
    this.host.addEventListener("input", (e) => this.onInput(e));
    this.host.addEventListener("change", (e) => this.onInput(e));
    this.current = this.diagrams.find((d) => d.id === openId) ?? null;
    if (this.current) this.paintEditor();
    else this.paintList();
  }

  // ---------- the list ----------

  private paintList(): void {
    openId = null;
    this.host.innerHTML = `
      <div class="crochet-list">
        <h2>Crochet diagrams <span class="hint">written as a pattern writes them, drawn in crochet symbols</span></h2>
        <div class="crochet-new">
          ${SHAPES.map((s) => `<button class="ghost" data-act="new" data-shape="${s.shape}" title="${esc(s.hint)}">+ ${esc(s.label)}</button>`).join("")}
        </div>
        ${
          this.diagrams.length
            ? `<div class="crochet-grid">${this.diagrams.map((d) => this.cardHtml(d)).join("")}</div>`
            : `<div class="empty"><h2>No diagrams yet</h2><p>Start one in rounds, in rows, or along a spiral: it starts with an example to change. Write each round or row as a pattern does, <code>ch 3, 11 dc in ring, sl st to join</code>, and it is drawn as you type.</p></div>`
        }
      </div>`;
  }

  private cardHtml(d: CrochetDiagram): string {
    return `
      <article class="crochet-card" data-open="${esc(d.id)}" title="Open it">
        <div class="crochet-thumb">${diagramSvg(d.data, d.name)}</div>
        <div class="crochet-card-body">
          <strong>${esc(d.name)}</strong>
          <span class="hint">${esc(SHAPES.find((s) => s.shape === d.data.shape)?.label ?? "")} · ${d.data.rows.length} ${rowWord(d.data.shape).toLowerCase()}${d.data.rows.length === 1 ? "" : "s"} · ${d.data.terms.toUpperCase()} terms</span>
          <div class="card-tools-row"><span class="spacer"></span><button class="card-remove" data-act="remove" data-id="${esc(d.id)}" title="Remove this diagram">Remove</button></div>
        </div>
      </article>`;
  }

  // ---------- one open ----------

  private paintEditor(): void {
    const d = this.current!;
    openId = d.id;
    const word = rowWord(d.data.shape);
    this.host.innerHTML = `
      <div class="crochet-editor">
        <div class="crochet-bar">
          <button class="ghost" data-act="list">← Diagrams</button>
          <input class="crochet-name" data-f="name" value="${esc(d.name)}" aria-label="Name" />
          <select data-f="shape" aria-label="Worked">${SHAPES.map((s) => `<option value="${s.shape}" ${s.shape === d.data.shape ? "selected" : ""} title="${esc(s.hint)}">${esc(s.label)}</option>`).join("")}</select>
          <select data-f="terms" aria-label="Terms" title="dc is a different stitch in US and UK patterns">
            <option value="us" ${d.data.terms === "us" ? "selected" : ""}>US terms (sc, dc)</option>
            <option value="uk" ${d.data.terms === "uk" ? "selected" : ""}>UK terms (dc, tr)</option>
          </select>
          <span class="hint" data-el="saved">Kept as you write</span>
        </div>
        <div class="crochet-body">
          <section class="crochet-rows">
            <ol data-el="rows">${d.data.rows.map((r, i) => this.rowHtml(word, r, i)).join("")}</ol>
            <button class="ghost" data-act="add-row">+ ${word}</button>
            <details class="crochet-help">
              <summary>How to write them</summary>
              ${helpHtml(d.data.terms)}
            </details>
            <label class="field"><span>Notes <em class="optional">optional</em></span><textarea data-f="notes" rows="3" placeholder="Hook, yarn, where it is from">${esc(d.notes)}</textarea></label>
          </section>
          <section class="crochet-view">
            <div class="crochet-drawing" data-el="drawing"></div>
            <div class="crochet-legend" data-el="legend"></div>
            <div class="crochet-actions">
              <label class="field"><span>Put it on a board</span>
                <select data-f="project">
                  <option value="">Choose a project…</option>
                  ${this.projects
                    .filter((p) => !isRecord(p.status))
                    .map((p) => `<option value="${esc(p.id)}" ${p.id === this.forProject?.id ? "selected" : ""}>${esc(p.name)}</option>`)
                    .join("")}
                </select>
              </label>
              <button class="ghost" data-act="to-board">Put it there</button>
              <span class="spacer"></span>
              <button class="ghost" data-act="picture" title="A PNG of the diagram, to print or keep">Save as picture…</button>
            </div>
          </section>
        </div>
      </div>`;
    this.redraw();
  }

  private rowHtml(word: string, text: string, i: number): string {
    return `
      <li class="crochet-row" data-row="${i}">
        <div class="crochet-row-head"><b>${word} ${i + 1}</b><span class="hint" data-el="count"></span><button class="ghost" data-act="remove-row" title="Take this ${word.toLowerCase()} out" aria-label="Take out ${word} ${i + 1}">✕</button></div>
        <textarea data-f="row" rows="2" spellcheck="false">${esc(text)}</textarea>
        <p class="form-error" data-el="row-error" hidden></p>
      </li>`;
  }

  /** The drawing, the legend, and each row's count and what could not be read. */
  private redraw(): void {
    const d = this.current;
    if (!d) return;
    const lay = layout(d.data);
    const drawing = this.host.querySelector<HTMLElement>('[data-el="drawing"]');
    if (drawing) drawing.innerHTML = d.data.rows.some((r) => r.trim()) ? diagramSvg(d.data, d.name, lay) : `<p class="hint">Write the first ${rowWord(d.data.shape).toLowerCase()} on the left.</p>`;
    const legend = this.host.querySelector<HTMLElement>('[data-el="legend"]');
    if (legend) legend.innerHTML = legendHtml(lay.used, d.data.terms);
    this.host.querySelectorAll<HTMLElement>(".crochet-row").forEach((li, i) => {
      const r = lay.rows[i];
      const count = li.querySelector<HTMLElement>('[data-el="count"]')!;
      const error = li.querySelector<HTMLElement>('[data-el="row-error"]')!;
      count.textContent = r ? [r.stitches ? `${r.stitches} stitch${r.stitches === 1 ? "" : "es"}` : "", r.chains ? `${r.chains} chain${r.chains === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") : "";
      error.hidden = !r?.errors.length;
      error.textContent = r?.errors.length ? `${r.errors.join("; ")}. ${knownHint(d.data.terms)}` : "";
    });
  }

  private onInput(e: Event): void {
    const d = this.current;
    const el = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (!d || !el.dataset?.f || el.dataset.f === "project") return;
    if (el.dataset.f === "name") d.name = el.value;
    if (el.dataset.f === "notes") d.notes = el.value;
    if (el.dataset.f === "row") {
      const i = Number(el.closest<HTMLElement>(".crochet-row")?.dataset.row);
      d.data.rows[i] = el.value;
    }
    if (el.dataset.f === "shape" || el.dataset.f === "terms") {
      if (e.type !== "change") return;
      if (el.dataset.f === "shape") d.data.shape = el.value as Shape;
      else d.data.terms = el.value as Terms;
      this.paintEditor();
    } else this.redraw();
    this.keepSoon();
  }

  /** Kept a moment after the typing stops. */
  private keepSoon(): void {
    if (this.saving !== null) window.clearTimeout(this.saving);
    const saved = this.host.querySelector<HTMLElement>('[data-el="saved"]');
    if (saved) saved.textContent = "…";
    this.saving = window.setTimeout(() => void this.keep(), SAVE_MS);
  }

  private async keep(): Promise<void> {
    this.saving = null;
    const d = this.current;
    if (!d) return;
    try {
      const kept = await api.saveCrochetDiagram({ id: d.id, name: d.name, notes: d.notes, data: d.data });
      d.updatedAt = kept.updatedAt;
      const saved = this.host.querySelector<HTMLElement>('[data-el="saved"]');
      if (saved && openId === d.id) saved.textContent = "Kept";
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Crochet diagram");
    }
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (!btn) {
      const card = closestEl(e.target, "[data-open]");
      const d = card && this.diagrams.find((x) => x.id === card.dataset.open);
      if (d) {
        this.current = structuredClone(d);
        this.paintEditor();
      }
      return;
    }
    const act = btn.dataset.act;
    if (act === "new") await this.create(btn.dataset.shape as Shape);
    if (act === "remove") await this.remove(btn.dataset.id!);
    if (act === "list") {
      if (this.saving !== null) {
        window.clearTimeout(this.saving);
        await this.keep();
      }
      this.current = null;
      this.diagrams = await api.listCrochetDiagrams().catch(() => this.diagrams);
      this.paintList();
    }
    const d = this.current;
    if (!d) return;
    if (act === "add-row") {
      d.data.rows.push("");
      const list = this.host.querySelector<HTMLElement>('[data-el="rows"]')!;
      list.insertAdjacentHTML("beforeend", this.rowHtml(rowWord(d.data.shape), "", d.data.rows.length - 1));
      list.querySelector<HTMLTextAreaElement>(".crochet-row:last-child textarea")?.focus();
      this.redraw();
      this.keepSoon();
    }
    if (act === "remove-row") {
      const i = Number(btn.closest<HTMLElement>(".crochet-row")?.dataset.row);
      if (d.data.rows[i]?.trim() && !(await askYesNo(`Take ${rowWord(d.data.shape).toLowerCase()} ${i + 1} out?`, { okLabel: "Take it out", danger: true }))) return;
      d.data.rows.splice(i, 1);
      this.paintEditor();
      this.keepSoon();
    }
    if (act === "to-board") await this.toBoard();
    if (act === "picture") await this.savePicture();
  }

  private async create(shape: Shape): Promise<void> {
    const ex = EXAMPLES[shape];
    try {
      const d = await api.saveCrochetDiagram({ id: null, name: ex.name, notes: "", data: { shape, terms: ex.terms, rows: [...ex.rows] } });
      this.diagrams.unshift(d);
      this.current = structuredClone(d);
      this.paintEditor();
      this.host.querySelector<HTMLInputElement>('[data-f="name"]')?.select();
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Crochet diagram");
    }
  }

  private async remove(id: string): Promise<void> {
    const d = this.diagrams.find((x) => x.id === id);
    if (!d || !(await askYesNo(`Remove “${d.name}”?\n\nA board showing it says it is no longer kept. This cannot be undone.`, { title: "Remove diagram", okLabel: "Remove", danger: true }))) return;
    try {
      await api.deleteCrochetDiagram(id);
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Remove diagram"));
    }
    this.diagrams = this.diagrams.filter((x) => x.id !== id);
    this.paintList();
  }

  /** On a project's board, below what is there. */
  private async toBoard(): Promise<void> {
    const d = this.current!;
    const projectId = this.host.querySelector<HTMLSelectElement>('[data-f="project"]')?.value;
    const saved = this.host.querySelector<HTMLElement>('[data-el="saved"]');
    if (!projectId) return void (saved && (saved.textContent = "Choose a project first."));
    if (this.saving !== null) {
      window.clearTimeout(this.saving);
      await this.keep();
    }
    try {
      const items = await api.listBoardItems(projectId).catch(() => []);
      const y = items.reduce((max, it) => Math.max(max, it.y + it.h), 0) + 40;
      const box = layout(d.data).box;
      const w = 420;
      const h = Math.min(900, Math.max(200, Math.round((w * box.h) / Math.max(1, box.w)) + 30));
      await api.addBoardItem(projectId, { kind: "crochet", x: 40, y, w, h, data: { diagramId: d.id } });
      if (saved) saved.textContent = `On ${this.projects.find((p) => p.id === projectId)?.name ?? "the project"}'s board.`;
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Crochet diagram");
    }
  }

  /** The drawing as a PNG, twice its size on screen, where the user says. */
  private async savePicture(): Promise<void> {
    const d = this.current!;
    try {
      const blob = await svgToPng(diagramSvg(d.data, d.name), 2.5);
      const path = await api.saveFile("png", d.name, new Uint8Array(await blob.arrayBuffer()));
      const saved = this.host.querySelector<HTMLElement>('[data-el="saved"]');
      if (path && saved) saved.textContent = `Saved to ${path}`;
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Save as picture");
    }
  }
}

/** An SVG drawn onto a canvas, `scale` times its own size, as a PNG. */
export async function svgToPng(svg: string, scale: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The diagram could not be drawn."));
      img.src = url;
    });
    const view = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
    const w = Math.max(1, Math.round(Number(view?.[3] ?? img.width) * scale));
    const h = Math.max(1, Math.round(Number(view?.[4] ?? img.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture could not be made."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The stitches it knows, in these terms. */
function knownHint(terms: Terms): string {
  return `It knows ${Object.values(STITCHES)
    .map((s) => s[terms])
    .join(", ")}, and sk.`;
}

function helpHtml(terms: Terms): string {
  const t = (us: string, uk: string) => (terms === "us" ? us : uk);
  return `
    <ul class="hint">
      <li>One round or row to a box, its stitches with commas between: <code>${t("ch 3, 11 dc in ring, sl st to join", "ch 3, 11 tr in ring, ss to join")}</code>.</li>
      <li>A number before a stitch makes that many, one in each stitch: <code>${t("3 sc", "3 dc")}</code>. Into one stitch, a fan or shell: <code>${t("5 dc in next", "5 tr in next")}</code>, or brackets: <code>${t("(3 dc, ch 2, 3 dc) in next sp", "(3 tr, ch 2, 3 tr) in next sp")}</code>.</li>
      <li>Repeats between stars: <code>${t("*sc, ch 3, sk 1* x 6", "*dc, ch 3, sk 1* x 6")}</code>, or <code>around</code> / <code>across</code> to the end. <code>${t("2 sc in each st around", "2 dc in each st around")}</code> works too.</li>
      <li><code>in same st</code> goes into the stitch just worked; <code>in next sp</code> under the next chains; <code>sk 2</code> leaves two.</li>
      <li>Chains at the start of a round or row stand up as its turning chain. <code>sl st to join</code> closes a round.</li>
      <li>In rows, each row is worked back along the one before. Along a spiral, the first row is the spiral chain and the rows after are worked back along it.</li>
    </ul>`;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
