import type { TagVoteTransports } from "../data/gallery-actions";
import type { MyTagTransports } from "../data/my-tags";
import type { TagSign } from "../tags/model";
import { el, icon, tagInput } from "./dom";
import { errorText } from "./error-text";
import { bindPopover, closePopovers } from "./popover";
import type { PopoverBinding } from "./popover";

/** Callbacks the tag menu invokes. Mutations reject so the panel can report the failure inline. */
export interface TagMenuHandlers extends TagVoteTransports, MyTagTransports {
  /** Apply a sign to the tag in the draft search; `null` when the tag has no search token. */
  add: (token: string, sign: TagSign) => void;
  /** Exact-match search token for this tag, if the page carried one. */
  token: string | null;
}

function wikiHref(tag: string): string {
  const name = tag.replace(/^[a-z]+:\s?/i, "").replace(/ /g, "_");
  return `https://ehwiki.org/wiki/${encodeURIComponent(name)}`;
}

/** Namespace and display name of the tag a menu was opened for. */
export interface TagMenuTag {
  ns: string;
  name: string;
}

let openMenu: { anchor: HTMLElement; binding: PopoverBinding } | null = null;

/** Open (or close) the per-tag action menu anchored to its trigger. */
export function openTagMenu(
  anchor: HTMLElement,
  tag: TagMenuTag,
  tagHref: string,
  handlers: TagMenuHandlers,
  signal: AbortSignal,
): void {
  if (openMenu?.anchor === anchor && openMenu.binding.isOpen()) {
    openMenu.binding.close();
    return;
  }
  closePopovers();

  const raw = `${tag.ns}:${tag.name}`;
  const divider = (): HTMLElement => el("hr", { class: "tag-menu-divider" });

  const content = el("div", { class: "tag-menu" });
  const error = el("p", { class: "tag-menu-error", role: "alert", hidden: "" });
  const form = el("form", { class: "tag-menu-new" });
  const input = tagInput("field-input");
  const extraButtons: HTMLButtonElement[] = [];
  const buttons = {
    up: el("button", {
      class: "tag-menu-item",
      type: "button",
      text: "Vote up",
    }),
    down: el("button", {
      class: "tag-menu-item",
      type: "button",
      text: "Vote down",
    }),
    include: el("button", {
      class: "tag-menu-item",
      type: "button",
      text: "Include in search",
    }),
    exclude: el("button", {
      class: "tag-menu-item",
      type: "button",
      text: "Exclude from search",
    }),
    or: el("button", {
      class: "tag-menu-item",
      type: "button",
      text: "Make optional (OR)",
    }),
  };

  const setBusy = (busy: boolean): void => {
    for (const button of [...Object.values(buttons), ...extraButtons]) {
      button.disabled = busy;
    }
  };

  const showError = (cause: unknown): void => {
    error.textContent = errorText(cause, "The action failed.");
    error.hidden = false;
  };

  // The binding exists before the action handlers so they can close their own panel; it opens only
  // after `content` is assembled.
  const binding = bindPopover(
    anchor,
    () => ({
      content,
      dispose: () => {
        if (openMenu?.anchor === anchor) {
          openMenu = null;
        }
      },
    }),
    {
      role: "dialog",
      label: `Actions for ${tag.name}`,
      className: "tag-menu-panel",
      autoFocus: true,
    },
    signal,
  );

  let running = false;
  const run = async (action: () => Promise<void>, focusTarget: HTMLElement): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    error.hidden = true;
    setBusy(true);
    let failed = false;
    try {
      await action();
      binding.close();
    } catch (cause) {
      // Keep the panel (and any typed tags) so the action can be retried.
      showError(cause);
      failed = true;
    } finally {
      running = false;
      setBusy(false);
      if (failed) {
        // Disabling the action buttons during the request dropped focus to <body>; put it back.
        focusTarget.focus();
      }
    }
  };

  buttons.up.addEventListener("click", () => void run(() => handlers.vote(raw, 1), buttons.up));
  buttons.down.addEventListener(
    "click",
    () => void run(() => handlers.vote(raw, -1), buttons.down),
  );

  const applySign = (sign: TagSign): void => {
    if (handlers.token === null) {
      return;
    }
    handlers.add(handlers.token, sign);
    binding.close();
  };
  buttons.include.addEventListener("click", () => applySign(""));
  buttons.exclude.addEventListener("click", () => applySign("-"));
  buttons.or.addEventListener("click", () => applySign("~"));

  form.append(input, el("button", { class: "btn btn-small", type: "submit", text: "Add tags" }));
  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (value === "") {
        return;
      }
      void run(() => handlers.addTags(value), input);
    },
    { signal },
  );

  const myTagButtons: HTMLButtonElement[] = [];
  if (handlers.watchTag) {
    const watch = el("button", { class: "tag-menu-item", type: "button", text: "Watch tag" });
    watch.addEventListener("click", () => {
      const runWatch = handlers.watchTag;
      if (runWatch) {
        void run(() => runWatch(raw), watch);
      }
    });
    extraButtons.push(watch);
    myTagButtons.push(watch);
  }
  if (handlers.hideTag) {
    const hide = el("button", { class: "tag-menu-item", type: "button", text: "Hide tag" });
    hide.addEventListener("click", () => {
      const runHide = handlers.hideTag;
      if (runHide) {
        void run(() => runHide(raw), hide);
      }
    });
    extraButtons.push(hide);
    myTagButtons.push(hide);
  }

  const actionRows: HTMLElement[] = [
    el("div", { class: "tag-menu-actions" }, buttons.up, buttons.down),
  ];
  if (myTagButtons.length > 0) {
    actionRows.push(el("div", { class: "tag-menu-actions" }, ...myTagButtons));
  }
  if (handlers.colorTag) {
    const color = el("input", {
      class: "tag-menu-color",
      type: "color",
      value: "#ff8800",
      "aria-label": "Tag highlight colour",
      title: "Highlight colour",
    });
    const apply = el("button", {
      class: "tag-menu-item",
      type: "button",
      text: "Apply colour",
    });
    extraButtons.push(apply);
    apply.addEventListener("click", () => {
      const runColor = handlers.colorTag;
      if (runColor) {
        void run(() => runColor(raw, color.value), apply);
      }
    });
    actionRows.push(el("div", { class: "tag-menu-actions" }, color, apply));
  }
  if (handlers.token !== null) {
    actionRows.push(
      el("div", { class: "tag-menu-actions" }, buttons.include, buttons.exclude, buttons.or),
    );
  }
  content.append(
    el(
      "div",
      { class: "tag-menu-head" },
      el("span", { class: "tag-menu-title", text: tag.name }),
      el("span", { class: "tag-menu-ns", text: tag.ns }),
    ),
    divider(),
    ...actionRows,
  );

  content.append(
    el(
      "div",
      { class: "tag-menu-actions" },
      el("a", { class: "tag-menu-item", href: tagHref, text: "Show tagged galleries" }),
      el(
        "a",
        {
          class: "tag-menu-item justify-between",
          href: wikiHref(tag.name),
          "data-native": "",
          target: "_blank",
          rel: "noopener",
        },
        "Tag definition",
        icon("external"),
      ),
    ),
    error,
    divider(),
    form,
  );

  openMenu = { anchor, binding };
  binding.open();
}
