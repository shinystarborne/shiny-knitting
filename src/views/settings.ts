import { api, type AiSettingsView, type ModelInfo, type UpdateInfo, type UpdateSettings } from "../api";
import { closestEl } from "../dom";

/**
 * The app settings: updates first, then describing patterns with a model,
 * which is off unless switched on; its settings show only once it is.
 *
 * The model form leads with the address rather than a provider choice, because
 * that is the only thing that actually varies: a model on your own machine, one
 * on another machine on your network, and a hosted service are all just an
 * OpenAI-compatible endpoint.
 *
 * It states plainly where the pattern text goes. Whether that server is on
 * your sofa or across the internet is the one thing a user needs to know
 * before pressing the button, so it is worked out from the address and shown
 * rather than left to be discovered later.
 */
export class SettingsDialog {
  private root: HTMLElement;
  private settings: AiSettingsView;
  /** What was saved when the dialog opened; a connection test rolls back to this. */
  private savedSnapshot: AiSettingsView;
  private updateSettings: UpdateSettings;
  /** The update a check found, kept so a failed download can offer it again. */
  private availableUpdate: UpdateInfo | null = null;
  private onSaved: (settings: AiSettingsView) => void;

  private modelList: ModelInfo[] = [];
  private modelPicker!: HTMLSelectElement;

  constructor(
    root: HTMLElement,
    settings: AiSettingsView,
    updateSettings: UpdateSettings,
    onSaved: (settings: AiSettingsView) => void,
  ) {
    this.root = root;
    this.settings = settings;
    this.savedSnapshot = settings;
    this.updateSettings = updateSettings;
    this.onSaved = onSaved;
  }

