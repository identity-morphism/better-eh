import type { QuickTag } from "../data/quick-tags";
import { quickTags, subscribeQuickTags } from "../data/quick-tags";
import { containsExpression, toggleExpressionInSearch } from "../tags/model";
import { el } from "./dom";
import { openQuickTagEditor } from "./quick-tags-editor";

interface QuickTagsOptions {
  /** The user's current draft, so a click toggles against what the field shows. */
  getText: () => string;
  /** Replace the draft with the toggled text; this never submits a search. */
  apply: (text: string) => void;
  signal: AbortSignal;
}

export interface QuickTagsHandle {
  readonly element: HTMLElement;
  /** Repaint the active state against the field's latest draft. */
  refresh: (text?: string) => void;
}

/**
 * Render the quick tags as buttons.
 *
 * A click adds the tag's expression to the current draft, or removes its terms when all are
 * present. The editor is the shared one, so a name or query changed there is reflected here
 * immediately.
 */
export function renderQuickTags(options: QuickTagsOptions): QuickTagsHandle {
  const { signal } = options;
  let tags = quickTags();
  let text = options.getText();
  const entries: { tag: QuickTag; node: HTMLButtonElement }[] = [];
  const row = el("div", { class: "quick-tags", role: "group", "aria-label": "Quick tags" });

  const refresh = (next?: string): void => {
    text = next ?? options.getText();
    for (const entry of entries) {
      const on = containsExpression(text, entry.tag.query);
      entry.node.setAttribute("aria-pressed", String(on));
      entry.node.title = on ? `Remove ${entry.tag.query}` : `Add ${entry.tag.query}`;
    }
  };

  const render = (): void => {
    entries.length = 0;
    row.replaceChildren();
    for (const tag of tags) {
      const node = el(
        "button",
        { class: "quick-tag", type: "button", "aria-pressed": "false" },
        el("span", { class: "quick-tag-label", text: tag.name }),
      );
      node.addEventListener(
        "click",
        () => {
          options.apply(toggleExpressionInSearch(options.getText(), tag.query));
        },
        { signal },
      );
      row.append(node);
      entries.push({ tag, node });
    }

    const edit = el("button", {
      class: "quick-tag-edit",
      type: "button",
      text: tags.length === 0 ? "+ Quick tags" : "Edit tags",
      title: "Edit quick tags",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
    });
    edit.addEventListener(
      "click",
      () => {
        openQuickTagEditor(edit, signal, () => {
          tags = quickTags();
          render();
        });
      },
      { signal },
    );
    row.append(edit);
    refresh();
  };

  render();
  const unsubscribe = subscribeQuickTags(() => {
    tags = quickTags();
    render();
  });
  signal.addEventListener("abort", unsubscribe, { once: true });
  return { element: row, refresh };
}
