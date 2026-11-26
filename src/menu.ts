import { DEFAULT_KEYMAP, KEY_ACTIONS } from "./keymap-schema";
import { getSettings, updateSetting } from "./settings";
import type { BooleanKey } from "./settings-schema";
import { clearTagCountsCache, loadTagCounts } from "./tags/counts";
import { clearTagIndexCache, loadTagIndex } from "./tags/db";
import { errorText } from "./ui/error-text";
import { showToast } from "./ui/toast";

interface ToggleCommand {
  readonly key: BooleanKey;
  readonly command: string;
  /** The toast text after a toggle, given the new value. */
  readonly toast: (enabled: boolean) => string;
}

function enabledToast(label: string): (enabled: boolean) => string {
  return (enabled) => `${label} ${enabled ? "enabled" : "disabled"}`;
}

const TOGGLE_COMMANDS: readonly ToggleCommand[] = [
  {
    key: "fitHeight",
    command: "Toggle fit-height / natural-width",
    toast: (fitHeight) => `Default mode: ${fitHeight ? "fit-height" : "natural-width"}`,
  },
  { key: "debug", command: "Toggle debug mode", toast: enabledToast("Debug mode") },
  {
    key: "listInfiniteScroll",
    command: "Toggle infinite scroll (feed)",
    toast: enabledToast("Feed infinite scroll"),
  },
  {
    key: "galleryInfiniteScroll",
    command: "Toggle infinite scroll (gallery)",
    toast: enabledToast("Gallery infinite scroll"),
  },
  {
    key: "tagSuggestions",
    command: "Toggle tag suggestions",
    toast: enabledToast("Tag suggestions"),
  },
];

/** The reset prompt's summary, derived from the one action table. */
function defaultKeySummary(): string {
  return KEY_ACTIONS.map(
    ({ action, label }) => `${label}: ${DEFAULT_KEYMAP[action].join("/")}`,
  ).join(", ");
}

interface GreasemonkeyMenu {
  GM_registerMenuCommand?: (caption: string, command: () => void) => void;
}

/** Force both remote tag datasets to redownload, reporting the result once. */
async function refreshTagData(): Promise<void> {
  clearTagIndexCache();
  clearTagCountsCache();
  try {
    await loadTagCounts(true);
    await loadTagIndex(true);
    showToast("Tag data refreshed");
  } catch (error) {
    showToast(errorText(error, "Could not refresh tag data."));
  }
}

/**
 * Add the quick toggles to the manager's script menu.
 *
 * The menu is optional in practice: a manager can grant the storage APIs but not the menu one.
 * Registering nothing keeps the app running instead of throwing after the shell has replaced the
 * site's page.
 */
export function registerMenuCommands(): void {
  const register = (globalThis as unknown as GreasemonkeyMenu).GM_registerMenuCommand;
  if (register === undefined) {
    return;
  }

  for (const { key, command, toast } of TOGGLE_COMMANDS) {
    register(command, () => {
      const next = !getSettings()[key];
      updateSetting(key, next);
      showToast(toast(next));
    });
  }

  register("Reset keymap to defaults", () => {
    if (confirm(`Reset all keys to defaults?\n\n${defaultKeySummary()}`)) {
      updateSetting("keymap", DEFAULT_KEYMAP);
      showToast("Keymap reset to defaults");
    }
  });

  register("Refresh tag data now", () => {
    void refreshTagData();
  });

  register("Clear cached tag data", () => {
    clearTagIndexCache();
    clearTagCountsCache();
    showToast("Cached tag data cleared");
  });
}
