/**
 * Anchored panel primitive: placement, dismissal and focus return.
 *
 * Panels mount on `document.body` inside the top layer, so neither sticky headers nor a page's own
 * stacking context can clip or cover them. Only the top-most panel reacts to `Escape` or to a press
 * outside it, so nested popovers close one at a time. Geometry comes from `./anchor`, which reads
 * `visualViewport` when it exists so an on-screen keyboard shrinks the space a panel is placed in.
 * Callers that change a panel's size call `reposition()`. `bindPopover` adds the click-toggled
 * case: per-open content, teardown on close and `aria-expanded` ownership.
 */

import { placePanel as placeAnchoredPanel } from "./anchor";
import { el } from "./dom";

type PopoverRole = "dialog" | "menu" | "listbox";

export interface PopoverRequest {
  /** Panel content, already built by the caller. */
  content: HTMLElement;
  /** Element the panel is anchored to; `null` centers it in the viewport. */
  anchor: HTMLElement | null;
  role?: PopoverRole;
  /** Accessible name for the panel. */
  label?: string;
  /** Extra class names for the panel element. */
  className?: string;
  /** Anchor edge the panel lines up with. */
  align?: "start" | "end";
  /** Grow the panel to at least the anchor's width and at least this many pixels. */
  minWidth?: number;
  /** Move focus into the panel on open. */
  autoFocus?: boolean;
  /** Close the panel when this signal aborts, as view teardown does. */
  signal?: AbortSignal;
  onClose?: () => void;
}

export interface Popover {
  readonly element: HTMLElement;
  close(): void;
  reposition(): void;
  isOpen(): boolean;
}

/** A panel builder's result: its content plus whatever must end with the panel. */
export interface PopoverContent {
  content: HTMLElement;
  dispose?: () => void;
}

/** A {@link PopoverRequest} without the parts a binding owns: content, anchor, close and signal. */
export type PopoverBindingOptions = Omit<
  PopoverRequest,
  "content" | "anchor" | "onClose" | "signal"
>;

/** Click-toggled panel handle: no caller-held open state and no manual `aria-expanded` writes. */
export interface PopoverBinding {
  toggle(): void;
  open(): void;
  close(): void;
  /** Re-place the open panel; a no-op while closed. */
  reposition(): void;
  isOpen(): boolean;
}

interface Entry {
  panel: HTMLElement;
  anchor: HTMLElement | null;
  close: () => void;
}

const stack: Entry[] = [];
let boundDocument: Document | null = null;

function onPointerDown(event: Event): void {
  const top = stack.at(-1);
  if (!top) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }
  if (top.panel.contains(target) || top.anchor?.contains(target) === true) {
    return;
  }
  top.close();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) {
    return;
  }
  const top = stack.at(-1);
  if (!top) {
    return;
  }
  event.preventDefault();
  top.close();
}

