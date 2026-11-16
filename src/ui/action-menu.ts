import { el } from "./dom";
import type { Popover } from "./popover";
import { closePopovers, openPopover } from "./popover";
import { openPopup } from "./popup-window";

/** One row of an {@link openActionMenu} panel. */
export interface ActionMenuItem {
  label: string;
  /** Runs after the menu closes. */
  run?: () => void;
  /** Renders a link instead of a button. */
  href?: string;
  /** Leave the navigation to the site's own page load. */
  native?: boolean;
  /** Open the site page in a sized window instead of navigating away. */
  popup?: { width: number; height: number };
}

/** Inputs for {@link openActionMenu}. */
interface ActionMenuRequest {
  anchor: HTMLElement;
  label: string;
  items: readonly ActionMenuItem[];
  signal?: AbortSignal;
}

/**
 * Open a menu of secondary actions anchored to `anchor`.
 *
 * Pair it with {@link bindContextMenu} so the same menu opens on right-click, Shift+F10 or the menu
 * key.
 */
export function openActionMenu({ anchor, label, items, signal }: ActionMenuRequest): Popover {
  closePopovers();

  const content = el("div", { class: "action-menu", role: "none" });
  let dismiss = (): void => {};

  for (const item of items) {
    const node =
      item.href === undefined
        ? el("button", {
            class: "action-menu-item",
            type: "button",
            role: "menuitem",
            text: item.label,
            onclick: () => {
              dismiss();
              item.run?.();
            },
          })
        : (() => {
            const href = item.href;
            const popup = item.popup;
            return el("a", {
              class: "action-menu-item",
              role: "menuitem",
              href,
              "data-native": item.native === true ? "" : null,
              text: item.label,
              onclick: (event: Event) => {
                dismiss();
                if (popup) {
                  event.preventDefault();
                  openPopup(href, popup.width, popup.height);
                }
              },
            });
          })();
    content.append(node);
  }

  const popover = openPopover({
    content,
    anchor,
    role: "menu",
    label,
    className: "action-menu-panel",
    autoFocus: true,
    signal,
  });
  dismiss = () => popover.close();
  return popover;
}

/** Open `open` on right-click instead of the browser menu. */
export function bindContextMenu(
  element: HTMLElement,
  open: () => void,
  signal?: AbortSignal,
): void {
  element.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      open();
    },
    { signal },
  );
}
