/**
 * Checks for the in-app update check.
 *
 * These run against the live, stubbed app rather than pure functions: the
 * point of the feature is the wiring — the startup notice, the Settings
 * dialog's Updates section, the beta tick reaching the backend unsaved, and
 * the download ending in install_update — so the checks click the real
 * buttons and read the real result line.
 *
 * The stub is driven through window fixtures: __nextUpdate is what
 * check_for_update finds (null = up to date, { error } = a failure), and
 * __startupUpdate is what startup_update_check finds, with unset meaning
 * "skipped". The startup check fires once at boot, before anything here runs,
 * so the seeded case re-triggers it through the hook main.ts exposes.
 *
 * Run with the harness open:
 *   window.__updateChecks()
 */

function check(results, name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, what, timeoutMs = 15000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

const RELEASE = {
  tag: "v0.3.0",
  name: "0.3.0",
  publishedAt: "2026-09-01T00:00:00Z",
  prerelease: false,
  assetName: "ShinyKnitting-0.3.0-setup.exe",
  assetApiUrl: "https://api.github.com/repos/shinystarborne/shiny-knitting/releases/assets/1",
  sizeBytes: 123,
};

// The settings dialog lives in the app's own modal host, not in one of
// dialogs.ts's overlays, so it is found inside #app.
const settingsButton = () => document.querySelector('button[data-act="settings"]');
const dialogEl = () => document.querySelector("#app .modal-backdrop:not(.hidden) .modal");
const updateResult = () => document.querySelector('[data-el="update-result"]');

async function openSettings() {
  settingsButton().click();
  await waitFor(() => dialogEl(), "the settings dialog");
}

async function closeSettings(save = false) {
  dialogEl().querySelector(save ? '[data-act="save"]' : '[data-act="close"]').click();
  await waitFor(() => !dialogEl(), "the dialog to close");
  await waitFor(() => settingsButton(), "the library to come back");
}

export async function verifyUpdates() {
  const results = [];
  try {
    // The app booted with nothing seeded, so the startup check was skipped.
    check(
      results,
      "no update notice when the startup check was skipped",
      !document.querySelector('[data-act="update-available"]'),
    );

    await openSettings();
    check(
      results,
      "the dialog says which version you have",
      dialogEl().textContent.includes("You have 0.2.1"),
      dialogEl().textContent.slice(0, 120),
    );

    // --- up to date ---
    window.__nextUpdate = null;
    dialogEl().querySelector('[data-act="check-updates"]').click();
    await waitFor(
      () => updateResult()?.textContent.includes("newest version"),
      "the up-to-date result",
    );
    check(results, "up to date says you're on the newest version", true);

    // --- an update is available, and installing it works end to end ---
    window.__nextUpdate = RELEASE;
    dialogEl().querySelector('[data-act="check-updates"]').click();
    await waitFor(
      () => updateResult()?.textContent.includes("0.3.0 is available"),
      "the available result",
    );
    const download = updateResult().querySelector('[data-act="download-update"]');
    check(results, "an available update is offered with a download button", !!download);
    download.click();
    await waitFor(
      () =>
        window.__installedUpdate && updateResult()?.textContent.includes("Starting the installer"),
      "the install to start",
    );
    check(
      results,
      "downloading installs and starts the installer",
      window.__installedUpdate === "C:\\Temp\\ShinyKnitting-update-setup.exe",
      `installed: ${window.__installedUpdate}`,
    );

    // --- the beta tick reaches the check without being saved first ---
    //
    // The stub records includeBeta synchronously, but the button is re-enabled
    // only once checkForUpdate's whole promise chain has settled — a few
    // microtask hops later. A second click in between lands on a disabled
    // button and is silently dropped, so every check here waits for the
    // button to come back, not just for the recorded flag.
    const betaBox = dialogEl().querySelector('[data-f="includeBeta"]');
    const checkButton = () => dialogEl().querySelector('[data-act="check-updates"]');
    betaBox.click();
    checkButton().click();
    await waitFor(
      () => window.__lastUpdateCheckBeta === true && !checkButton().disabled,
      "a beta-inclusive check",
    );
    check(results, "the beta tick is sent without saving (ticked)", true);
    betaBox.click();
    checkButton().click();
    await waitFor(
      () => window.__lastUpdateCheckBeta === false && !checkButton().disabled,
      "a stable-only check",
    );
    check(results, "the beta tick is sent without saving (unticked)", true);

    // --- a failed check shows the reason ---
    window.__nextUpdate = { error: "could not check for updates: offline" };
    dialogEl().querySelector('[data-act="check-updates"]').click();
    await waitFor(
      () => updateResult()?.textContent.includes("could not check for updates: offline"),
      "the error text",
    );
    check(results, "a failed check shows the reason", true);
    window.__nextUpdate = null;
    await closeSettings();

    // --- the settings persist across a save and a reopen ---
    await openSettings();
    const box = dialogEl().querySelector('[data-f="includeBeta"]');
    if (box.checked) box.click(); // start from unticked, whatever was saved
    box.click();
    await closeSettings(true);
    await openSettings();
    check(
      results,
      "update settings survive a save and reopen",
      dialogEl().querySelector('[data-f="includeBeta"]').checked,
    );
    // Put it back, so a second run of the suite starts from the same state.
    dialogEl().querySelector('[data-f="includeBeta"]').click();
    await closeSettings(true);

    // --- a seeded startup update adds the toolbar notice ---
    window.__startupUpdate = RELEASE;
    window.__runStartupUpdateCheck();
    await waitFor(() => document.querySelector('[data-act="update-available"]'), "the notice");
    check(results, "a seeded startup update adds the toolbar notice", true);
    // The notice updates in one go, after asking. The settings' own download
    // above already started an installer, so that is forgotten first.
    window.__installedUpdate = null;
    const ask = () => document.querySelector(".dialog-backdrop .dialog-card");
    document.querySelector('[data-act="update-available"]').click();
    await waitFor(() => ask(), "the question from the notice");
    check(results, "the notice asks before updating", /Update to/.test(ask().textContent));
    ask().querySelector(".ghost").click();
    await waitFor(() => !ask(), "the question to close");
    check(results, "…and cancelling installs nothing", !window.__installedUpdate);
    document.querySelector('[data-act="update-available"]').click();
    await waitFor(() => ask(), "the question again");
    ask().querySelector(".primary").click();
    await waitFor(() => window.__installedUpdate, "the installer to be started");
    check(results, "saying yes downloads it and starts the installer", window.__installedUpdate === "C:\\Temp\\ShinyKnitting-update-setup.exe", String(window.__installedUpdate));
    window.__installedUpdate = null;
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err && err.message) || err));
  } finally {
    window.__nextUpdate = null;
    window.__startupUpdate = null;
  }

  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`),
  };
}

if (typeof window !== "undefined") {
  window.__updateChecks = verifyUpdates;
}
