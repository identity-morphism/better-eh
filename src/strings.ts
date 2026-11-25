/** String primitives shared by the data, parse and tag layers. */

/** Collapse every run of whitespace to one space and trim the ends. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
