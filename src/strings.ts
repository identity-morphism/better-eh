/** String primitives shared by the data, parse and tag layers. */

/**
 * Text already in canonical form: no leading/trailing whitespace, no whitespace runs, and only
 * plain spaces between words. Anything else (`\t`, non-breaking spaces, newlines) goes to the
 * collapsing path.
 */
const ALREADY_COLLAPSED = /^\S(?: \S)*$/u;

/** Collapse every run of whitespace to one space and trim the ends. */
export function collapseWhitespace(value: string): string {
  if (ALREADY_COLLAPSED.test(value)) {
    return value;
  }
  return value.replace(/\s+/gu, " ").trim();
}
