/**
 * Address for the site's own `seek` parameter.
 *
 * Listings are cursor-paginated (`?next=`/`?prev=`), so there is no page number to jump to; the
 * site's Jump/Seek takes a date (`2020`, `2020-06`, `2020-06-15`) or an offset (`1d`, `2w`, `3m`,
 * `1y`) and answers with the page that starts there. The cursor and any earlier seek are dropped so
 * the new position is unambiguous.
 */
export function seekHref(baseUrl: string, value: string): string {
  const target = new URL(baseUrl);
  for (const key of ["p", "next", "prev", "seek", "jump"]) {
    target.searchParams.delete(key);
  }
  const seek = value.trim();
  if (seek !== "") {
    target.searchParams.set("seek", seek);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}
