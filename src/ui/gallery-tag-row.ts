import type { TagVoteTransports } from "../data/gallery-actions";
import type { MyTagTransports } from "../data/my-tags";
import { tagTokenFromHref } from "../parse/query";
import type { SearchTerm, TagSign } from "../tags/model";
import { parseSearchTerms, termIdentity, termState, termStateLabel } from "../tags/model";
import type { GalleryApiConfig, GalleryData, TagRef } from "../types";
import { bindContextMenu } from "./action-menu";
import { buttonEl, el, tagInput } from "./dom";
import { openTagMenu } from "./gallery-tag-menu";
import { createPendingAction } from "./pending-action";
import { showToast } from "./toast";

/** Callbacks the row invokes; mutations reject so the menu can report the failure inline. */
export interface TagRowActions extends TagVoteTransports, MyTagTransports {
  /** URL for a modified click, reflecting the live draft query. */
  href: (token: string, sign: TagSign) => string;
  /** Add, toggle or exclude the tag in the draft query. */
  add: (token: string, sign: TagSign) => void;
  /** Undefined on anonymous pages, which hide the tag menu. */
  config: GalleryApiConfig | null;
  /** The live draft query text that decides each chip's applied state. */
  text: () => string;
}

export interface TagRow {
  readonly element: HTMLElement;
  /** Recompute every link and applied state against the current draft query. */
  refresh: () => void;
}

/** The tag plus the site's editorial note, for screen readers and the full-string tooltip. */
function tagLabel(tag: TagRef): string {
  return tag.note === null ? tag.name : `${tag.name} — ${tag.note}`;
}

/** Keep the site's original `name | note` string as context ahead of the interaction hint. */
function tagTitle(tag: TagRef, hint: string): string {
  return tag.note === null ? hint : `${tag.name} | ${tag.note} · ${hint}`;
}

/**
 * What a plain click does to a tag already in the query.
 *
 * An included or optional tag is dropped; an excluded tag is flipped back to inclusion. Saying
 * "remove" for every applied state sent excluded terms the wrong way.
 */
function tagHint(match: SearchTerm | undefined, actionsHint: string): string {
  if (match === undefined) {
    return `Click to add to search · Alt-click to exclude · Middle-click for results${actionsHint}`;
  }
  const click = match.sign === "-" ? "Click to include" : "Click to remove";
  const alt = match.sign === "-" ? "Alt-click to remove" : "Alt-click to exclude";
  return `${termStateLabel(match)} · ${click} · ${alt} · Middle-click for results${actionsHint}`;
}

/**
 * The gallery's tag section: chips, their hover hints and context menus, the touch trigger and the
 * add-tags composer. It owns the chip state, so the gallery only composes it.
 */
