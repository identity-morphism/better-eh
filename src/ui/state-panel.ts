import { nativeUrl } from "../routes/identity";
import { el, icon } from "./dom";
import type { Child } from "./dom";

interface StateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  primary?: boolean;
  native?: boolean;
}

interface StatePanelOptions {
  /** Heading; omitted for a one-line notice. */
  title?: string;
  text: string;
  /** Secondary explanation, rendered under `text`. */
  detail?: string;
  actions?: readonly StateAction[];
  /** `error` uses the alert tone, `empty` the neutral one. */
  tone?: "empty" | "error";
  /** Standalone panels own the page's h1; panels inside a view sit under its heading. */
  headingLevel?: 1 | 2;
}

/** The standard escape hatch appended to a dead-end panel. */
export function nativePageAction(href: string = nativeUrl()): StateAction {
  return { label: "Open native page", href, native: true };
}

function actionNode(action: StateAction): HTMLElement {
  const classes = action.primary === true ? "btn btn-primary" : "btn";
  if (action.href !== undefined) {
    return el(
      "a",
      {
        class: classes,
        href: action.href,
        "data-native": action.native === true ? "" : null,
      },
      action.label,
    );
  }
  return el("button", {
    class: classes,
    type: "button",
    text: action.label,
    onclick: action.onClick,
  });
}

/**
 * Build the shared empty/error panel.
 *
 * Every dead end in the app — no results, no favorites, a failed route — renders this shape: an
 * optional icon, a heading, one or two lines of explanation and a row of actions. Views never
 * hand-roll their own stack of paragraphs, so the panels stay identical across routes.
 */
export function statePanel(options: StatePanelOptions): HTMLElement {
  const tone = options.tone ?? "empty";
  const children: Child[] = [];

  if (tone === "error") {
    children.push(el("div", { class: "state-icon", "aria-hidden": "true" }, icon("warning")));
  }

  if (options.title !== undefined) {
    const heading = (options.headingLevel ?? 2) === 1 ? "h1" : "h2";
    children.push(el(heading, { class: "state-title", text: options.title }));
  }
  children.push(el("p", { class: "state-text", text: options.text }));
  if (options.detail !== undefined) {
    children.push(el("p", { class: "state-text", text: options.detail }));
  }

  const actions = options.actions ?? [];
  if (actions.length > 0) {
    children.push(el("div", { class: "state-actions" }, ...actions.map(actionNode)));
  }

  return el(
    "div",
    {
      class: tone === "error" ? "error-view" : "empty-state",
      role: tone === "error" ? "alert" : null,
    },
    ...children,
  );
}
