import type { KeyAction } from "./keymap-schema";
import { getSettings } from "./settings";

export function isKey(e: KeyboardEvent, action: KeyAction): boolean {
  // Ctrl, Meta and Alt belong to the browser or an app shortcut. Shift is not checked because
  // `KeyboardEvent.key` already reports the shifted symbol (`?`) or letter (`D`).
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return false;
  }
  const key = e.key === " " ? " " : e.key.toUpperCase();
  return getSettings().keymap[action].includes(key);
}
