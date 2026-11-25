import type { StartArchiveDownload } from "../data/archive";
import { startArchiveDownload } from "../data/archive";
import type { ArchiveCost, ArchiveOption, ArchivePage } from "../parse/archive";
import { nativeUrl } from "../routes/identity";
import { appendChildren, buttonEl, el } from "../ui/dom";
import { factRow } from "../ui/fact-row";
import { galleryBackLink, pageScaffold } from "../ui/page-scaffold";
import type { PendingAction } from "../ui/pending-action";
import { createPendingAction } from "../ui/pending-action";
import { nativePageAction, statePanel } from "../ui/state-panel";
import type { ViewContext } from "./context";

export interface ArchiveViewDeps {
  /** Download POST; tests inject a fake, production posts through `src/net/http.ts`. */
  startDownload?: StartArchiveDownload;
  /** Follow the prepared URL; tests record it instead of leaving the document. */
  openDownload?: (href: string) => void;
}

/** The card's own heading; the site labels the forms with the long submit text. */
function optionTitle(option: ArchiveOption): string {
  return option.kind === "original" ? "Original archive" : "Resampled archive";
}

/** Human wording for the parsed price. */
function costText(cost: ArchiveCost): string {
  switch (cost.kind) {
    case "free":
      return "Free";
    case "gp":
      return `${cost.amount.toLocaleString("en-US")} GP`;
    case "unavailable":
      return "Not available";
    case "insufficient":
      return "Insufficient funds";
    case "unknown":
      return cost.text === "" ? "Unknown" : cost.text;
  }
}

/** Why an option cannot be submitted from the app, or null when it can. */
function unavailableNote(option: ArchiveOption): string | null {
  if (option.available) {
    return null;
  }
  switch (option.cost.kind) {
    case "unavailable":
      return "The site does not offer this archive for the gallery.";
    case "insufficient":
      return "This account does not have enough GP for this archive.";
    case "unknown":
      return "The cost could not be read, so the app will not spend GP on this archive.";
    case "free":
    case "gp":
      return "The site does not offer this download for the gallery.";
  }
}

interface OptionControl {
  button: HTMLButtonElement;
  available: boolean;
}

/** One prepared download locks every choice; the page is leaving for the handoff. */
interface ArchiveHandoff {
  locked: boolean;
}

/**
 * One archive choice: its size, price, and the button that performs the POST.
 *
 * Every button is disabled while one request is running, so a double click cannot buy the same
 * archive twice. A failed request restores the buttons and leaves the native page one click away.
 */
function optionCard(
  option: ArchiveOption,
  ctx: ViewContext,
  controls: OptionControl[],
  pending: PendingAction,
  handoff: ArchiveHandoff,
  startDownload: StartArchiveDownload,
  openDownload: (href: string) => void,
): HTMLElement {
  const note = unavailableNote(option);
  const status = el("p", { class: "archive-option-status", role: "status", "aria-live": "polite" });
  const button: HTMLButtonElement = buttonEl({
    class: "btn btn-primary archive-download",
    disabled: option.available ? null : "disabled",
    text: `Download ${option.kind === "original" ? "original" : "resampled"} archive`,
  });
  controls.push({ button, available: option.available });

  button.addEventListener(
    "click",
    () => {
      if (!option.available) {
        return;
      }
      void pending.run({
        run: () => startDownload(option, ctx.signal),
        signal: ctx.signal,
        setBusy: (busy) => {
          button.toggleAttribute("aria-busy", busy);
          for (const control of controls) {
            control.button.disabled = busy || handoff.locked || !control.available;
          }
          if (busy) {
            status.removeAttribute("role");
            status.textContent = "Preparing the archive…";
          }
        },
        success: (href) => {
          handoff.locked = true;
          status.textContent = "Archive ready. Starting the download…";
          openDownload(href);
        },
        failure: "The archive could not be prepared.",
        failed: (message) => {
          status.setAttribute("role", "alert");
          status.textContent = message;
        },
      });
    },
    { signal: ctx.signal },
  );

  const cost = costText(option.cost);
  return el(
    "article",
    { class: "archive-option" },
    el("h2", { class: "archive-option-title", text: optionTitle(option) }),
    el(
      "div",
      { class: "archive-option-meta" },
      factRow("Size", option.size ?? "N/A"),
      factRow("Cost", cost),
    ),
    option.cost.kind === "gp"
      ? el("p", {
          class: "archive-option-note",
          text: `This download spends ${cost} when it starts.`,
        })
      : null,
    note === null ? null : el("p", { class: "archive-option-note", text: note }),
    button,
    status,
  );
}

/** Links back to the gallery and its torrent list, both owned by the app. */
function galleryLinks(data: ArchivePage): HTMLElement | null {
  const links: HTMLElement[] = [];
  if (data.galleryHref !== null) {
    links.push(galleryBackLink(data.galleryHref, "meta-link"));
  }
  if (data.torrentsHref !== null) {
    links.push(el("a", { class: "meta-link", href: data.torrentsHref, text: "Torrents" }));
  }
  return links.length === 0 ? null : el("div", { class: "archive-links" }, ...links);
}

function fundsLine(funds: ArchivePage["funds"]): HTMLElement | null {
  if (funds === null || (funds.gp === null && funds.credits === null)) {
    return null;
  }
  const parts: string[] = [];
  if (funds.gp !== null) {
    parts.push(`${funds.gp} GP`);
  }
  if (funds.credits !== null) {
    parts.push(`${funds.credits} Credits`);
  }
  return el("p", { class: "archive-funds", text: `Available: ${parts.join(" · ")}` });
}

/**
 * Render the gallery archive chooser.
 *
 * This is the page behind the gallery's `Archive Download` action. The site opens it as a small
 * popup with two buttons; here the reader gets both offers, their real prices, and the same native
 * escape every dead end carries.
 */
export function renderArchive(
  host: HTMLElement,
  data: ArchivePage,
  ctx: ViewContext,
  deps: ArchiveViewDeps = {},
): void {
  const startDownload = deps.startDownload ?? startArchiveDownload;
  const openDownload =
    deps.openDownload ??
    ((href: string) => {
      window.location.href = href;
    });

  const controls: OptionControl[] = [];
  const pending = createPendingAction();
  const handoff: ArchiveHandoff = { locked: false };
  const options = [data.original, data.resample].filter(
    (option): option is ArchiveOption => option !== null,
  );
  const grid = el(
    "div",
    { class: "archive-options" },
    ...options.map((option) =>
      optionCard(option, ctx, controls, pending, handoff, startDownload, openDownload),
    ),
  );

  const empty =
    options.length === 0
      ? statePanel({
          title: "No archive options",
          text: "The site did not offer an archive for this gallery.",
        })
      : null;

  const native = nativePageAction(nativeUrl(data.url));
  pageScaffold(host, {
    title: data.title === "" ? "Archive Download" : data.title,
    summary: [el("span", { class: "badge", text: "Archive Download" })],
    signal: ctx.signal,
  });
  appendChildren(host, [
    fundsLine(data.funds) ?? null,
    empty ?? grid,
    galleryLinks(data) ?? null,
    el(
      "div",
      { class: "archive-footer" },
      el("a", { class: "btn btn-ghost", href: native.href, "data-native": "", text: native.label }),
    ),
  ]);
}
