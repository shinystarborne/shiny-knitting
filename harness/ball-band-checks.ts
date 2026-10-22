/**
 * Checks for the yarn form read from a photo of the ball band: offered only
 * with a model set up; the photo sent as a picture the model can read; what
 * is empty filled in from it and marked, what is typed kept; and a photo
 * that cannot be read said so.
 *
 * Run with the harness open:
 *   window.__ballBandChecks()
 */
import type { AiSettingsView, BallBand } from "../src/api";

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

const BAND: BallBand = {
  brand: "Drops",
  name: "Band Check",
  colourway: "01 Off white",
  dyeLot: "4521",
  weight: "Aran",
  metresPerBall: 150,
  gramsPerBall: 50,
  fibres: [
    { name: "alpaca", percent: 65 },
    { name: "polyamide", percent: 28 },
    { name: "wool", percent: 7 },
  ],
  superwash: false,
  gaugeSts: 17,
  gaugeRows: 22,
  needleFrom: 5,
  needleTo: 5.5,
  care: ["hand-wash", "no-bleach", "dry-flat"],
};

type Store = { aiSettings: AiSettingsView | null; ballBand?: BallBand; ballBandError?: string; ballBandImage?: string };

export async function verifyBallBand() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const invoke = <T>(cmd: string) => (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, {});
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal.yarn-form");
  const field = (f: string) => modal()!.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!;
  const row = () => modal()?.querySelector<HTMLElement>('[data-el="band-read"]');
  const status = () => modal()?.querySelector('[data-el="band-status"]')?.textContent ?? "";
  const open = async () => {
    document.querySelector<HTMLElement>('.stash [data-act="add"]')!.click();
    await waitFor(() => !!modal()?.querySelector('[data-f="name"]'), "the yarn form");
    await wait(200);
  };
  const close = async () => {
    modal()?.querySelector<HTMLElement>('[data-act="cancel"]')?.click();
    await waitFor(() => !modal(), "the form closed");
  };
  // The file picker answered with a photo.
  const realClick = HTMLInputElement.prototype.click;
  const canvas = document.createElement("canvas");
  canvas.width = 2400;
  canvas.height = 1600;
  canvas.getContext("2d")!.fillRect(0, 0, 2400, 1600);
  const photo = new File([await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"))], "band.png", { type: "image/png" });
  HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
    if (this.type !== "file") return realClick.call(this);
    const dt = new DataTransfer();
    dt.items.add(photo);
    this.files = dt.files;
    this.dispatchEvent(new Event("change"));
  };
  const settings = await invoke<AiSettingsView>("get_ai_settings");
  const before = { ...settings };
  try {
    tab("stash");
    // The yarn itself, whatever the tab was left showing.
    await waitFor(() => !!document.querySelector('[data-act="stash-mode"][data-mode="yarn"]'), "the stash");
    document.querySelector<HTMLElement>('[data-act="stash-mode"][data-mode="yarn"]')!.click();
    await waitFor(() => !!document.querySelector('.stash [data-act="add"]'), "the stash's yarn");
    store.aiSettings = { ...settings, enabled: false };
    await open();
    check(results, "with no model switched on, the yarn form does not offer to read a ball band", row()?.hidden === true);
    await close();

    store.aiSettings = { ...settings, enabled: true };
    store.ballBand = BAND;
    await open();
    await waitFor(() => row()?.hidden === false, "the offer", 3000).catch(() => {});
    check(results, "with one, it offers Read the ball band", row()?.hidden === false);
    field("brand").value = "My own brand";
    row()!.querySelector<HTMLElement>('[data-act="read-band"]')!.click();
    await waitFor(() => /Read from the ball band/.test(status()), "the band read");
    check(results, "the photo goes as a picture, scaled down to read", /^data:image\/jpeg;base64,/.test(store.ballBandImage ?? ""));
    check(results, "what is empty is filled in: name, colourway, weight, metres and grams", field("name").value === "Band Check" && field("colourway").value === "01 Off white" && field("yarnWeight").value === "Aran" && field("metresPerBall").value === "150" && field("gramsPerBall").value === "50", [field("name").value, field("yarnWeight").value, field("metresPerBall").value].join(" / "));
    check(results, "…what was typed is kept", field("brand").value === "My own brand" && !/brand/.test(status().split(":")[1] ?? ""), status());
    const fibres = [...modal()!.querySelectorAll<HTMLInputElement>("[data-fibre-name]")].map((i) => i.value);
    check(results, "…the fibres, the dye lot, the gauge, the needles and the care symbols too", fibres.join(",") === "alpaca,polyamide,wool" && modal()!.querySelector<HTMLInputElement>('.lot-row [data-lf="dyeLot"]')!.value === "4521" && field("gaugeSts").value === "17" && field("needleFrom").value === "5" && field("needleTo").value === "5.5" && modal()!.querySelectorAll(".care-choice.on").length === 3, `${fibres} / ${field("gaugeSts").value}`);
    check(results, "…marked to be checked, and said so", field("name").classList.contains("from-band") && !field("brand").classList.contains("from-band") && /Check before saving/.test(status()), status());
    field("name").dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "…typed over, the mark goes", !field("name").classList.contains("from-band"));
    await close();

    store.ballBandError = "Nothing could be read from that photo.";
    await open();
    await waitFor(() => row()?.hidden === false, "the offer", 3000).catch(() => {});
    row()!.querySelector<HTMLElement>('[data-act="read-band"]')!.click();
    await waitFor(() => /could not be read/.test(status()), "the refusal");
    check(results, "a photo that cannot be read says so, and fills nothing", /The ball band could not be read: Nothing could be read/.test(status()) && field("name").value === "", status());
    await close();
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    HTMLInputElement.prototype.click = realClick;
    store.aiSettings = before;
    delete store.ballBand;
    delete store.ballBandError;
    if (modal()) await close().catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__ballBandChecks = verifyBallBand;