  open(): void {
    const s = this.settings;
    const u = this.updateSettings;
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2>Settings</h2>
          <button class="ghost" data-act="close" aria-label="Close">×</button>
        </div>

        <h3>Updates</h3>
        <p class="modal-intro">You have ${escapeHtml(u.currentVersion)}.</p>

        <label class="check">
          <input type="checkbox" data-f="includeBeta" ${u.includeBeta ? "checked" : ""} />
          <span>Include beta releases</span>
        </label>
        <label class="check">
          <input type="checkbox" data-f="checkOnStartup" ${u.checkOnStartup ? "checked" : ""} />
          <span>Check automatically on startup</span>
        </label>

        <div class="model-row">
          <button class="ghost" data-act="check-updates">Check for updates</button>
        </div>
        <em class="hint block" data-el="update-result"></em>

        <h3>Describe patterns with a model</h3>
        <label class="check">
          <input type="checkbox" data-f="enabled" ${s.enabled ? "checked" : ""} />
          <span>Use a model to fill in a pattern's details (designer, difficulty, needles, yarn, tags)</span>
        </label>
        <p class="hint block ai-rights">
          The model never gets the whole pattern. Only its first pages are sent, the part
          with the designer, sizes, gauge and materials, out of respect for the designer's
          work; the rest of the pattern stays on your computer.
        </p>

        <div data-el="ai-section" ${s.enabled ? "" : "hidden"}>
        <p class="modal-intro">
          Any model that serves an OpenAI-compatible API will work — Ollama,
          LM Studio, vLLM, llama.cpp, or a hosted service.
        </p>

        <label class="field">
          <span>Server address</span>
          <input data-f="baseUrl" value="${escapeAttr(s.baseUrl)}"
            placeholder="http://192.168.1.20:1234/v1" />
          <em class="hint">The <code>/v1</code> is added for you if you leave it off.</em>
        </label>

        <div class="privacy" data-el="privacy"></div>

        <label class="field">
          <span>Model</span>
          <div class="model-row">
            <input data-f="model" value="${escapeAttr(s.model)}" placeholder="model name" />
            <button class="ghost" data-act="test">Test connection</button>
          </div>
          <select data-el="models" class="model-picker" hidden></select>
          <em class="hint" data-el="testresult"></em>
        </label>

        <label class="field">
          <span>API key <em class="optional">optional</em></span>
          <input data-f="apiKey" type="password" autocomplete="off"
            placeholder="${s.hasApiKey ? "A key is saved. Type to replace it." : "Usually not needed for a local model"}" />
          <em class="hint">
            ${
              s.hasApiKey
                ? "A key is saved and encrypted with Windows. Leave this empty to keep it."
                : "A local model server usually needs none."
            }
          </em>
        </label>

        <details class="advanced">
          <summary>More options</summary>

          <label class="field">
            <span>Reasoning effort</span>
            <select data-f="reasoningEffort">
              ${["", "low", "medium", "high"]
                .map(
                  (v) =>
                    `<option value="${v}" ${
                      s.reasoningEffort === v ? "selected" : ""
                    }>${v === "" ? "Model's own default" : v}</option>`,
                )
                .join("")}
            </select>
            <em class="hint">
              Lower is faster and cheaper. A reasoning model can otherwise use
              its whole reply budget thinking and send back nothing.
            </em>
          </label>

          <label class="field">
            <span>Text to send <em>${s.maxCharacters} characters</em></span>
            <input type="range" data-f="maxCharacters" min="500" max="20000" step="500"
              value="${s.maxCharacters}" />
            <em class="hint">
              The start of the pattern only. Gauge, size and materials are all
              in the first page or two.
            </em>
          </label>

          <label class="check">
            <input type="checkbox" data-f="skipExisting" ${s.skipExisting ? "checked" : ""} />
            <span>Only fill in fields that are still empty</span>
          </label>
          <em class="hint block">
            On by default, so a scan never overwrites something you have already
            written. Turn it off to let a scan replace your wording.
          </em>

          <label class="check">
            <input type="checkbox" data-f="applyAutomatically" ${s.applyAutomatically ? "checked" : ""} />
            <span>Save results without asking</span>
          </label>
          <em class="hint block">
            On by default. You can still undo any pattern afterwards, and edit
            anything the model got wrong.
          </em>

          <label class="check">
            <input type="checkbox" data-f="rescanExisting" ${s.rescanExisting ? "checked" : ""} />
            <span>Include patterns that already have metadata</span>
          </label>
        </details>
        </div>

        <div class="modal-actions">
          <button class="ghost" data-act="close">Cancel</button>
          <button class="primary" data-act="save">Save</button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
      </div>
    `;

    this.modelPicker = this.root.querySelector('[data-el="models"]') as HTMLSelectElement;
    this.updatePrivacy();
    this.bind();
  }

  private updatePrivacy(): void {
    const url = (this.root.querySelector('[data-f="baseUrl"]') as HTMLInputElement).value;
    const box = this.root.querySelector('[data-el="privacy"]') as HTMLElement;
    box.innerHTML = privacyNote(url);
  }

  private bind(): void {
    const baseInput = this.root.querySelector('[data-f="baseUrl"]') as HTMLInputElement;
    baseInput.addEventListener("input", () => this.updatePrivacy());
    // The model's own settings show only while it is switched on.
    const enabled = this.root.querySelector('[data-f="enabled"]') as HTMLInputElement;
    enabled.addEventListener("change", () => {
      (this.root.querySelector('[data-el="ai-section"]') as HTMLElement).hidden = !enabled.checked;
    });

    this.root.addEventListener("click", (e) => {
      const btn = closestEl(e.target, "button[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "close") this.close();
      if (act === "save") void this.save();
      if (act === "test") void this.test(btn as HTMLButtonElement);
      if (act === "check-updates") void this.checkUpdates(btn as HTMLButtonElement);
      if (act === "download-update") void this.downloadUpdate(btn as HTMLButtonElement);
    });

    // Clicking the backdrop dismisses; a click inside the form does not.
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });

    this.modelPicker.addEventListener("change", () => {
      const modelField = this.root.querySelector('[data-f="model"]') as HTMLInputElement;
      if (this.modelPicker.value) modelField.value = this.modelPicker.value;
    });
  }

  /**
   * The backend can only test the saved settings, so the form values are
   * saved for the duration of the test and rolled back afterwards. Testing
   * must not persist anything: otherwise pressing Cancel could no longer
   * cancel once a test had run. Only the model settings take part — the
   * update settings are left alone entirely, so a test can neither save nor
   * clobber them.
   */
  private async test(button: HTMLButtonElement): Promise<void> {
    const result = this.root.querySelector('[data-el="testresult"]') as HTMLElement;
    button.disabled = true;
    button.textContent = "Testing...";
    result.textContent = "";
    result.className = "hint";
    try {
      await this.persistAi();
      const test = await api.testAiConnection();
      result.textContent = `Connected. ${test.modelCount} model${
        test.modelCount === 1 ? "" : "s"
      } available.`;
      result.className = "hint ok";
      this.modelList = test.models;
      this.fillModelPicker();
    } catch (err) {
      result.textContent = message(err);
      result.className = "hint bad";
    } finally {
      // Roll back the save made for the test; the Save button is what saves.
      // One caveat: a freshly typed API key cannot be rolled back, because
      // the saved key is never readable, so an empty key field always means
      // "keep the current one".
      try {
        this.settings = await api.saveAiSettings(this.savedSnapshot);
      } catch {
        // A failed rollback leaves the tested values saved; reopening the
        // dialog still shows what is really stored.
      }
      this.updatePrivacy();
      button.disabled = false;
      button.textContent = "Test connection";
    }
  }

  private fillModelPicker(): void {
    if (!this.modelList.length) {
      this.modelPicker.hidden = true;
      return;
    }
    const current = (this.root.querySelector('[data-f="model"]') as HTMLInputElement).value;
    this.modelPicker.innerHTML =
      '<option value="">Choose a model from the server…</option>' +
      this.modelList
        .map(
          (m) =>
            `<option value="${escapeAttr(m.id)}" ${m.id === current ? "selected" : ""}>${escapeHtml(
              m.label,
            )}</option>`,
        )
        .join("");
    this.modelPicker.hidden = false;
  }

  private collect(): AiSettingsView {
    const get = (field: string) =>
      this.root.querySelector(`[data-f="${field}"]`) as HTMLInputElement;
    return {
      ...this.settings,
      enabled: get("enabled").checked,
      baseUrl: get("baseUrl").value.trim(),
      model: get("model").value.trim(),
      reasoningEffort: get("reasoningEffort").value,
      maxCharacters: Number(get("maxCharacters").value) || 4000,
      skipExisting: get("skipExisting").checked,
      applyAutomatically: get("applyAutomatically").checked,
      rescanExisting: get("rescanExisting").checked,
    };
  }

  private collectUpdates(): { includeBeta: boolean; checkOnStartup: boolean } {
    const get = (field: string) =>
      (this.root.querySelector(`[data-f="${field}"]`) as HTMLInputElement).checked;
    return { includeBeta: get("includeBeta"), checkOnStartup: get("checkOnStartup") };
  }

  /** Saves the model settings only; what a connection test saves and rolls back. */
  private async persistAi(): Promise<AiSettingsView> {
    const keyField = this.root.querySelector('[data-f="apiKey"]') as HTMLInputElement;
    // An empty field means "keep the saved key", not "delete it".
    const typed = keyField.value.trim();
    this.settings = await api.saveAiSettings(this.collect(), typed || undefined);
    keyField.value = "";
    return this.settings;
  }

  /** Saves both groups. Save is the only path that should reach this. */
  private async persist(): Promise<AiSettingsView> {
    const saved = await this.persistAi();
    await api.saveUpdateSettings(this.collectUpdates());
    return saved;
  }

  /**
   * A manual check, from the button. It reads the beta checkbox as it stands
   * rather than the saved setting: asking "is there anything newer, betas
   * included?" should not require saving that preference first.
   */
  private async checkUpdates(button: HTMLButtonElement): Promise<void> {
    const result = this.root.querySelector('[data-el="update-result"]') as HTMLElement;
    button.disabled = true;
    result.className = "hint block";
    result.textContent = "Checking…";
    try {
      const outcome = await api.checkForUpdate({ includeBeta: this.collectUpdates().includeBeta });
      if (!outcome.update) {
        this.availableUpdate = null;
        // The version and the time, so a second click visibly answers again
        // rather than leaving the same sentence there as if nothing happened.
        // checkedAt is in seconds, as the backend stores it.
        const at = new Date(outcome.checkedAt ? outcome.checkedAt * 1000 : Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        result.textContent = `You're on the newest version (${outcome.currentVersion}). Checked at ${at}.`;
      } else {
        this.availableUpdate = outcome.update;
        this.renderAvailable(result, outcome.update);
      }
    } catch (err) {
      result.className = "hint block bad";
      result.textContent = message(err);
    } finally {
      button.disabled = false;
    }
  }

  /** The result line for an available update, with its download button. */
  private renderAvailable(result: HTMLElement, update: UpdateInfo): void {
    result.textContent = `${update.name} is available${update.prerelease ? " (beta)" : ""}. `;
    result.appendChild(this.downloadButton());
  }

  private downloadButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "ghost";
    button.dataset.act = "download-update";
    button.textContent = "Update now";
    button.title = "Downloads it, then the app closes, updates itself and opens again. Your library is not touched.";
    return button;
  }

  /**
   * Downloads the installer and hands it to the OS. `installUpdate` exits the
   * app, so the "Starting the installer…" line after it is what the harness
   * sees; in the real app the window is usually gone first.
   */
  private async downloadUpdate(button: HTMLButtonElement): Promise<void> {
    const update = this.availableUpdate;
    if (!update) return;
    const result = this.root.querySelector('[data-el="update-result"]') as HTMLElement;
    button.disabled = true;
    button.textContent = "Downloading…";
    try {
      const path = await api.downloadUpdate({
        assetApiUrl: update.assetApiUrl,
        fileName: update.assetName,
      });
      await api.installUpdate({ path });
      result.textContent = "Starting the installer…";
    } catch (err) {
      // Show the reason and offer the download again, as it was.
      result.textContent = `${message(err)} `;
      result.appendChild(this.downloadButton());
    }
  }

  private async save(): Promise<void> {
    const button = this.root.querySelector('[data-act="save"]') as HTMLButtonElement;
    button.disabled = true;
    try {
      const saved = await this.persist();
      this.onSaved(saved);
      this.close();
    } catch (err) {
      const box = this.root.querySelector('[data-el="error"]') as HTMLElement;
      box.textContent = message(err);
      box.hidden = false;
      button.disabled = false;
    }
  }

  private close(): void {
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

/**
 * Describes where the text would go, based on the address. This is the point
 * of the dialog: the user should never have to guess whether a scan sends
 * their patterns somewhere.
 */
function privacyNote(url: string): string {
  const raw = url.trim();
  if (!raw) {
    return `<div class="privacy neutral">
      <strong>No server set.</strong>
      Until you enter an address, scanning is switched off.
    </div>`;
  }

  if (isPrivateAddress(raw)) {
    return `<div class="privacy local">
      <strong>Private address.</strong>
      The excerpt is sent to <code>${escapeHtml(raw)}</code>, which is this
      machine or your own network. Nothing reaches the internet.
    </div>`;
  }
  return `<div class="privacy remote">
    <strong>This is outside your network.</strong>
    The excerpt will be sent to <code>${escapeHtml(raw)}</code> over the
    internet. Only the first part of each pattern is sent, but it does leave
    this machine.
  </div>`;
}

/**
 * Whether an address points at this machine or a private network.
 *
 * The hostname is parsed rather than substring-matched: "110.25.0.4"
 * contains "10." but is a public address, and "192.168.example.com" only
 * starts like a private one. Anything that cannot be classified with
 * confidence is treated as the internet, so the notice never claims privacy
 * it cannot guarantee.
 */
function isPrivateAddress(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw.includes("://") ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  // IPv6 literals come back in brackets. Only ::1 (the loopback) is private;
  // anything else in this family is not confidently local.
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare === "::1") return true;
  if (bare.includes(":")) return false;

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (octets) {
    const parts = octets.slice(1).map(Number);
    if (parts.some((o) => o > 255)) return false;
    const [a, b] = parts;
    return (
      a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    );
  }

  // A name with no dot never reaches DNS; it is a machine on the local
  // network. Anything with a dot resolves publicly.
  return !host.includes(".");
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(v: string): string {
  return escapeHtml(v).replace(/"/g, "&quot;");
}
