import { getSettings } from "./settings";

/** Prefix shared by every console line the script writes. */
export const LOG_TAG = "[Better EH]";

export function log(...args: unknown[]): void {
  if (getSettings().debug) {
    console.log(LOG_TAG, ...args);
  }
}

export function warn(...args: unknown[]): void {
  if (getSettings().debug) {
    console.warn(LOG_TAG, ...args);
  }
}
