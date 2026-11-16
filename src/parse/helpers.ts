import { categoryFromClass } from "./query";
import { safeUrl } from "./url";

const CATEGORY_CLASS = /^ct[0-9a-z]+$/;

/**
 * Whether a checkbox or radio is checked.
 *
 * The test DOM (linkedom) has no live `checked` property, so the attribute is the fallback; in a
 * real DOM the live property wins.
 */
export function isChecked(input: HTMLInputElement | null): boolean {
  if (!input) {
    return false;
  }
  const live: unknown = input.checked;
  return typeof live === "boolean" ? live : input.hasAttribute("checked");
}

export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function parseNumber(value: string | null | undefined): number | null {
  const match = /([\d,]+)/.exec(value ?? "");
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Absolute URL for an anchor's `href`, resolved against the page URL. */
export function anchorHref(anchor: Element | null, base: string | URL): string | null {
  const href = anchor?.getAttribute("href");
  if (href === null || href === undefined) {
    return null;
  }
  return safeUrl(href, base)?.href ?? null;
}

/** Category name and class from a gallery or list category node. */
export function categoryFromNode(node: Element | null): { name: string; cls: string } | null {
  if (!node) {
    return null;
  }
  const cls = [...node.classList].find((name) => CATEGORY_CLASS.test(name));
  if (!cls) {
    return null;
  }
  const category = categoryFromClass(cls);
  if (!category) {
    return null;
  }
  return { name: cleanText(node.textContent) || category.name, cls };
}
