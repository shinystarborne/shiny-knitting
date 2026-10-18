import { api, type Abbreviation, type Masterclass, type MasterclassPart } from "../api";
import { askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";

/**
 * Abbreviations: the common ones a pattern writes (ssk, k2tog, m1l, w&t…),
 * each with what it means, and your own added to them. Shown in the
 * Cheatsheets tab as a glossary, and in a pattern's text when pointed at.
 * A masterclass video is linked where one's title names the technique.
 */

/** One the app knows. `also` are other ways of writing it; `names` what a video about it would be called. */
export interface Known {
  term: string;
  meaning: string;
  also?: string[];
  names?: string[];
}

/** The glossary's entry: one the app knows, or one of yours (`own`). */
export interface Entry extends Known {
  own?: Abbreviation;
}

export const KNOWN: Known[] = [
  { term: "alt", meaning: "Alternate: every other one." },
  { term: "approx", meaning: "Approximately." },
  { term: "beg", meaning: "Beginning: of the row or round." },
  { term: "BO", meaning: "Bind off (cast off): finish the stitches so they cannot unravel.", names: ["bind off", "cast off"] },
  { term: "CC", meaning: "Contrast colour: the second colour, not the main one." },
  { term: "cdd", meaning: "Centred double decrease: slip 2 together knitwise, knit 1, pass the 2 slipped stitches over. Three stitches become one, the middle one on top.", names: ["centred double decrease", "centered double decrease", "central double decrease"] },
  { term: "cn", meaning: "Cable needle." },
  { term: "CO", meaning: "Cast on.", names: ["cast on"] },
  { term: "cont", meaning: "Continue." },
  { term: "dec", meaning: "Decrease: one stitch fewer (or as many as it says)." },
  { term: "dpn", meaning: "Double-pointed needle(s).", also: ["dpns"] },
  { term: "foll", meaning: "Following." },
  { term: "GSR", meaning: "German short row: turn, slip the first stitch purlwise with the yarn in front, and pull the yarn over the needle to the back, so the stitch shows two legs (a double stitch). Knitted later as one.", names: ["german short row", "german short rows"] },
  { term: "DS", meaning: "Double stitch, from a German short row: its two legs are knitted (or purled) together as one stitch." },
  { term: "inc", meaning: "Increase: one stitch more (or as many as it says)." },
  { term: "k", meaning: "Knit." },
  { term: "k2tog", meaning: "Knit 2 together: put the right needle into the next 2 stitches as if to knit, and knit them as one. A decrease that leans right.", names: ["knit two together", "knit 2 together"] },
  { term: "k3tog", meaning: "Knit 3 together, as one stitch: a double decrease that leans right." },
  { term: "kfb", meaning: "Knit front and back: knit into the stitch, and before taking it off, knit into its back loop too. One stitch becomes two.", also: ["kf&b", "k1fb"], names: ["knit front and back"] },
  { term: "ktbl", meaning: "Knit through the back loop: the stitch knitted twisted.", also: ["k tbl", "k1 tbl", "k1tbl"], names: ["through the back loop", "twisted stitch"] },
  { term: "kwise", meaning: "Knitwise: as if to knit." },
  { term: "LH", meaning: "Left-hand (needle)." },
  { term: "m1", meaning: "Make 1: lift the bar between two stitches onto the left needle, and knit it through the back loop. One stitch more.", names: ["make one", "make 1"] },
  { term: "m1l", meaning: "Make 1 left: lift the bar between two stitches from front to back, and knit it through the back loop. An increase that leans left.", names: ["make one left", "make 1 left"] },
  { term: "m1r", meaning: "Make 1 right: lift the bar between two stitches from back to front, and knit it through the front loop. An increase that leans right.", names: ["make one right", "make 1 right"] },
  { term: "m1p", meaning: "Make 1 purlwise: lift the bar between two stitches, and purl it through the back loop." },
  { term: "MB", meaning: "Make bobble: as the pattern says how.", names: ["bobble"] },
  { term: "MC", meaning: "Main colour." },
  { term: "p", meaning: "Purl." },
  { term: "p2tog", meaning: "Purl 2 together, as one stitch: a decrease.", names: ["purl two together", "purl 2 together"] },
  { term: "patt", meaning: "Pattern: work as the pattern says." },
  { term: "pfb", meaning: "Purl front and back: purl into the stitch, then into its back loop. One stitch becomes two." },
  { term: "pm", meaning: "Place marker." },
  { term: "psso", meaning: "Pass the slipped stitch over: lift it over the stitch just made and off the needle." },
  { term: "p2sso", meaning: "Pass the 2 slipped stitches over the stitch just made." },
  { term: "ptbl", meaning: "Purl through the back loop.", also: ["p tbl", "p1 tbl", "p1tbl"] },
  { term: "pwise", meaning: "Purlwise: as if to purl." },
  { term: "rem", meaning: "Remaining." },
  { term: "rep", meaning: "Repeat." },
  { term: "rnd", meaning: "Round.", also: ["rnds"] },
  { term: "RH", meaning: "Right-hand (needle)." },
  { term: "RS", meaning: "Right side: the side that shows." },
  { term: "sk2p", meaning: "Slip 1 knitwise, knit 2 together, pass the slipped stitch over: a double decrease that leans left.", also: ["sl1-k2tog-psso", "slip1-k2tog-psso", "s1-k2tog-psso", "sl1 k2tog psso", "sk2po"] },
  { term: "skp", meaning: "Slip 1 knitwise, knit 1, pass the slipped stitch over: a decrease that leans left.", also: ["skpo", "sl1-k1-psso", "sl1 k1 psso"] },
  { term: "sl", meaning: "Slip: move the stitch to the right needle without working it, purlwise unless it says." },
  { term: "sl1 wyif", meaning: "Slip 1 with the yarn in front.", also: ["sl 1 wyif", "s1 wyif"] },
  { term: "sl1 wyib", meaning: "Slip 1 with the yarn in back.", also: ["sl 1 wyib", "s1 wyib"] },
  { term: "sm", meaning: "Slip marker: move it from the left needle to the right." },
  { term: "ssk", meaning: "Slip, slip, knit: slip 2 stitches knitwise one at a time, put the left needle into their fronts, and knit them together. A decrease that leans left.", names: ["slip slip knit", "slip, slip, knit"] },
  { term: "ssp", meaning: "Slip, slip, purl: slip 2 stitches knitwise one at a time, put them back, and purl them together through the back loops. A decrease that leans left on the right side.", names: ["slip slip purl"] },
  { term: "sssk", meaning: "Slip, slip, slip, knit: three slipped knitwise and knitted together. A double decrease that leans left." },
  { term: "st", meaning: "Stitch.", also: ["sts"] },
  { term: "St st", meaning: "Stockinette (stocking) stitch: knit on the right side, purl on the wrong side; in the round, knit every round.", also: ["st st", "stst"] },
  { term: "tbl", meaning: "Through the back loop." },
  { term: "tog", meaning: "Together." },
  { term: "w&t", meaning: "Wrap and turn, for a short row: slip the next stitch, take the yarn to the other side, slip the stitch back, and turn. The wrap is picked up with its stitch later.", also: ["w+t", "w & t"], names: ["wrap and turn", "wrap & turn"] },
  { term: "WS", meaning: "Wrong side: the side that does not show." },
  { term: "wyib", meaning: "With the yarn in back." },
  { term: "wyif", meaning: "With the yarn in front." },
  { term: "yo", meaning: "Yarn over: bring the yarn over the right needle, making a stitch and a small hole.", also: ["yfwd", "yon"], names: ["yarn over"] },
];

/** The ones that are a letter and a count: k3 is knit 3, C6F a cable. */
const COUNTED: { re: RegExp; meaning: (m: RegExpExecArray) => string }[] = [
  { re: /^k(\d+)$/i, meaning: (m) => `Knit ${m[1]}.` },
  { re: /^p(\d+)$/i, meaning: (m) => `Purl ${m[1]}.` },
  { re: /^sl ?(\d+)$/i, meaning: (m) => `Slip ${m[1]}, purlwise unless it says.` },
  {
    re: /^c(\d+)([fb])$/i,
    meaning: (m) => {
      const n = Number(m[1]);
      const half = Math.floor(n / 2);
      const where = m[2].toLowerCase() === "f" ? "front" : "back";
      return `Cable ${n}, to the ${where}: slip ${half} to a cable needle held in ${where}, knit ${n - half}, then knit the ${half} from the cable needle. It leans ${where === "front" ? "left" : "right"}.`;
    },
  },
];
const COUNTED_SOURCE = String.raw`k\d+|p\d+|sl ?\d+|c\d+[fb]`;

/** The glossary: the ones the app knows, and yours, one of yours in place of a known one with its term. */
export function glossary(own: Abbreviation[]): Entry[] {
  const mine = new Map(own.map((a) => [a.term.toLowerCase(), a]));
  const known: Entry[] = KNOWN.map((k) => {
    const a = mine.get(k.term.toLowerCase());
    return a ? { ...k, meaning: a.meaning, own: a } : k;
  });
  const extra = own.filter((a) => !KNOWN.some((k) => k.term.toLowerCase() === a.term.toLowerCase())).map((a) => ({ term: a.term, meaning: a.meaning, own: a }));
  return [...known, ...extra].sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
}

/** One found in a text: where it is, as written, and what it means. */
export interface Found {
  start: number;
  end: number;
  text: string;
  entry: Entry;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");

/**
 * Every abbreviation in a line of text, longest first where they overlap
 * ("k2tog" before "k"), and only as words of their own: "k" is not found in
 * "knit", nor "st" in "first".
 */
export function findAbbreviations(text: string, entries: Entry[]): Found[] {
  const byForm = new Map<string, Entry>();
  for (const e of entries) for (const form of [e.term, ...(e.also ?? [])]) byForm.set(form.toLowerCase().replace(/\s+/g, " "), e);
  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![A-Za-z0-9])(${forms.map(escapeRe).join("|")}|${COUNTED_SOURCE})(?![A-Za-z0-9])`, "gi");
  const out: Found[] = [];
  for (const m of text.matchAll(re)) {
    const said = m[1];
    const key = said.toLowerCase().replace(/\s+/g, " ");
    let entry = byForm.get(key);
    if (!entry) {
      for (const c of COUNTED) {
        const cm = c.re.exec(said);
        if (cm) {
          entry = { term: said, meaning: c.meaning(cm) };
          break;
        }
      }
    }
    if (entry) out.push({ start: m.index!, end: m.index! + said.length, text: said, entry });
  }
  return out;
}

/**
 * A masterclass video about it, when there is one: one whose title (or its
 * masterclass's) names it. A technique (ssk, w&t) by its abbreviation or its
 * name; one of yours by its term. Plain words (rep, st) are not looked for.
 */
export function videoFor(entry: Entry, masterclasses: Masterclass[]): { masterclass: Masterclass; part: MasterclassPart } | null {
  const forms = entry.names || entry.own ? [entry.term, ...(entry.also ?? []), ...(entry.names ?? [])].filter((f) => f.length >= 2) : [];
  if (!forms.length) return null;
  const re = new RegExp(`(?<![A-Za-z0-9])(${forms.map(escapeRe).join("|")})(?![A-Za-z0-9])`, "i");
  for (const m of masterclasses) {
    for (const part of m.parts) if (re.test(part.title)) return { masterclass: m, part };
    if (re.test(m.title)) return { masterclass: m, part: m.parts[0] };
  }
  return null;
}

/** Yours and the masterclasses, read once and shared by the glossary and the reader. */
export async function loadGlossary(): Promise<{ entries: Entry[]; masterclasses: Masterclass[] }> {
  const [own, masterclasses] = await Promise.all([api.listAbbreviations().catch(() => [] as Abbreviation[]), api.listMasterclasses().catch(() => [] as Masterclass[])]);
  return { entries: glossary(own), masterclasses };
}

/**
 * The glossary as the Cheatsheets tab shows it: looked up by typing, yours
 * added, changed or taken away, and a video opened where one covers it.
 */
export class AbbreviationsPanel {
  private host: HTMLElement;
  private entries: Entry[] = [];
  private masterclasses: Masterclass[] = [];
  private query = "";
  /** The one of yours being changed, by id. */
  private editing = "";

  constructor(host: HTMLElement) {
    this.host = host;
  }

  async mount(): Promise<void> {
    // Its own element, so its listeners go with it when another sheet is opened.
    const own = document.createElement("div");
    own.className = "abbr-panel";
    this.host.append(own);
    this.host = own;
    this.host.innerHTML = `
      <header class="sheet-head">
        <h2 class="abbr-title">Abbreviations</h2>
        <span class="hint sheet-source">What a pattern's ssk, k2tog or w&amp;t means. In a pattern, point at one to see it.</span>
      </header>
      <div class="abbr-body">
        <input class="abbr-search" data-f="abbr-search" type="search" placeholder="Look one up: ssk, m1l, wrap…" aria-label="Look one up" />
        <form class="abbr-add" data-el="abbr-add">
          <input data-f="abbr-term" placeholder="Your own: e.g. CDD" aria-label="The abbreviation" maxlength="40" />
          <input data-f="abbr-meaning" placeholder="What it means" aria-label="What it means" maxlength="1000" />
          <button class="primary" type="submit" data-el="abbr-save">Add</button>
          <button class="ghost" type="button" data-act="abbr-cancel" hidden>Cancel</button>
        </form>
        <p class="hint abbr-add-hint">One of yours with the same letters as one here is shown in its place: a designer's own meaning, say.</p>
        <table class="abbr-table"><tbody data-el="abbr-rows"></tbody></table>
      </div>`;
    this.host.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).dataset.f === "abbr-search") {
        this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
        this.paintRows();
      }
    });
    this.host.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.saveOwn();
    });
    this.host.addEventListener("click", (e) => void this.onClick(e));
    ({ entries: this.entries, masterclasses: this.masterclasses } = await loadGlossary());
    this.paintRows();
  }

  private shown(): Entry[] {
    const q = this.query;
    if (!q) return this.entries;
    return this.entries.filter((e) => [e.term, ...(e.also ?? []), ...(e.names ?? [])].some((f) => f.toLowerCase().includes(q)) || e.meaning.toLowerCase().includes(q));
  }

  private paintRows(): void {
    const rows = this.host.querySelector<HTMLElement>('[data-el="abbr-rows"]')!;
    const shown = this.shown();
    rows.innerHTML = shown.length
      ? shown
          .map((e) => {
            const video = videoFor(e, this.masterclasses);
            return `
          <tr class="abbr-row${e.own ? " own" : ""}" data-term="${esc(e.term)}">
            <th>${esc(e.term)}${e.also?.length ? `<span class="hint abbr-also">${esc(e.also.join(", "))}</span>` : ""}</th>
            <td>
              ${esc(e.meaning)}
              ${video ? `<button class="link abbr-video" data-act="abbr-video" data-url="${esc(video.part.url)}" title="From your masterclasses: ${esc(video.masterclass.title)}">▶ ${esc(video.part.title)}</button>` : ""}
            </td>
            <td class="abbr-tools">
              ${
                e.own
                  ? `<span class="pill" title="One of yours">Yours</span>
                     <button class="ghost" data-act="abbr-edit" data-id="${esc(e.own.id)}">Change</button>
                     <button class="ghost danger-text" data-act="abbr-remove" data-id="${esc(e.own.id)}">Remove</button>`
                  : ""
              }
            </td>
          </tr>`;
          })
          .join("")
      : `<tr><td class="hint">None by that. Add it as one of your own, above.</td></tr>`;
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    const act = btn?.dataset.act;
    if (!btn || !act) return;
    if (act === "abbr-video") await api.openLink(btn.dataset.url!).catch((err) => say(err instanceof Error ? err.message : String(err), "Masterclass"));
    if (act === "abbr-edit") {
      const own = this.entries.find((x) => x.own?.id === btn.dataset.id)?.own;
      if (!own) return;
      this.editing = own.id;
      this.field("abbr-term").value = own.term;
      this.field("abbr-meaning").value = own.meaning;
      this.formMode();
      this.field("abbr-meaning").focus();
    }
    if (act === "abbr-cancel") this.clearForm();
    if (act === "abbr-remove") {
      const own = this.entries.find((x) => x.own?.id === btn.dataset.id)?.own;
      if (!own || !(await askYesNo(`Take “${own.term}” out of your abbreviations?`, { okLabel: "Remove", danger: true }))) return;
      await api.removeAbbreviation(own.id);
      if (this.editing === own.id) this.clearForm();
      await this.reload();
    }
  }

  private field(name: string): HTMLInputElement {
    return this.host.querySelector<HTMLInputElement>(`[data-f="${name}"]`)!;
  }

  private formMode(): void {
    this.host.querySelector<HTMLElement>('[data-el="abbr-save"]')!.textContent = this.editing ? "Save" : "Add";
    this.host.querySelector<HTMLElement>('[data-act="abbr-cancel"]')!.hidden = !this.editing;
  }

  private clearForm(): void {
    this.editing = "";
    this.field("abbr-term").value = "";
    this.field("abbr-meaning").value = "";
    this.formMode();
  }

  private async saveOwn(): Promise<void> {
    const term = this.field("abbr-term").value;
    const meaning = this.field("abbr-meaning").value;
    try {
      const saved = await api.saveAbbreviation({ id: this.editing || null, term, meaning });
      this.clearForm();
      await this.reload();
      this.host.querySelector(`[data-term="${CSS.escape(saved.term)}"]`)?.scrollIntoView({ block: "nearest" });
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Abbreviations");
    }
  }

  private async reload(): Promise<void> {
    ({ entries: this.entries, masterclasses: this.masterclasses } = await loadGlossary());
    this.paintRows();
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
