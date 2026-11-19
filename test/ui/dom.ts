import { HTMLElement as LinkedomElement, Node } from "linkedom";

import type { ViewContext } from "../../src/views/context";
import { parseDocument } from "../dom";

/**
 * Linkedom has no top layer. `showPopover` is the only platform call the UI makes to enter it, so
 * stubbing it keeps the panels rendering while leaving the stacking assertions to a real browser.
 */
const proto = LinkedomElement.prototype as unknown as Record<string, unknown>;
proto.showPopover = function showPopover(): void {};

/**
 * Install a linkedom document at `url` as the global DOM that the UI modules build against.
 *
 * The UI modules read `document` and `location` lazily, so tests install them before rendering.
 * `html` seeds the parsed document, for tests that boot from a page fixture.
 */
export function installDom(
  url = "https://e-hentai.org/",
  html = '<!doctype html><html><body class="eh-body"></body></html>',
): Document {
  const document = parseDocument(html);
  const view = document.defaultView as unknown as {
    Event: typeof Event;
    Element: typeof Element;
    HTMLElement: typeof HTMLElement;
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.document = document;
  globals.Node = Node;
  globals.Element = view.Element;
  globals.HTMLElement = view.HTMLElement;
  globals.window = view;
  globals.Event = view.Event;
  // Views read `location` for the active tab and for relative URL resolution.
  globals.location = new URL(url);
  return document;
}

/** A context that navigates nowhere, suitable for a view rendered on its own. */
export function viewContext(overrides: Partial<ViewContext> = {}): ViewContext {
  return {
    signal: new AbortController().signal,
    navigate: () => undefined,
    reload: () => undefined,
    setLeaveGuard: () => undefined,
    ...overrides,
  };
}

/** Append a fresh view host to the installed document and return it. */
export function mountHost(document: Document = globalThis.document): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

/** Look up a required node, failing the test with a useful message when it is absent. */
export function requireNode<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) {
    throw new Error(`missing ${selector}`);
  }
  return node;
}

/** Silence the IntersectionObserver for views whose sentinels are not under test. */
export function installNoopObservers(): void {
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
