/** App-owned posted-date bound carried on listing addresses. */
export interface DateRange {
  /** Oldest day to show (`YYYY-MM-DD`), or empty for no lower bound. */
  since: string;
  /** Newest day to show (`YYYY-MM-DD`), or empty for no upper bound. */
  until: string;
}

/** Items left after a range filter, plus whether paging has left the range. */
export interface DateRangeResult<T> {
  items: T[];
  /**
   * Whether the page held an item older than `since`.
   *
   * Results are newest-first, so that page is the last one the range can use; the caller stops
   * paging there instead of walking the whole result set.
   */
  crossedSince: boolean;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const POSTED_DATE = /^\s*(\d{4})-(\d{2})-(\d{2})(?=\s|$)/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Whether `value` is a real calendar day in `YYYY-MM-DD` form.
 *
 * The value is compared as a day string, never through `Date`, so a listing cannot shift a result
 * by the viewer's time zone.
 */
export function isValidDate(value: string): boolean {
  const match = ISO_DATE.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = month === 2 && leapYear ? 29 : (MONTH_DAYS[month - 1] ?? 0);
  return day <= lastDay;
}

/** Whether a range has at least one valid bound and therefore filters anything. */
export function isDateRangeActive(range: DateRange): boolean {
  return isValidDate(range.since) || isValidDate(range.until);
}

/** The `YYYY-MM-DD` day at the start of a listing item's posted text, or null when absent. */
export function postedDate(posted: string): string | null {
  const match = POSTED_DATE.exec(posted);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  return isValidDate(day) ? day : null;
}

/**
 * Keep the items a range covers and report whether the page crossed its `since` boundary.
 *
 * Both bounds are inclusive. Items without a recognizable posted date are dropped: the range asked
 * for a day, and an unknown day cannot satisfy it. An inactive range returns every item unchanged.
 */
export function filterByDateRange<T extends { posted: string }>(
  items: readonly T[],
  range: DateRange,
): DateRangeResult<T> {
  const since = isValidDate(range.since) ? range.since.trim() : null;
  const until = isValidDate(range.until) ? range.until.trim() : null;
  if (since === null && until === null) {
    return { items: [...items], crossedSince: false };
  }

  const kept: T[] = [];
  let crossedSince = false;
  for (const item of items) {
    const day = postedDate(item.posted);
    if (day === null) {
      continue;
    }
    if (since !== null && day < since) {
      crossedSince = true;
      continue;
    }
    if (until !== null && day > until) {
      continue;
    }
    kept.push(item);
  }
  return { items: kept, crossedSince };
}

/**
 * Carry the app-owned range onto a pagination link.
 *
 * The site's cursor links preserve its own filters but know nothing about `eh_since`/`eh_until`, so
 * every next-page URL is wrapped before it reaches the pager or the page loader.
 */
export function withDateRange(url: string, range: DateRange): string {
  const target = new URL(url);
  setDateParam(target.searchParams, "eh_since", range.since);
  setDateParam(target.searchParams, "eh_until", range.until);
  return target.href;
}

function setDateParam(params: URLSearchParams, key: string, value: string): void {
  const date = value.trim();
  if (isValidDate(date)) {
    params.set(key, date);
  } else {
    params.delete(key);
  }
}

/**
 * The address the site should load for a listing whose range starts at `until`.
 *
 * The site's `seek` cursor can move to a date, but there is no native range filter. Starting the
 * first request at the range's newest day keeps the client-side walk short. Adding `seek` once is
 * enough: the redirected address already carries it, so boot does not redirect again.
 */
export function listRequestUrl(url: string): string {
  const target = new URL(url);
  if (target.searchParams.has("seek")) {
    return url;
  }
  const until = (target.searchParams.get("eh_until") ?? "").trim();
  if (!isValidDate(until)) {
    return url;
  }
  target.searchParams.set("seek", until);
  return target.href;
}
