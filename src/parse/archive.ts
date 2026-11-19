import { anchorHref, cleanText, parseNumber } from "./helpers";
import { safeUrl } from "./url";

/** Which archive the site offers for a gallery. */
export type ArchiveKind = "original" | "resample";

/**
 * The GP price the chooser prints.
 *
 * `unknown` is deliberately distinct from `unavailable`: it means the markup changed, so the view
 * refuses to submit and sends the reader to the native page rather than spending an unread amount.
 */
export type ArchiveCost =
  | { kind: "free" }
  | { kind: "gp"; amount: number }
  | { kind: "unavailable" }
  | { kind: "insufficient" }
  | { kind: "unknown"; text: string };

/** One of the chooser's two download forms. */
export interface ArchiveOption {
  kind: ArchiveKind;
  /** Hidden form field; the POST echoes it back. */
  dltype: string;
  /** Submit button label, which is also the POST's `dlcheck` value. */
  label: string;
  /** Absolute form target, including the archiver key when the site supplies one. */
  action: string;
  cost: ArchiveCost;
  /** Estimated archive size as printed, e.g. `18.46 MiB`; null for N/A or a missing value. */
  size: string | null;
  /** The form can be submitted from the app: enabled, and its cost is known. */
  available: boolean;
}

/** Parsed `/archiver.php` chooser for one gallery. */
export interface ArchivePage {
  url: string;
  title: string;
  /** GP and Credits balance the site prints above the options, when signed in. */
  funds: { gp: string | null; credits: string | null } | null;
  original: ArchiveOption | null;
  resample: ArchiveOption | null;
  /** In-app gallery address built from `gid`/`token`, when the query is complete. */
  galleryHref: string | null;
  /** In-app torrent list for the same gallery. */
  torrentsHref: string | null;
}

const GID = /^\d+$/;
const GALLERY_TOKEN = /^[0-9a-f]+$/i;

/** Read the strong value after a label, falling back to the label's own inline text. */
function labelledText(container: Element, label: string): string {
  for (const node of container.querySelectorAll("div, p")) {
    const text = cleanText(node.textContent);
    if (!text.startsWith(label)) {
      continue;
    }
    const strong = node.querySelector("strong");
    return cleanText(strong?.textContent) || cleanText(text.slice(label.length));
  }
  return "";
}

/** The div that wraps one form with its cost line and size line. */
function optionContainer(form: Element): Element {
  let node = form.parentElement;
  while (node !== null && node.id !== "db") {
    const text = cleanText(node.textContent);
    if (text.includes("Download Cost:") && text.includes("Estimated Size:")) {
      return node;
    }
    node = node.parentElement;
  }
  return form.parentElement ?? form;
}

/** Classify the chooser's printed price. */
function parseCost(text: string): ArchiveCost {
  const value = cleanText(text);
  if (value === "") {
    return { kind: "unknown", text: value };
  }
  if (/^free!?$/i.test(value)) {
    return { kind: "free" };
  }
  if (/^n\/a$/i.test(value)) {
    return { kind: "unavailable" };
  }
  if (/insufficient funds/i.test(value)) {
    return { kind: "insufficient" };
  }
  if (/^([\d,]+)\s*GP$/i.test(value)) {
    const amount = parseNumber(value);
    if (amount !== null) {
      return { kind: "gp", amount };
    }
  }
  return { kind: "unknown", text: value };
}

/** A printed estimated size, or null when the site answers N/A. */
function parseSize(text: string): string | null {
  const value = cleanText(text);
  return value === "" || /^n\/a$/i.test(value) ? null : value;
}

function optionFrom(form: Element, base: string): ArchiveOption | null {
  const dltype = (form.querySelector<HTMLInputElement>("input[name='dltype']")?.value ?? "").trim();
  const kind = dltype === "org" ? "original" : dltype === "res" ? "resample" : null;
  if (kind === null) {
    return null;
  }

  const action = safeUrl(form.getAttribute("action") ?? "", base)?.href ?? null;
  if (action === null) {
    return null;
  }

  const submit = form.querySelector<HTMLInputElement>("input[name='dlcheck']");
  const label =
    (submit?.getAttribute("value") ?? "").trim() ||
    (kind === "original" ? "Download Original Archive" : "Download Resample Archive");

  const container = optionContainer(form);
  const cost = parseCost(labelledText(container, "Download Cost:"));
  const disabled = submit === null || submit.hasAttribute("disabled");
  const available = !disabled && (cost.kind === "free" || cost.kind === "gp");

  return {
    kind,
    dltype,
    label,
    action,
    cost,
    size: parseSize(labelledText(container, "Estimated Size:")),
    available,
  };
}

/** The balance line under `Current Funds:`, split into its two printed amounts. */
function parseFunds(doc: Document): ArchivePage["funds"] {
  const container = doc.getElementById("db");
  if (container === null) {
    return null;
  }

  for (const paragraph of container.querySelectorAll("p")) {
    if (!cleanText(paragraph.textContent).startsWith("Current Funds:")) {
      continue;
    }
    const text = cleanText(paragraph.nextElementSibling?.textContent ?? paragraph.textContent);
    const gp = /([\d,]+)\s*GP/i.exec(text)?.[1] ?? null;
    const credits = /([\d,]+)\s*Credits/i.exec(text)?.[1] ?? null;
    return { gp, credits };
  }
  return null;
}

/** The gallery's in-app addresses, when the archiver query names a complete gallery. */
function galleryLinks(url: string): Pick<ArchivePage, "galleryHref" | "torrentsHref"> {
  const parsed = safeUrl(url);
  const gid = parsed?.searchParams.get("gid") ?? "";
  const token = parsed?.searchParams.get("token") ?? "";
  if (!GID.test(gid) || !GALLERY_TOKEN.test(token)) {
    return { galleryHref: null, torrentsHref: null };
  }
  return {
    galleryHref: `/g/${gid}/${token}/`,
    torrentsHref: `/gallerytorrents.php?gid=${gid}&t=${token}`,
  };
}

/**
 * Parse the `/archiver.php` chooser.
 *
 * The options live in two forms distinguished by `dltype`; the surrounding divs carry the printed
 * cost and estimated size. A resample form can be disabled or absent, so both slots are nullable.
 */
export function parseArchivePage(doc: Document, url: string): ArchivePage {
  const container = doc.getElementById("db");
  let original: ArchiveOption | null = null;
  let resample: ArchiveOption | null = null;

  for (const form of container?.querySelectorAll("form") ?? []) {
    const option = optionFrom(form, url);
    if (option?.kind === "original" && original === null) {
      original = option;
    } else if (option?.kind === "resample" && resample === null) {
      resample = option;
    }
  }

  return {
    url,
    title: cleanText(container?.querySelector("h1")?.textContent),
    funds: parseFunds(doc),
    original,
    resample,
    ...galleryLinks(url),
  };
}

/**
 * Read the download link from the page the archive POST returns.
 *
 * That confirmation page holds `#continue` while the archive server prepares the file; the link is
 * the one the browser would have followed automatically.
 */
export function parseArchiveDownloadHref(doc: Document, base: string): string | null {
  const anchor = doc.getElementById("continue")?.querySelector("a[href]") ?? null;
  const href = anchorHref(anchor, base);
  if (href === null) {
    return null;
  }
  const parsed = safeUrl(href);
  return parsed !== null && /^https?:$/.test(parsed.protocol) ? href : null;
}
