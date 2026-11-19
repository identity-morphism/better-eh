import type { StartArchiveDownload } from "../data/archive";
import { startArchiveDownload } from "../data/archive";
import type { ArchiveCost, ArchiveOption, ArchivePage } from "../parse/archive";
import { nativeUrl } from "../routes/identity";
import { appendChildren, el } from "../ui/dom";
import { errorText } from "../ui/error-text";
import { listHeader } from "../ui/list-header";
import { siteNav } from "../ui/topbar";
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

function metaItem(label: string, value: string): HTMLElement {
  return el(
    "div",
    { class: "archive-option-meta-item" },
    el("span", { class: "archive-option-meta-label", text: label }),
    el("span", { class: "archive-option-meta-value", text: value }),
  );
}

interface OptionControl {
  button: HTMLButtonElement;
  available: boolean;
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
  startDownload: StartArchiveDownload,
  openDownload: (href: string) => void,
): HTMLElement {
  const note = unavailableNote(option);
  const status = el("p", { class: "archive-option-status", role: "status", "aria-live": "polite" });
  const button: HTMLButtonElement = el("button", {
    class: "btn btn-primary archive-download",
    type: "button",
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
      for (const control of controls) {
        control.button.disabled = true;
      }
      button.setAttribute("aria-busy", "true");
      status.removeAttribute("role");
      status.textContent = "Preparing the archive…";

      void startDownload(option, ctx.signal).then(
        (href) => {
          if (ctx.signal.aborted) {
            return;
          }
          button.removeAttribute("aria-busy");
          status.textContent = "Archive ready. Starting the download…";
          openDownload(href);
        },
        (error: unknown) => {
          if (ctx.signal.aborted) {
            return;
          }
          button.removeAttribute("aria-busy");
          for (const control of controls) {
            control.button.disabled = !control.available;
          }
          status.setAttribute("role", "alert");
          status.textContent = errorText(error, "The archive could not be prepared.");
        },
      );
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
      metaItem("Size", option.size ?? "N/A"),
      metaItem("Cost", cost),
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
    links.push(el("a", { class: "meta-link", href: data.galleryHref, text: "Back to gallery" }));
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
  host.replaceChildren();
  const startDownload = deps.startDownload ?? startArchiveDownload;
  const openDownload =
    deps.openDownload ??
    ((href: string) => {
      window.location.href = href;
    });

  const controls: OptionControl[] = [];
  const options = [data.original, data.resample].filter(
    (option): option is ArchiveOption => option !== null,
  );
  const grid = el(
    "div",
    { class: "archive-options" },
    ...options.map((option) => optionCard(option, ctx, controls, startDownload, openDownload)),
  );

  const empty =
    options.length === 0
      ? el(
          "div",
          { class: "empty-state" },
          el("p", { class: "state-title", text: "No archive options" }),
          el("p", {
            class: "state-text",
            text: "The site did not offer an archive for this gallery.",
          }),
        )
      : null;

  appendChildren(host, [
    siteNav(ctx.signal),
    listHeader({
      title: data.title === "" ? "Archive Download" : data.title,
      summary: [el("span", { class: "badge", text: "Archive Download" })],
    }),
    fundsLine(data.funds) ?? null,
    empty ?? grid,
    galleryLinks(data) ?? null,
    el(
      "div",
      { class: "archive-footer" },
      el("a", {
        class: "btn btn-ghost",
        href: nativeUrl(data.url),
        "data-native": "",
        text: "Open native page",
      }),
    ),
  ]);
}
