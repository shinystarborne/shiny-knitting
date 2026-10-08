/**
 * A notice at the foot of the screen for a few seconds, with an action when
 * one is given (Undo); a newer notice takes its place.
 */
export function showNotice(text: string, action?: { label: string; run: () => void | Promise<void> }, ms = 6000): void {
  document.querySelector(".undo-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "undo-toast";
  toast.setAttribute("role", "status");
  const words = document.createElement("span");
  words.textContent = text;
  toast.append(words);
  const timer = window.setTimeout(() => toast.remove(), ms);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      window.clearTimeout(timer);
      toast.remove();
      void action.run();
    });
    toast.append(button);
  }
  document.body.append(toast);
}
