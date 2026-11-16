export type Child = Node | string | number | null | undefined | false;

type EventHandler = (event: Event) => void;

type Props = Record<string, string | number | boolean | null | undefined | EventHandler>;

/**
 * Create an element with attributes, events, and children.
 *
 * Values for `class`, `text`, and `style` are treated specially. Keys starting with `on` are
 * registered as event listeners. Everything else becomes an attribute. The helper never interprets
 * strings as HTML.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === "class") {
      node.className = String(value);
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (key === "style") {
      node.style.cssText = String(value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }

  appendChildren(node, children);
  return node;
}

export function appendChildren(parent: ParentNode, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * A text input with the mobile and autofill hints every free-text field uses: no autocompletion, no
 * autocorrect, no spellchecking. `props` wins over the defaults.
 */
export function textInput(props: Props = {}): HTMLInputElement {
  return el("input", {
    type: "text",
    autocomplete: "off",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    ...props,
  });
}

/** A {@link textInput} that sets `type=search` and `enterkeyhint`; the surrounding form submits. */
export function searchInput(props: Props = {}): HTMLInputElement {
  return textInput({ type: "search", enterkeyhint: "search", ...props });
}

/**
 * The site's own tag composer (`new_tags`). The tag menu and the gallery tag pane both submit
 * through this field, so its name and hints must not drift.
 */
export function tagInput(className: string): HTMLInputElement {
  return textInput({
    class: className,
    name: "new_tags",
    placeholder: "Add tags, comma separated",
    "aria-label": "New tags",
    maxlength: "200",
  });
}

const ICON_PATHS = {
  back: "M15 18l-6-6 6-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2l-4.35-4.35",
  star: "M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9L12 2.5z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  warning: "M12 3L2 21h20L12 3zm0 6v6m0 3v.5",
  close: "M6 6l12 12M18 6L6 18",
  filter: "M3 5h18l-7 8v6l-4 2v-8L3 5z",
  arrowRight: "M5 12h14m-6-6 6 6-6 6",
  arrowLeft: "M19 12H5m6-6-6 6 6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronRight: "M9 6l6 6-6 6",
  first: "M18 6l-6 6 6 6M11 6l-6 6 6 6",
  last: "M6 6l6 6-6 6M13 6l6 6-6 6",
  download: "M12 3v11m0 0-4.5-4.5M12 14l4.5-4.5M5 19h14",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2",
  eye: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
} as const;

type IconName = keyof typeof ICON_PATHS;

/** Build a 24x24 stroked icon. */
export function icon(name: IconName, filled = false): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICON_PATHS[name]);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", filled ? "0" : "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("fill", filled ? "currentColor" : "none");
  svg.append(path);
  return svg;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
