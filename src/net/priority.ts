/**
 * The request classes the app schedules with, from most to least urgent.
 *
 * The order is the policy: a route's own document outranks the viewer page the reader is waiting
 * for, which outranks appended pages and background account loads. Warming is always last, so
 * speculative traffic can never delay a page the reader asked for.
 */
export const PRIORITY_CLASSES = [
  "critical",
  "navigation",
  "facing",
  "append",
  "background",
  "prefetch",
] as const;

/** One named request class. */
type PriorityClass = (typeof PRIORITY_CLASSES)[number];

/** A numeric queue priority; compare with the queue's descending sort. */
export type Priority = number;

const VALUES: Record<PriorityClass, Priority> = {
  /** Form POSTs and the viewer's no-limit retry: the reader is waiting on a mutation or repair. */
  critical: 10,
  /** The document for the route the reader navigated to. */
  navigation: 8,
  /** A viewer page the reader is about to see (spread companion, continuous next, page step). */
  facing: 7,
  /** The next page an infinite scroll is appending. */
  append: 6,
  /** Folder, note and other account chrome that can wait for the page itself. */
  background: 4,
  /** Speculative warming; strictly the lowest class. */
  prefetch: 2,
};

/** Numeric queue priority for one named request class. */
export function priorityOf(requestClass: PriorityClass): Priority {
  return VALUES[requestClass];
}
