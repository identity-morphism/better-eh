import { DEFAULT_KEYMAP, KEY_ACTIONS } from "./keymap-schema";
import { getSettings, updateSetting } from "./settings";
import type { BooleanKey } from "./settings-schema";
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

export function registerMenuCommands(): void {
  for (const { key, command, toast } of TOGGLE_COMMANDS) {
    GM_registerMenuCommand(command, () => {
      const next = !getSettings()[key];
      updateSetting(key, next);
      showToast(toast(next));
    });
  }

  GM_registerMenuCommand("Reset keymap to defaults", () => {
    if (confirm(`Reset all keys to defaults?\n\n${defaultKeySummary()}`)) {
      updateSetting("keymap", DEFAULT_KEYMAP);
      showToast("Keymap reset to defaults");
    }
  });
}
