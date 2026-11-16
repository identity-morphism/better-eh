import type { SavedExpression } from "../data/saved-expressions";
import { quickExpressions, subscribeExpressions } from "../data/saved-expressions";
import { containsExpression, toggleExpressionInSearch } from "../tags/model";
import { el } from "./dom";
import { openExpressionEditor } from "./saved-expressions";

interface QuickTagsOptions {
  /** The user's current draft, so a click toggles against what the field shows. */
  getText: () => string;
  search: (text: string) => void;
  signal: AbortSignal;
}

export interface QuickTagsHandle {
  readonly element: HTMLElement;
  /** Repaint the active state against the field's latest draft. */
  refresh: (text?: string) => void;
}

/**
 * Render the pinned saved expressions as quick-tag buttons.
 *
 * Each button toggles its expression's terms in the current draft. The editor is the shared one, so
 * a name, query, mode or pin changed there is reflected here immediately.
 */
export function renderQuickTags(options: QuickTagsOptions): QuickTagsHandle {
  const { signal } = options;
  let tags = quickExpressions();
  let text = options.getText();
  const entries: { tag: SavedExpression; node: HTMLButtonElement }[] = [];
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
          options.search(toggleExpressionInSearch(options.getText(), tag.query));
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
      title: "Edit saved searches and quick tags",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
    });
    edit.addEventListener(
      "click",
      () => {
        openExpressionEditor(edit, signal, () => {
          tags = quickExpressions();
          render();
        });
      },
      { signal },
    );
    row.append(edit);
    refresh();
  };

  render();
  const unsubscribe = subscribeExpressions(() => {
    tags = quickExpressions();
    render();
  });
  signal.addEventListener("abort", unsubscribe, { once: true });
  return { element: row, refresh };
}
