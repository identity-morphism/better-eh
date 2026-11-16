import type { KeyAction } from "./keymap-schema";
import { getSettings } from "./settings";

export function isKey(e: KeyboardEvent, action: KeyAction): boolean {
  // A modified key belongs to the browser or an app shortcut, never to page navigation.
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
    return false;
  }
  return getSettings().keymap[action].includes(e.key.toUpperCase());
}
