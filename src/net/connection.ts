/**
 * The browser's data-saving hints.
 *
 * The Network Information API is not in the DOM lib and is absent in some engines. The app only
 * needs the two fields that say "the connection is metered": Save-Data and a 2G-class effective
 * type. The user's mode can force the gate on or off.
 */

import type { DataSaverMode } from "../types";

interface NetworkConnection {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

/** True when the browser or the network asks for less data. */
export function browserSavesData(nav: unknown = globalThis.navigator): boolean {
  const connection = (nav as { readonly connection?: NetworkConnection } | undefined)?.connection;
  return (
    connection?.saveData === true ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g"
  );
}

/** Apply the user's mode over the browser hint. */
export function shouldSaveData(mode: DataSaverMode, nav: unknown = globalThis.navigator): boolean {
  if (mode === "on") {
    return true;
  }
  if (mode === "off") {
    return false;
  }
  return browserSavesData(nav);
}
