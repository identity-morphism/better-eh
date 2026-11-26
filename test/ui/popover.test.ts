import { beforeEach, describe, expect, test } from "bun:test";

import { bindPopover, closePopovers, openPopover } from "../../src/ui/popover";
import { installDom } from "./dom";

function content(document: Document): HTMLElement {
  const node = document.createElement("div");
  node.append(document.createTextNode("panel body"));
  return node;
}

function anchorWith(document: Document, haspopup: boolean): HTMLElement {
  const anchor = document.createElement("button");
  if (haspopup) {
    anchor.setAttribute("aria-haspopup", "dialog");
  }
  document.body.append(anchor);
  return anchor;
}

function press(
  node: EventTarget,
  type: string,
  key?: string,
  init: { shiftKey?: boolean } = {},
): void {
  // `installDom` installs linkedom's constructors as globals, so this builds a linkedom event.
  const event = new Event(type, { bubbles: true, cancelable: true });
  if (key !== undefined) {
    Object.defineProperty(event, "key", { value: key });
  }
  Object.assign(event, init);
  node.dispatchEvent(event);
}

function focusableContent(doc: Document, labels: readonly string[]): HTMLElement {
  const node = doc.createElement("div");
  for (const label of labels) {
    const button = doc.createElement("button");
    button.textContent = label;
    // Linkedom leaves `tabIndex` at -1; the popover's focusable filter requires 0+.
    button.setAttribute("tabindex", "0");
    Object.defineProperty(button, "tabIndex", { configurable: true, value: 0 });
    node.append(button);
  }
  return node;
}

let document: Document;

/** Linkedom does not track focus; the popover reads `document.activeElement` for its trap. */
function trackFocus(doc: Document): void {
  let active: Element | null = null;
  Object.defineProperty(doc, "activeElement", {
    configurable: true,
    get: () => active,
  });
  const proto = Object.getPrototypeOf(doc.createElement("button")) as {
    focus?: () => void;
  };
  proto.focus = function focus(this: Element): void {
    active = this;
  };
}

beforeEach(() => {
  closePopovers();
  document = installDom();
  trackFocus(document);
});

