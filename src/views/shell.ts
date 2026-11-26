/** Every id the mounted viewer shell provides, in document order. */
export const SHELL_IDS = [
  "reader",
  "img-wrap",
  "main-img",
  "spread-img",
  "continuous",
  "hud",
  "hud-gallery",
  "hud-slideshow",
  "hud-title",
  "page-nav",
  "hud-first",
  "hud-prev",
  "hud-next",
  "hud-last",
  "page-info",
  "hud-counter",
  "file-info",
  "page-links",
  "hud-original",
  "hud-forum",
  "hud-search",
  "hud-help",
  "hud-toast",
  "img-error",
  "img-error-text",
  "img-error-retry",
  "img-error-native",
] as const;

type ShellIds = (typeof SHELL_IDS)[number];

interface ShellElements {
  reader: HTMLElement;
  "img-wrap": HTMLElement;
  "main-img": HTMLImageElement;
  "spread-img": HTMLImageElement;
  continuous: HTMLElement;
  hud: HTMLElement;
  "hud-gallery": HTMLAnchorElement;
  "hud-slideshow": HTMLButtonElement;
  "hud-title": HTMLElement;
  "page-nav": HTMLElement;
  "hud-first": HTMLButtonElement;
  "hud-prev": HTMLButtonElement;
  "hud-next": HTMLButtonElement;
  "hud-last": HTMLButtonElement;
  "page-info": HTMLElement;
  "hud-counter": HTMLElement;
  "file-info": HTMLElement;
  "page-links": HTMLElement;
  "hud-original": HTMLAnchorElement;
  "hud-forum": HTMLAnchorElement;
  "hud-search": HTMLAnchorElement;
  "hud-help": HTMLElement;
  "hud-toast": HTMLElement;
  "img-error": HTMLElement;
  "img-error-text": HTMLElement;
  "img-error-retry": HTMLButtonElement;
  "img-error-native": HTMLAnchorElement;
}

/** Look up one shell element, failing loudly when `shell.html` and its contract drift apart. */
export function requireShell<K extends ShellIds>(id: K): ShellElements[K] {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing #${id} in shell.html`);
  }
  return node as ShellElements[K];
}
