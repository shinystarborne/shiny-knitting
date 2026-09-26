/**
 * Makes the harness refuse the browser's own dialogs, the way the real app has
 * to.
 *
 * This exists because of a bug that shipped broken. A Tauri window is a
 * WebView2, and there is no browser behind it to draw a dialog, so:
 *
 * - `window.prompt` never returns, and wedges the whole window for good
 * - `window.confirm` returns `undefined` rather than `true` or `false`
 * - `window.alert` does not show
 *
 * All three work perfectly in a browser, so every feature that used one passed
 * every test in this harness and then did nothing in the app: one note froze the
 * window, and confirming a removal always read as "no". The harness was the
 * only place it had ever been tried, and it agreed with itself.
 *
 * So the harness now behaves like the app. Anything reaching for these throws
 * loudly and by name, which turns a silent no-op into a failed test. Code that
 * needs to ask the user something goes through src/dialogs.ts instead.
 */
const refuse = (name) => () => {
  throw new Error(
    `window.${name}() does not work in this app, and the harness now ` +
      `refuses it so a test cannot pass by accident. Use src/dialogs.ts ` +
      `(askText, askYesNo, say) instead.`,
  );
};

for (const name of ["prompt", "confirm", "alert"]) {
  try {
    window[name] = refuse(name);
  } catch {
    // Some of these are non-writable in some browsers. Alerted rather than
    // thrown, because failing to install the guard must not stop the harness.
    console.warn(`could not replace window.${name}`);
  }
}

// A test that genuinely needs one can put it back, and say so.
window.__allowBrowserDialogs = () => {
  delete window.prompt;
  delete window.confirm;
  delete window.alert;
  return "window.prompt, confirm and alert restored for this page";
};
