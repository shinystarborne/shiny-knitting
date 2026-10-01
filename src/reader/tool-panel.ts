import { api, type Tool } from "../api";
import { say } from "../dialogs";
import { ToolPicker } from "../views/tool-picker";

/**
 * The pattern's needles and hooks, in the reader's side pane.
 *
 * Starting a project is when needles get picked out of the box, and that
 * happens with the pattern open, so this is where one can be put on it --
 * free, or moved from another project -- and taken off again. Saved at once.
 */
export class ToolPanel {
  private patternId: string;
  private tools: Tool[] = [];
  private picker: ToolPicker;

  constructor(root: HTMLElement, patternId: string) {
    this.patternId = patternId;
    root.innerHTML = `<h3>Needles &amp; hooks</h3><div data-el="picker"></div>`;
    this.picker = new ToolPicker(
      root.querySelector<HTMLElement>('[data-el="picker"]')!,
      (id) => void this.assign(id, this.patternId),
      (id) => void this.assign(id, null),
    );
  }

  async refresh(): Promise<void> {
    try {
      this.tools = await api.listTools();
    } catch {
      this.tools = [];
    }
    const mine = new Set(this.tools.filter((t) => t.patternId === this.patternId).map((t) => t.id));
    this.picker.render(this.tools, mine, "None on this pattern yet.");
  }

  private async assign(id: string, patternId: string | null): Promise<void> {
    try {
      await api.setToolProject(id, patternId);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Needles & hooks");
    }
    await this.refresh();
  }
}
