/**
 * Checks for yarn weights in the frontend, and the yarn form's photo paste.
 *
 * The cases are the ones `yarn.rs` is tested against, so the hints the form
 * gives and the family the backend files agree; a change to one side that is
 * not made to the other fails here.
 *
 * Run with the harness open:
 *   window.__yarnWeightChecks()
 */
import { coneCount, familyOf } from "../src/views/yarn-weight";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

/** A small real PNG, as a pasted picture would be. */
async function pngFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 40;
  canvas.height = 30;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c04";
  ctx.fillRect(0, 0, 40, 30);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return new File([blob], "pasted.png", { type: "image/png" });
}

export async function verifyYarnWeights() {
  const results: CheckResult[] = [];

  // As yarn.rs's tests.
  const families: [string, string][] = [
    ["DK", "dk"], ["Double Knit", "dk"], ["sock weight", "fingering"], ["Aran", "aran"],
    ["super chunky", "super-chunky"], ["Super Bulky", "super-chunky"], ["lace weight thread", "lace"],
    ["2-ply", "lace"], ["3-ply", "fingering"], ["4 ply", "fingering"], ["8 ply", "dk"], ["12-ply", "bulky"],
    ["14 ply", "chunky"], ["4-ply worsted", "worsted"], ["800 m/100g", "lace"], ["420 m/100g", "fingering"],
    ["300m/100g", "sport"], ["230 m/100g", "dk"], ["200 m/100g", "worsted"], ["180 m/100g", "aran"],
    ["100 m/100g", "bulky"], ["85 m/100 g", "chunky"], ["50m/100g", "super-chunky"], ["12 m/100g", "jumbo"],
    ["Aran, 100 m/100g", "aran"], ["2/28", "lace"], ["3/9", "sport"], ["2/8 cotton", "fingering"],
    ["100", ""], ["4 mm needles", ""], ["bodykeep", ""], ["some wool", ""],
  ];
  for (const [text, want] of families) {
    const got = familyOf(text);
    check(results, `“${text}” is ${want || "nothing"}`, got === want, got);
  }
  const cones: [string, number | null][] = [
    ["2/28", 1400], ["2/2800", 1400], ["Nm 2/28", 1400], ["1/15", 1500], ["2 / 30 merino", 1500],
    ["1/2 ball", null], ["3/4", null], ["100 m/100g", null], ["50/100g", null], ["2/28 m", null], ["20/28", null],
  ];
  for (const [text, want] of cones) {
    const got = coneCount(text);
    check(results, `cone count of “${text}” is ${want ?? "none"}`, got === want, String(got));
  }

  // The yarn form: the weight from the ball band, a cone count, the cheat
  // sheet, and a pasted picture.
  const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal");
  const f = (name: string) => modal()!.querySelector<HTMLInputElement>(`[data-f="${name}"]`)!;
  const type = (name: string, value: string) => {
    f(name).value = value;
    f(name).dispatchEvent(new Event("input", { bubbles: true }));
  };
  try {
    (document.querySelector('.tab-bar [data-tab="stash"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector('.stash [data-act="add"]'), "the stash");
    (document.querySelector('.stash [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal()?.querySelector('[data-f="yarnWeight"]'), "the yarn form");
    const hint = () => modal()!.querySelector<HTMLElement>('[data-el="weight-hint"]')!;

    type("metresPerBall", "175");
    type("gramsPerBall", "50");
    check(results, "the ball band's figures fill in the weight", f("yarnWeight").value === "Sport", f("yarnWeight").value);
    check(results, "…and say how", /175 m \/ 50 g = 350 m\/100 g: Sport/.test(hint().textContent ?? ""), hint().textContent ?? "");
    type("metresPerBall", "120");
    check(results, "a filled-in weight follows the figures", f("yarnWeight").value === "DK", f("yarnWeight").value);
    type("yarnWeight", "Worsted");
    type("metresPerBall", "90");
    check(results, "a typed weight is kept", f("yarnWeight").value === "Worsted");
    check(results, "…with the figures' weight said beside it", /: Aran/.test(hint().textContent ?? "") && /“Worsted” is filed as Worsted/.test(hint().textContent ?? ""), hint().textContent ?? "");

    type("metresPerBall", "");
    type("gramsPerBall", "500");
    type("yarnWeight", "2/28");
    check(results, "a cone count says its metres per 100 g and weight", /2\/28 is about 1 400 m\/100 g: Lace/.test(hint().textContent ?? ""), hint().textContent ?? "");
    check(results, "…and with the cone's grams, its metres", /A 500 g cone is about 7 000 m/.test(hint().textContent ?? ""), hint().textContent ?? "");

    const help = () => modal()!.querySelector<HTMLElement>('[data-el="weight-help"]')!;
    check(results, "the cheat sheet starts closed", help().hidden);
    (modal()!.querySelector('[data-act="weight-help"]') as HTMLElement).click();
    check(results, "Weights ? opens it, a row per weight", !help().hidden && help().querySelectorAll("tbody tr").length === 10);
    check(results, "…naming the plies and cone counts", /8 ply/.test(help().textContent ?? "") && /2\/28/.test(help().textContent ?? ""));

    const box = modal()!.querySelector<HTMLElement>('[data-el="photobox"]')!;
    const data = new DataTransfer();
    data.items.add(await pngFile());
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    await waitFor(() => box.classList.contains("filled"), "the pasted picture");
    check(results, "a pasted picture becomes the photo", box.style.backgroundImage.startsWith('url("blob:'));

    const text = new DataTransfer();
    text.setData("text/plain", "Felted Tweed");
    const textPaste = new ClipboardEvent("paste", { clipboardData: text, bubbles: true, cancelable: true });
    f("name").dispatchEvent(textPaste);
    check(results, "pasting text is left to the field", !textPaste.defaultPrevented);

    (modal()!.querySelector('[data-act="cancel"]') as HTMLElement).click();
    await waitFor(() => !modal(), "the form to close");
    const after = new DataTransfer();
    after.items.add(await pngFile());
    const late = new ClipboardEvent("paste", { clipboardData: after, bubbles: true, cancelable: true });
    document.dispatchEvent(late);
    check(results, "once the form is closed, a paste is not taken", !late.defaultPrevented);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>('.modal-backdrop:not(.hidden) [data-act="cancel"]')?.click();
    (document.querySelector('.tab-bar [data-tab="patterns"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".library:not(.stash):not(.tools):not(.projects)"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__yarnWeightChecks = verifyYarnWeights;
