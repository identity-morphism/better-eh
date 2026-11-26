import { getSettings } from "./settings";

/** Prefix shared by every console line the script writes. */
export const LOG_TAG = "[Better EH]";

/** Keep the diagnostic tail small enough to paste into an issue. */
const MAX_EVENTS = 100;
const MAX_MESSAGE = 800;

export interface LogEvent {
  at: string;
  level: "log" | "warn" | "error";
  message: string;
}

const events: LogEvent[] = [];

function describe(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return String(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function record(level: LogEvent["level"], args: unknown[]): void {
  const message = args.map(describe).join(" ").slice(0, MAX_MESSAGE);
  events.push({ at: new Date().toISOString(), level, message });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

/** The recent lines, oldest first. Bounded; the diagnostics report reads this. */
export function recentEvents(): readonly LogEvent[] {
  return events;
}

/** Start a fresh tail, used by tests and when the user clears diagnostics. */
export function clearEventLog(): void {
  events.length = 0;
}

/** Record an uncaught error even when debug logging is off. */
export function recordError(error: unknown, source = "error"): void {
  record("error", [source, error]);
}

export function log(...args: unknown[]): void {
  record("log", args);
  if (getSettings().debug) {
    console.log(LOG_TAG, ...args);
  }
}

export function warn(...args: unknown[]): void {
  record("warn", args);
  if (getSettings().debug) {
    console.warn(LOG_TAG, ...args);
  }
}