/** Focusable descendants of a panel, in visual order. */
function focusables(panel: HTMLElement): HTMLElement[] {
  const nodes = panel.querySelectorAll<HTMLElement>(
    "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  );
  return [...nodes].filter((node) => !node.hidden && node.tabIndex >= 0);
}

/**
 * Install the shared dismiss listeners once per document.
 *
 * Tests replace the global document between cases, so the binding follows the current document.
 */
function bind(document: Document): void {
  if (boundDocument === document) {
    return;
  }
  boundDocument = document;
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
}

/** Open a panel and return its handle. */
export function openPopover(request: PopoverRequest): Popover {
  const { content, anchor, role = "dialog", align = "start", minWidth } = request;
  const panel = el("div", {
    class: request.className === undefined ? "eh-popover" : `eh-popover ${request.className}`,
    role,
    tabindex: "-1",
    popover: "manual",
  });
  if (request.label !== undefined) {
    panel.setAttribute("aria-label", request.label);
  }
  panel.style.position = "fixed";
  panel.style.overflowY = "auto";
  panel.append(content);

  let open = true;
  const controller = new AbortController();
  const { signal } = controller;

  const close = (restoreFocus = true): void => {
    if (!open) {
      return;
    }
    open = false;
    controller.abort();
    const index = stack.findIndex((entry) => entry.panel === panel);
    if (index >= 0) {
      stack.splice(index, 1);
    }
    // Read focus *before* removing the panel: removal moves focus to <body> synchronously.
    const active = document.activeElement as Element | null | undefined;
    const heldFocus =
      restoreFocus && (active === null || active === undefined || panel.contains(active));
    panel.remove();
    if (anchor !== null && anchor.getAttribute("aria-haspopup") !== null) {
      anchor.setAttribute("aria-expanded", "false");
    }
    if (anchor !== null && heldFocus && typeof anchor.focus === "function") {
      anchor.focus();
    }
    request.onClose?.();
  };

  const reposition = (): void => {
    if (open) {
      placeAnchoredPanel(panel, { anchor, align, minWidth, fit: { floor: 120 } });
    }
  };

  stack.push({ panel, anchor, close: () => close() });
  bind(document);

  document.body.append(panel);
  panel.showPopover();

  if (role === "menu") {
    panel.addEventListener(
      "keydown",
      (event) => {
        const items = focusables(panel);
        if (items.length === 0) {
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const current = items.indexOf(document.activeElement as HTMLElement);

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          const next = current === -1 ? (step === 1 ? first : last) : items[current + step];
          (next ?? (step === 1 ? first : last))?.focus();
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          (event.key === "Home" ? first : last)?.focus();
        } else if (event.key === "Tab") {
          // Close first so focus does not walk into the page behind the panel.
          close();
        }
      },
      { signal },
    );
  }

  if (request.autoFocus === true) {
    const focusable = panel.querySelector<HTMLElement>(
      "input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])",
    );
    (focusable ?? panel).focus();

    // A focused dialog keeps Tab inside until it closes.
    panel.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Tab") {
          return;
        }
        const items = focusables(panel);
        if (items.length === 0) {
          event.preventDefault();
          panel.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const current = items.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && (current <= 0 || current === -1)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (current === items.length - 1 || current === -1)) {
          event.preventDefault();
          first?.focus();
        }
      },
      { signal },
    );
  }

  // Tabbing or clicking out of a panel closes it, leaving focus where the user put it.
  panel.addEventListener(
    "focusout",
    (event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node)) {
        return;
      }
      if (panel.contains(next) || anchor?.contains(next) === true) {
        return;
      }
      close(false);
    },
    { signal },
  );

  if (anchor !== null && anchor.getAttribute("aria-haspopup") !== null) {
    anchor.setAttribute("aria-expanded", "true");
  }

  window.addEventListener("resize", reposition, { signal });
  window.addEventListener("scroll", reposition, { capture: true, passive: true, signal });
  if (typeof window !== "undefined" && window.visualViewport) {
    window.visualViewport.addEventListener("resize", reposition, { signal });
    window.visualViewport.addEventListener("scroll", reposition, { signal });
  }
  if (request.signal !== undefined) {
    request.signal.addEventListener("abort", () => close(false), { once: true, signal });
  }

  reposition();

  return {
    element: panel,
    close: () => close(),
    reposition,
    isOpen: () => open,
  };
}

/**
 * Wire a click-toggled panel to an anchor button.
 *
 * `build` runs for every open, so the panel reflects state read at that moment; its `dispose` runs
 * when the panel closes, however it closes. A repeated `open()` only repositions the live panel, so
 * it never swaps content under the pointer.
 *
 * @param signal View lifetime; aborting it closes the panel and still runs `dispose`.
 */
export function bindPopover(
  anchor: HTMLElement,
  build: (close: () => void) => PopoverContent,
  options: PopoverBindingOptions = {},
  signal?: AbortSignal,
): PopoverBinding {
  let current: Popover | null = null;

  const open = (): void => {
    if (current?.isOpen() === true) {
      current.reposition();
      return;
    }

    // `build` gets a close bound to its own panel, so a late async callback cannot close a panel
    // that was opened after this one.
    let instance: Popover | null = null;
    const built = build(() => instance?.close());
    let dispose = built.dispose;
    const panel = openPopover({
      ...options,
      content: built.content,
      anchor,
      signal,
      onClose: () => {
        if (current === panel) {
          current = null;
        }
        dispose?.();
        dispose = undefined;
      },
    });
    instance = panel;
    current = panel;
  };

  return {
    toggle: (): void => {
      if (current?.isOpen() === true) {
        current.close();
      } else {
        open();
      }
    },
    open,
    close: (): void => {
      current?.close();
    },
    reposition: (): void => {
      current?.reposition();
    },
    isOpen: () => current?.isOpen() === true,
  };
}

/** Close every open panel, top-most first. */
export function closePopovers(): void {
  for (const entry of [...stack].reverse()) {
    entry.close();
  }
}