export function createTagRow(
  data: GalleryData,
  actions: TagRowActions,
  signal: AbortSignal,
): TagRow | null {
  if (data.tags.length === 0) {
    return null;
  }

  const section = el("section", { class: "tag-section", "aria-label": "Tags" });
  const title = el("h2", { class: "tag-title", text: "Tags" });
  const links: Array<{
    chip: HTMLAnchorElement;
    token: string;
    /** Canonical term identity, parsed once; null when the link has no search token. */
    targetIdentity: string | null;
    tag: TagRef;
    /** Last rendered state; `undefined` forces the first refresh to write every attribute. */
    applied: TagSign | null | undefined;
  }> = [];

  const actionsHint = actions.config === null ? "" : " · Right-click for tag actions";

  const refresh = (): void => {
    // One parse of the draft feeds every chip, and one href per token serves the whole pass.
    const byIdentity = new Map<string, SearchTerm>();
    for (const term of parseSearchTerms(actions.text())) {
      const identity = termIdentity(term);
      if (!byIdentity.has(identity)) {
        byIdentity.set(identity, term);
      }
    }
    const hrefs = new Map<string, string>();
    const hrefFor = (token: string, sign: TagSign): string => {
      const key = `${sign}\u0000${token}`;
      let href = hrefs.get(key);
      if (href === undefined) {
        href = actions.href(token, sign);
        hrefs.set(key, href);
      }
      return href;
    };

    for (const link of links) {
      const href = hrefFor(link.token, "");
      if (link.chip.getAttribute("href") !== href) {
        link.chip.setAttribute("href", href);
      }
      if (link.targetIdentity === null) {
        continue;
      }
      const match = byIdentity.get(link.targetIdentity);
      const applied = match?.sign ?? null;
      if (link.applied === applied) {
        continue;
      }
      link.applied = applied;
      link.chip.classList.toggle("is-added", match !== undefined);
      link.chip.classList.toggle("is-excluded", match?.sign === "-");
      link.chip.classList.toggle("is-or", match?.sign === "~");
      link.chip.title = tagTitle(link.tag, tagHint(match, actionsHint));
      const label = tagLabel(link.tag);
      link.chip.setAttribute(
        "aria-label",
        match === undefined ? label : `${label} — ${termState(match)}`,
      );
    }
  };

  const composer = (): HTMLElement | null => {
    if (actions.config === null) {
      return null;
    }
    const input = tagInput("field-input tag-add-input");
    const submit = buttonEl({ class: "btn btn-small", type: "submit", text: "Add tags" });
    const form = el("form", { class: "tag-add" }, input, submit);
    const pending = createPendingAction();
    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (value === "") {
          return;
        }
        void pending.run({
          run: () => actions.addTags(value),
          signal,
          setBusy: (busy) => {
            // Disabling the focused submit button would drop focus to <body>, and the refresh
            // then has no idea the composer held it. Keep it enabled and guard the request.
            submit.textContent = busy ? "Adding…" : "Add tags";
          },
          success: () => {
            input.value = "";
          },
          // Keep the text so the action can be retried from the composer.
          failure: "Something went wrong.",
          failed: (message) => {
            showToast(message);
          },
        });
      },
      { signal },
    );
    // The composer starts in the chip column, under the namespace labels.
    return el(
      "div",
      { class: "tag-row tag-add-row" },
      el("span", { class: "tag-ns", "aria-hidden": "true" }),
      form,
    );
  };

  const buildGroup = (group: GalleryData["tags"][number]): HTMLElement => {
    const chips = el("div", { class: "tag-chips" });
    const nsClass = group.ns.replace(/[^a-z0-9_-]/gi, "");

    for (const tag of group.tags) {
      const token = tagTokenFromHref(tag.href, data.url);
      const target = token === null ? null : (parseSearchTerms(token)[0] ?? null);
      const chip = el(
        "a",
        {
          class: `tag-chip ns-${nsClass}`,
          href: token ? actions.href(token, "") : tag.href,
          "data-tag": `${group.ns}:${tag.name}`,
          title: tagTitle(
            tag,
            token ? tagHint(undefined, actionsHint) : `Open tag search${actionsHint}`,
          ),
          "aria-label": tag.note === null ? null : tagLabel(tag),
        },
        el("span", { class: "tag-name", text: tag.name }),
        tag.note === null ? null : el("span", { class: "tag-note", text: tag.note }),
      );
      if (actions.config !== null) {
        // The tag menu lives on the right button; it keeps the chip row compact.
        chip.setAttribute("aria-haspopup", "dialog");
      }

      if (token) {
        links.push({
          chip,
          token,
          targetIdentity: target === null ? null : termIdentity(target),
          tag,
          applied: undefined,
        });
        const sign = (event: MouseEvent): TagSign => (event.altKey ? "-" : "");
        // Modified clicks open a new tab; refresh the href first so it carries draft tags.
        chip.addEventListener(
          "pointerdown",
          (event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
              chip.setAttribute("href", actions.href(token, sign(event)));
            }
          },
          { signal },
        );
        chip.addEventListener(
          "click",
          (event) => {
            if (event.button !== 0) {
              return;
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey) {
              chip.setAttribute("href", actions.href(token, sign(event)));
              return;
            }
            event.preventDefault();
            actions.add(token, sign(event));
          },
          { signal },
        );
      }

      if (actions.config !== null) {
        const openMenu = (): void => {
          openTagMenu(
            chip,
            { ns: group.ns, name: tag.name },
            tag.href,
            {
              vote: actions.vote,
              addTags: actions.addTags,
              add: actions.add,
              token,
              watchTag: actions.watchTag,
              hideTag: actions.hideTag,
              colorTag: actions.colorTag,
            },
            signal,
          );
        };
        bindContextMenu(chip, openMenu, signal);
        // Touch has no right-click. A visible trigger appears only on coarse/no-hover pointers, so
        // the desktop chip row stays a single line of tags.
        const trigger = buttonEl(
          {
            class: "tag-menu-trigger",
            "aria-label": `Tag actions for ${tag.name}`,
            "aria-haspopup": "dialog",
            title: "Tag actions",
            onclick: openMenu,
          },
          "⋯",
        );
        chips.append(el("span", { class: "tag-chip-wrap" }, chip, trigger));
      } else {
        chips.append(chip);
      }
    }

    return el(
      "div",
      { class: "tag-row" },
      el("span", { class: `tag-ns ns-${nsClass}`, text: `${group.ns}:` }),
      chips,
    );
  };

  section.append(title);
  for (const group of data.tags) {
    section.append(buildGroup(group));
  }
  const addRow = composer();
  if (addRow !== null) {
    section.append(addRow);
  }
  refresh();

  return { element: section, refresh };
}
