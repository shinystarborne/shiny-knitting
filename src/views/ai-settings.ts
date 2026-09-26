import { api, type AiSettingsView, type ModelInfo } from "../api";
import { closestEl } from "../dom";

/**
 * Settings for the metadata model.
 *
 * The form leads with the address rather than a provider choice, because that
 * is the only thing that actually varies: a model on your own machine, one on
 * another machine on your network, and a hosted service are all just an
 * OpenAI-compatible endpoint.
 *
 * It states plainly where the pattern text goes. Whether that server is on
 * your sofa or across the internet is the one thing a user needs to know
 * before pressing the button, so it is worked out from the address and shown
 * rather than left to be discovered later.
 */
export class AiSettingsDialog {
  private root: HTMLElement;
  private settings: AiSettingsView;
  private onSaved: (settings: AiSettingsView) => void;

  private modelList: ModelInfo[] = [];
  private modelPicker!: HTMLSelectElement;

  constructor(
    root: HTMLElement,
    settings: AiSettingsView,
    onSaved: (settings: AiSettingsView) => void,
  ) {
    this.root = root;
    this.settings = settings;
    this.onSaved = onSaved;
  }

  open(): void {
    const s = this.settings;
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2>Metadata model</h2>
          <button class="ghost" data-act="close" aria-label="Close">×</button>
        </div>

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

    this.root.addEventListener("click", (e) => {
      const btn = closestEl(e.target, "button[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "close") this.close();
      if (act === "save") void this.save();
      if (act === "test") void this.test(btn as HTMLButtonElement);
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

  /** Saves first, so the test runs against what the user typed, not the
   * values that were there when the dialog opened. */
  private async test(button: HTMLButtonElement): Promise<void> {
    const result = this.root.querySelector('[data-el="testresult"]') as HTMLElement;
    button.disabled = true;
    button.textContent = "Testing...";
    result.textContent = "";
    result.className = "hint";
    try {
      await this.persist();
      const test = await api.testAiConnection();
      result.textContent = `Connected. ${test.modelCount} model${
        test.modelCount === 1 ? "" : "s"
      } available.`;
      result.className = "hint ok";
      this.modelList = test.models;
      this.fillModelPicker();
      this.settings = await api.getAiSettings();
      this.updatePrivacy();
    } catch (err) {
      result.textContent = message(err);
      result.className = "hint bad";
    } finally {
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
      baseUrl: get("baseUrl").value.trim(),
      model: get("model").value.trim(),
      reasoningEffort: get("reasoningEffort").value,
      maxCharacters: Number(get("maxCharacters").value) || 4000,
      skipExisting: get("skipExisting").checked,
      applyAutomatically: get("applyAutomatically").checked,
      rescanExisting: get("rescanExisting").checked,
    };
  }

  private async persist(): Promise<AiSettingsView> {
    const keyField = this.root.querySelector('[data-f="apiKey"]') as HTMLInputElement;
    // An empty field means "keep the saved key", not "delete it".
    const typed = keyField.value.trim();
    this.settings = await api.saveAiSettings(this.collect(), typed || undefined);
    keyField.value = "";
    return this.settings;
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
  const host = url.trim().toLowerCase();
  if (!host) {
    return `<div class="privacy neutral">
      <strong>No server set.</strong>
      Until you enter an address, scanning is switched off.
    </div>`;
  }
  const local =
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("192.168.") ||
    host.includes("10.") ||
    /172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.includes(".local") ||
    host.includes(".lan") ||
    host.includes("[::1]");

  if (local) {
    return `<div class="privacy local">
      <strong>Private address.</strong>
      The excerpt is sent to <code>${escapeHtml(host)}</code>, which is this
      machine or your own network. Nothing reaches the internet.
    </div>`;
  }
  return `<div class="privacy remote">
    <strong>This is outside your network.</strong>
    The excerpt will be sent to <code>${escapeHtml(host)}</code> over the
    internet. Only the first part of each pattern is sent, but it does leave
    this machine.
  </div>`;
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