describe("openPopover", () => {
  test("mounts the panel on the body and reports it open", () => {
    const anchor = anchorWith(document, true);
    const popover = openPopover({ content: content(document), anchor, label: "Folders" });

    expect(popover.isOpen()).toBe(true);
    expect(document.body.lastElementChild).toBe(popover.element);
    expect(popover.element.getAttribute("role")).toBe("dialog");
    expect(popover.element.getAttribute("aria-label")).toBe("Folders");
    expect(anchor.getAttribute("aria-expanded")).toBe("true");

    // A control not marked as opening a popup is left alone.
    const plain = anchorWith(document, false);
    openPopover({ content: content(document), anchor: plain });
    expect(plain.hasAttribute("aria-expanded")).toBe(false);
  });

  test("Escape closes the top-most panel only", () => {
    const first = openPopover({ content: content(document), anchor: null });
    const second = openPopover({ content: content(document), anchor: null });

    press(document, "keydown", "Escape");
    expect(second.isOpen()).toBe(false);
    expect(first.isOpen()).toBe(true);

    press(document, "keydown", "Escape");
    expect(first.isOpen()).toBe(false);
  });

  test("dismisses on an outside press, but not inside or on the anchor", () => {
    const anchor = anchorWith(document, true);
    const body = content(document);
    const popover = openPopover({ content: body, anchor });

    press(body, "pointerdown");
    press(anchor, "pointerdown");
    expect(popover.isOpen()).toBe(true);

    press(document.body, "pointerdown");
    expect(popover.isOpen()).toBe(false);
  });

  test("close removes the panel, restores the anchor and runs onClose once", () => {
    const anchor = anchorWith(document, true);
    let closed = 0;
    const popover = openPopover({
      content: content(document),
      anchor,
      onClose: () => {
        closed += 1;
      },
    });

    popover.close();
    popover.close();

    expect(popover.isOpen()).toBe(false);
    expect(closed).toBe(1);
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll(".eh-popover").length).toBe(0);
  });

  test("coalesces scroll and resize into one placement and ignores panel scrolls", () => {
    const pending = new Map<number, FrameRequestCallback>();
    const originalFrame = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    let nextId = 0;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      nextId += 1;
      pending.set(nextId, callback);
      return nextId;
    };
    globalThis.cancelAnimationFrame = (id: number): void => {
      pending.delete(id);
    };
    try {
      const popover = openPopover({
        content: content(document),
        anchor: anchorWith(document, true),
        minWidth: 120,
      });
      // The opening placement is immediate; only changes coalesce.
      expect(pending.size).toBe(0);
      expect(popover.element.style.left).not.toBe("");

      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
      expect(pending.size).toBe(1);

      const inner = document.createElement("div");
      popover.element.append(inner);
      inner.dispatchEvent(new Event("scroll", { bubbles: true }));
      expect(pending.size).toBe(1);

      const queued = [...pending][0];
      if (!queued) {
        throw new Error("expected a queued placement");
      }
      const [id, callback] = queued;
      pending.delete(id);
      callback(0);
      expect(pending.size).toBe(0);

      inner.dispatchEvent(new Event("scroll", { bubbles: true }));
      expect(pending.size).toBe(0);
      window.dispatchEvent(new Event("scroll"));
      expect(pending.size).toBe(1);

      popover.close();
      expect(pending.size).toBe(0);
    } finally {
      globalThis.requestAnimationFrame = originalFrame;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });

  test("moves through a menu with arrows, Home and End, then closes on Tab", () => {
    const popover = openPopover({
      content: focusableContent(document, ["One", "Two", "Three"]),
      anchor: anchorWith(document, true),
      role: "menu",
    });
    const items = [...popover.element.querySelectorAll("button")];

    press(popover.element, "keydown", "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    press(popover.element, "keydown", "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    press(popover.element, "keydown", "ArrowUp");
    expect(document.activeElement).toBe(items[0]);
    press(popover.element, "keydown", "End");
    expect(document.activeElement).toBe(items[2]);
    press(popover.element, "keydown", "Home");
    expect(document.activeElement).toBe(items[0]);

    press(popover.element, "keydown", "Tab");
    expect(popover.isOpen()).toBe(false);
  });

  test("keeps Tab inside an auto-focused dialog and wraps at both edges", () => {
    const popover = openPopover({
      content: focusableContent(document, ["First", "Last"]),
      anchor: anchorWith(document, true),
      autoFocus: true,
    });
    const items = [...popover.element.querySelectorAll("button")];
    expect(document.activeElement).toBe(items[0]);

    items[1]?.focus();
    press(popover.element, "keydown", "Tab");
    expect(document.activeElement).toBe(items[0]);

    press(popover.element, "keydown", "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(items[1]);
  });

  test("closes when focus leaves the panel", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const popover = openPopover({
      content: focusableContent(document, ["Inside"]),
      anchor: anchorWith(document, true),
      autoFocus: true,
    });
    popover.element.querySelector("button")?.focus();

    const event = new Event("focusout", { bubbles: true });
    Object.defineProperty(event, "relatedTarget", { value: outside });
    popover.element.dispatchEvent(event);

    expect(popover.isOpen()).toBe(false);
  });

  test("an aborted view signal closes the panel", () => {
    const controller = new AbortController();
    const popover = openPopover({
      content: content(document),
      anchor: null,
      signal: controller.signal,
    });

    controller.abort();
    expect(popover.isOpen()).toBe(false);
  });
});

describe("bindPopover", () => {
  test("rebuilds content per open, not per call, and disposes it on close", () => {
    const anchor = anchorWith(document, true);
    let builds = 0;
    let disposed = 0;
    const popover = bindPopover(anchor, () => {
      builds += 1;
      const node = content(document);
      node.textContent = `build ${builds}`;
      return {
        content: node,
        dispose: () => {
          disposed += 1;
        },
      };
    });

    popover.toggle();
    const panel = document.querySelector(".eh-popover");
    popover.open();
    expect(builds).toBe(1);
    expect(document.querySelector(".eh-popover")).toBe(panel);
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.textContent).toBe("build 1");

    popover.toggle();
    expect(popover.isOpen()).toBe(false);
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
    expect(disposed).toBe(1);

    popover.toggle();
    expect(builds).toBe(2);
    expect(document.querySelector(".eh-popover")?.textContent).toBe("build 2");
    popover.close();
    expect(disposed).toBe(2);
  });

  test("aborting the view signal closes and disposes", () => {
    const controller = new AbortController();
    const anchor = anchorWith(document, true);
    let disposed = 0;
    const popover = bindPopover(
      anchor,
      () => ({
        content: content(document),
        dispose: () => {
          disposed += 1;
        },
      }),
      {},
      controller.signal,
    );

    popover.open();
    controller.abort();

    expect(popover.isOpen()).toBe(false);
    expect(disposed).toBe(1);
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
  });
});
