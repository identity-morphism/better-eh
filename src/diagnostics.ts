import { recentEvents } from "./log";
import { getSettings } from "./settings";
import { SCALAR_KEYS } from "./settings-schema";

interface ScriptManagerInfo {
  GM_info?: { script?: { version?: string } };
}

/** The manager's `@version`, or a marker for a development bundle. */
export function scriptVersion(): string {
  const info = (globalThis as unknown as ScriptManagerInfo).GM_info;
  return info?.script?.version ?? "unknown";
}

/**
 * A pasteable report: version, route, browser, every scalar setting (never the keymap), and the
 * bounded log tail. Nothing here reads cookies, tokens or page content.
 */
export function diagnosticReport(): string {
  const settings = getSettings();
  const scalars = Object.fromEntries(SCALAR_KEYS.map((key) => [key, settings[key]]));
  const href = typeof location === "undefined" ? "unknown" : location.href;
  const userAgent = typeof navigator === "undefined" ? "unknown" : navigator.userAgent;
  const lines = [
    `Better EH ${scriptVersion()}`,
    `URL: ${href}`,
    `User agent: ${userAgent}`,
    `Keymap actions: ${Object.keys(settings.keymap).length}`,
    "Settings:",
    JSON.stringify(scalars, null, 2),
    "",
    "Recent events:",
  ];
  const events = recentEvents();
  if (events.length === 0) {
    lines.push("(none)");
  } else {
    for (const event of events) {
      lines.push(`[${event.at}] ${event.level}: ${event.message}`);
    }
  }
  return lines.join("\n");
}
