import { api, MEASUREMENTS, type MeasureUnit, type MeasurementSet, type Person, type Project } from "../api";
import { askText, askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";
import { fromDateInput, longDate, toDateInput } from "./project-form";
import {
  CARD_MEASUREMENTS,
  change,
  latestShoeSize,
  latestValue,
  measurementKeys,
  measurementLabel,
  readLength,
  showLength,
  showLengthWithUnit,
  unitLabel,
} from "./measure";
import { matches } from "./shopping";

/**
 * The People tab: the people you knit for, a card each with their latest
 * measurements, and a page each with every time they were measured.
 */
export class PeopleView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private results!: HTMLElement;
  private people: Person[] = [];
  private unit: MeasureUnit = "cm";
  private search = "";

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library people";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>People</h1>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search names and notes..." />
          <button data-act="add" class="primary">+ Add a person</button>
        </div>
      </header>
      <main class="results person-grid"></main>
    `;
    this.screen.appendChild(this.root);
    this.results = this.root.querySelector(".results")!;
    const box = this.root.querySelector<HTMLInputElement>(".search")!;
    box.addEventListener("input", () => {
      this.search = box.value;
      this.paint();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));
    [this.people, this.unit] = await Promise.all([api.listPeople(), api.getMeasureUnit().catch(() => "cm" as const)]);
    this.paint();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn?.dataset.act === "add") {
      const name = await askText("Who is it?", { title: "Add a person", placeholder: "e.g. Mo", okLabel: "Add" });
      if (name === null) return;
      try {
        const person = await api.addPerson({ name, notes: "", extra: [] });
        this.open(person.id);
      } catch (err) {
        await say(err instanceof Error ? err.message : String(err), "Add a person");
      }
      return;
    }
    if (btn?.dataset.act === "remove") {
      const person = this.people.find((p) => p.id === btn.dataset.id);
      if (person && (await confirmRemove(person))) {
        await api.deletePerson(person.id).catch((err) => say(err instanceof Error ? err.message : String(err), "Remove"));
        this.people = await api.listPeople();
        this.paint();
      }
      return;
    }
    const card = closestEl(e.target, "[data-open]");
    if (card) this.open(card.dataset.open!);
  }

  private open(id: string): void {
    this.root.dispatchEvent(new CustomEvent("open-person", { bubbles: true, detail: id }));
  }

  private paint(): void {
    const shown = this.people.filter((p) => matches(`${p.name} ${p.notes} ${p.extra.join(" ")}`, this.search));
    if (!shown.length) {
      this.results.innerHTML = `
        <div class="empty">
          <h2>${this.people.length ? "No one matches that" : "No one here yet"}</h2>
          <p>${this.people.length ? "The search looks through names and notes." : "Add the people you knit for, with their measurements: chest, head, feet… and the date, since children grow."}</p>
        </div>`;
      return;
    }
    this.results.innerHTML = shown.map((p) => cardHtml(p, this.unit)).join("");
  }
}

function confirmRemove(person: Person): Promise<boolean> {
  const projects = person.projectCount
    ? `\n\n${person.projectCount === 1 ? "The project for them stays" : `The ${person.projectCount} projects for them stay`}, for no one in particular.`
    : "";
  return askYesNo(`Remove ${person.name} and all their measurements?${projects}\n\nThis cannot be undone.`, {
    title: "Remove person",
    okLabel: "Remove",
    danger: true,
  });
}

function cardHtml(p: Person, unit: MeasureUnit): string {
  const known = CARD_MEASUREMENTS.map((key) => ({ key, v: latestValue(p, key) })).filter((m) => m.v);
  const shoe = latestShoeSize(p);
  const measured = p.sets.filter((s) => Object.keys(s.values).length || s.shoeSize);
  const when = measured.length
    ? `Measured ${longDate(measured[0].measuredAt)}${measured.length > 1 ? ` · ${measured.length} times` : ""}`
    : "Not measured yet";
  const rows = [
    ...known.map((m) => `<li><span>${esc(measurementLabel(m.key))}</span><b>${esc(showLengthWithUnit(m.v!.cm, unit))}</b></li>`),
    ...(shoe ? [`<li><span>Shoe size</span><b>${esc(shoe)}</b></li>`] : []),
  ];
  return `
    <article class="person-card" data-open="${esc(p.id)}">
      <div class="person-head">
        <span class="person-initial">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <div>
          <h3>${esc(p.name)}</h3>
          <p class="hint">${esc(when)}</p>
        </div>
      </div>
      ${rows.length ? `<ul class="person-measures">${rows.join("")}</ul>` : `<p class="hint person-none">Open to add their measurements.</p>`}
      ${p.notes ? `<p class="person-notes">${esc(p.notes)}</p>` : ""}
      <div class="card-tools-row">
        ${p.projectCount ? `<span class="hint">${p.projectCount === 1 ? "1 project" : `${p.projectCount} projects`} for them</span>` : ""}
        <span class="spacer"></span>
        <button class="card-remove" data-act="remove" data-id="${esc(p.id)}" title="Remove this person">Remove</button>
      </div>
    </article>`;
}

export interface PersonPageHooks {
  back(): void;
  openProject(id: string): void;
}

/**
 * One person's page: their name and notes down the side, with the projects
 * for them, and a table of their measurements filling the rest: a row per
 * measurement, a column per time they were measured, the newest first, each
 * newer value showing how much it changed. Everything saves as it is changed.
 */
export class PersonPage {
  private screen: HTMLElement;
  private personId: string;
  private hooks: PersonPageHooks;
  private root!: HTMLElement;
  private person!: Person;
  private projects: Project[] = [];
  private unit: MeasureUnit = "cm";
  /** Saves run one after another, so a quick second edit cannot overtake the first. */
  private saving: Promise<unknown> = Promise.resolve();
  private typingTimer: number | null = null;

  constructor(screen: HTMLElement, personId: string, hooks: PersonPageHooks) {
    this.screen = screen;
    this.personId = personId;
    this.hooks = hooks;
  }

  get id(): string {
    return this.personId;
  }

  async mount(): Promise<void> {
    try {
      [this.person, this.projects, this.unit] = await Promise.all([
        api.getPerson(this.personId),
        api.listProjects().catch(() => [] as Project[]),
        api.getMeasureUnit().catch(() => "cm" as const),
      ]);
    } catch {
      await say("That person is no longer there.");
      this.hooks.back();
      return;
    }
    this.root = document.createElement("div");
    this.root.className = "person-page";
    this.root.innerHTML = `
      <header class="inspo-bar">
        <button class="ghost back" data-act="back">← People</button>
        <input class="inspo-name" data-f="name" value="${esc(this.person.name)}" aria-label="Name" placeholder="Their name" />
        <span class="hint inspo-saved" data-el="saved">Saved</span>
        <button class="ghost danger-text" data-act="remove-person">Remove person</button>
      </header>
      <div class="person-body">
        <aside class="person-side">
          <label class="field">
            <span>Notes</span>
            <textarea data-f="notes" placeholder="Colours they like, fibres they cannot wear (wool allergy!), how they like things to fit…">${esc(this.person.notes)}</textarea>
          </label>
          <div class="side-section" data-el="projects"></div>
        </aside>
        <main class="person-main">
          <div class="person-toolbar">
            <h2>Measurements <span class="hint">in ${unitLabel(this.unit) === "cm" ? "centimetres" : "inches"}; change it in Settings</span></h2>
            <span class="spacer"></span>
            <button class="primary" data-act="measure">+ Measure again</button>
          </div>
          <div class="measure-wrap" data-el="table"></div>
          <button class="ghost" data-act="add-extra">+ Add a measurement of their own</button>
        </main>
      </div>
    `;
    this.screen.appendChild(this.root);
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("change", (e) => void this.onChange(e));
    this.root.addEventListener("input", (e) => {
      const f = (e.target as HTMLElement).dataset.f;
      if (f !== "name" && f !== "notes") return;
      this.mark("Saving…");
      if (this.typingTimer !== null) clearTimeout(this.typingTimer);
      this.typingTimer = window.setTimeout(() => void this.saveDetails(), 600);
    });
    this.root.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement;
      // Enter moves down a column, as in a spreadsheet; in the name it is done.
      if (e.key !== "Enter" || target.tagName !== "INPUT") return;
      e.preventDefault();
      if (target.dataset.f === "name") return target.blur();
      const cells = [...this.root.querySelectorAll<HTMLInputElement>(`input[data-set="${target.dataset.set}"]`)];
      const next = cells[cells.indexOf(target as HTMLInputElement) + 1];
      if (next) next.focus();
      else target.blur();
    });
    this.renderProjects();
    this.renderTable();
  }

  /** Saves a name or notes still being typed. */
  destroy(): void {
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
      void this.saveDetails();
    }
    this.root?.remove();
  }

  private mark(text: string): void {
    const el = this.root?.querySelector<HTMLElement>('[data-el="saved"]');
    if (el) el.textContent = text;
  }

  private value(name: string): string {
    return this.root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-f="${name}"]`)?.value ?? "";
  }

  private async saveDetails(extra = this.person.extra): Promise<void> {
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    const name = this.value("name").trim() || this.person.name;
    await this.save(() => api.updatePerson(this.personId, { name, notes: this.value("notes"), extra }));
    this.mark("Saved");
  }

  /** Runs a change after any before it, and takes the person it returns. */
  private save(run: () => Promise<Person>): Promise<boolean> {
    const done = this.saving.then(async () => {
      try {
        this.person = await run();
        return true;
      } catch (err) {
        await say(err instanceof Error ? err.message : String(err), this.person.name);
        return false;
      }
    });
    this.saving = done;
    return done;
  }

  private renderProjects(): void {
    const mine = this.projects.filter((p) => p.personId === this.personId);
    this.root.querySelector<HTMLElement>('[data-el="projects"]')!.innerHTML = `
      <h3>Projects for them</h3>
      ${
        mine.length
          ? `<ul class="person-projects">${mine.map((p) => `<li><button class="link" data-act="open-project" data-id="${esc(p.id)}">${esc(p.name)}</button></li>`).join("")}</ul>`
          : `<p class="hint">None yet. A project's page says who it is for.</p>`
      }`;
  }

  /** Draws the table again, keeping the focus where it was. */
  private renderTable(): void {
    const focused = document.activeElement as HTMLElement | null;
    const keep = focused?.dataset.set ? `[data-set="${focused.dataset.set}"][data-key="${focused.dataset.key ?? ""}"]` : null;
    const sets = this.person.sets;
    const keys = measurementKeys(this.person);
    const header = sets
      .map(
        (s, i) => `
        <th class="measure-date">
          <input type="date" data-set="${esc(s.id)}" data-key="date" value="${toDateInput(s.measuredAt)}" aria-label="Measured on" />
          ${i === 0 ? `<span class="hint">latest</span>` : ""}
          <button class="ghost measure-remove" data-act="remove-set" data-id="${esc(s.id)}" title="Remove these measurements">×</button>
        </th>`,
      )
      .join("");
    const row = (key: string) => {
      const standard = MEASUREMENTS.find((m) => m.key === key);
      const label = `<th class="measure-label" title="${esc(standard?.hint ?? "One of their own")}">
          ${esc(measurementLabel(key))}
          ${standard ? `<span class="measure-help" aria-hidden="true">?</span>` : `<button class="ghost measure-remove" data-act="remove-extra" data-name="${esc(key.slice(2))}" title="Remove this measurement, from every date">×</button>`}
        </th>`;
      const cells = sets
        .map((s, i) => {
          const before = sets.slice(i + 1).find((o) => o.values[key])?.values[key];
          const delta = change(sets, i, key, this.unit);
          return `<td>
            <input data-set="${esc(s.id)}" data-key="${esc(key)}" inputmode="decimal" value="${esc(showLength(s.values[key], this.unit))}"
              placeholder="${esc(i === 0 && before ? showLength(before, this.unit) : "")}" aria-label="${esc(measurementLabel(key))}" />
            ${delta ? `<span class="measure-delta" title="Since they were last measured">${esc(delta)}</span>` : ""}
          </td>`;
        })
        .join("");
      return `<tr>${label}${cells}</tr>`;
    };
    const shoe = `<tr><th class="measure-label" title="As you buy them: EU 39, US 8">Shoe size</th>${sets
      .map((s) => `<td><input data-set="${esc(s.id)}" data-key="shoe" value="${esc(s.shoeSize)}" placeholder="" aria-label="Shoe size" /></td>`)
      .join("")}</tr>`;
    const host = this.root.querySelector<HTMLElement>('[data-el="table"]')!;
    host.innerHTML = sets.length
      ? `<table class="measure-table">
          <thead><tr><th class="measure-corner">${esc(unitLabel(this.unit))}</th>${header}</tr></thead>
          <tbody>${keys.map(row).join("")}${shoe}</tbody>
        </table>`
      : `<p class="hint">No measurements yet: + Measure again starts a set dated today.</p>`;
    if (keep) host.querySelector<HTMLInputElement>(keep)?.focus();
  }

  private set(id: string): MeasurementSet | undefined {
    return this.person.sets.find((s) => s.id === id);
  }

  private async onChange(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const f = input.dataset.f;
    if (f === "name" || f === "notes") return void (await this.saveDetails());
    const set = input.dataset.set ? this.set(input.dataset.set) : undefined;
    if (!set) return;
    const key = input.dataset.key!;
    const next = { measuredAt: set.measuredAt, values: { ...set.values }, shoeSize: set.shoeSize };
    if (key === "date") {
      if (!input.value) return this.renderTable();
      next.measuredAt = fromDateInput(input.value);
    } else if (key === "shoe") {
      next.shoeSize = input.value;
    } else {
      const cm = readLength(input.value, this.unit);
      if (Number.isNaN(cm)) {
        await say(`“${input.value}” is not a length. Type a number, like 91.5, or one with its unit: 36 in, 91 cm.`, measurementLabel(key));
        return this.renderTable();
      }
      if (cm) next.values[key] = cm;
      else delete next.values[key];
    }
    if (await this.save(() => api.updateMeasurementSet(set.id, next))) this.mark("Saved");
    this.renderTable();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    const act = btn?.dataset.act;
    if (act === "back") this.hooks.back();
    if (act === "open-project") this.hooks.openProject(btn!.dataset.id!);
    if (act === "measure") {
      if (await this.save(() => api.addMeasurementSet(this.personId, { measuredAt: Date.now(), values: {}, shoeSize: "" }))) {
        this.renderTable();
        this.root.querySelector<HTMLInputElement>(`input[data-set="${this.person.sets[0].id}"][data-key="height"]`)?.focus();
      }
    }
    if (act === "remove-set") {
      const set = this.set(btn!.dataset.id!);
      if (!set) return;
      const ok = await askYesNo(`Remove the measurements from ${longDate(set.measuredAt)}?`, { title: "Remove measurements", okLabel: "Remove", danger: true });
      if (ok && (await this.save(() => api.deleteMeasurementSet(set.id)))) this.renderTable();
    }
    if (act === "add-extra") {
      const name = await askText("What is the measurement called?", { title: "A measurement of their own", placeholder: "e.g. Thumb length, Calf", okLabel: "Add" });
      if (!name?.trim()) return;
      await this.saveDetails([...this.person.extra, name.trim()]);
      this.renderTable();
    }
    if (act === "remove-extra") {
      const name = btn!.dataset.name!;
      const ok = await askYesNo(`Remove “${name}”, and what it measured on every date?`, { title: "Remove measurement", okLabel: "Remove", danger: true });
      if (!ok) return;
      await this.saveDetails(this.person.extra.filter((e) => e !== name));
      this.renderTable();
    }
    if (act === "remove-person" && (await confirmRemove(this.person))) {
      try {
        await api.deletePerson(this.personId);
      } catch (err) {
        return void (await say(err instanceof Error ? err.message : String(err), "Remove"));
      }
      this.typingTimer = null;
      this.hooks.back();
    }
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
