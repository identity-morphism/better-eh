import { appendChildren, el, icon } from "./dom";

interface Message {
  text: string;
  count: number;
  node: HTMLElement | null;
}

const messages: Message[] = [];
let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host?.isConnected) {
    return host;
  }
  const existing = document.getElementById("eh-banner-host");
  if (existing) {
    host = existing;
    // One persistent live region: banners are appended into it, never re-created around it.
    if (!existing.hasAttribute("aria-live")) {
      existing.setAttribute("role", "status");
      existing.setAttribute("aria-live", "polite");
      existing.setAttribute("aria-atomic", "false");
    }
    return existing;
  }
  host = el("div", {
    id: "eh-banner-host",
    class: "eh-banner-host",
    role: "status",
    "aria-live": "polite",
  });
  const root = document.getElementById("eh-root") ?? document.body;
  root.prepend(host);
  return host;
}

function build(message: Message): HTMLElement {
  const banner = el("div", { class: "eh-banner" });
  appendChildren(banner, [
    icon("warning"),
    el("span", { class: "eh-banner-text", text: message.text }),
    message.count > 1 ? el("span", { class: "eh-banner-count", text: `×${message.count}` }) : null,
    el(
      "button",
      {
        class: "eh-banner-close",
        type: "button",
        "aria-label": "Dismiss",
        onclick: () => {
          dismiss(message, banner);
        },
      },
      icon("close"),
    ),
  ]);
  return banner;
}

function dismiss(message: Message, banner: HTMLElement): void {
  const index = messages.indexOf(message);
  if (index >= 0) {
    messages.splice(index, 1);
  }

  // Move focus off the button before it leaves the document, or it falls to <body>.
  const next = messages[0]?.node;
  banner.remove();
  message.node = null;

  if (next) {
    next.querySelector<HTMLElement>(".eh-banner-close")?.focus();
    return;
  }
  if (host) {
    host.hidden = true;
  }
}

/**
 * Show a persistent site-wide warning. Identical messages are coalesced.
 *
 * Existing banners keep their DOM node: replacing the live region on every change re-announces
 * every banner and throws away the focus a keyboard user put on a Dismiss button.
 */
export function showBanner(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  const container = ensureHost();
  container.hidden = false;

  const existing = messages.find((message) => message.text === trimmed);
  if (existing) {
    existing.count = Math.min(existing.count + 1, 99);
    if (existing.node) {
      const count = existing.node.querySelector(".eh-banner-count");
      if (count) {
        count.textContent = `×${existing.count}`;
      } else {
        existing.node.insertBefore(
          el("span", { class: "eh-banner-count", text: `×${existing.count}` }),
          existing.node.querySelector(".eh-banner-close"),
        );
      }
    }
    return;
  }

  const message: Message = { text: trimmed, count: 1, node: null };
  const banner = build(message);
  message.node = banner;
  messages.push(message);
  container.append(banner);
}
