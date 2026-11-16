import { beforeEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_SETTINGS,
  getSettings,
  onSettingsChange,
  updateSettings,
} from "../../src/settings";
import { NUMBER_FIELDS, SCALAR_KEYS } from "../../src/settings-schema";
import {
  parseSettingsJson,
  renderUserscriptSettings,
  serializeSettings,
} from "../../src/ui/settings-panel";
import { flushMicrotasks } from "./async";
import { installDom, mountHost } from "./dom";

let root: HTMLElement;

beforeEach(() => {
  installDom();
  updateSettings(DEFAULT_SETTINGS);
  root = mountHost();
});

function render(deps?: Parameters<typeof renderUserscriptSettings>[0]) {
  const panel = renderUserscriptSettings(deps);
  root.append(panel.element);
  return panel;
}

function control<T extends HTMLElement>(id: string): T {
  const found = root.querySelector<T>(`#${id}`);
  if (!found) {
    throw new Error(`missing control: ${id}`);
  }
  return found;
}

function capture(action: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(`[data-capture="${action}"]`);
  if (!found) {
    throw new Error(`missing capture button: ${action}`);
  }
  return found;
}

function choose(id: string, value: string): void {
  const select = control<HTMLSelectElement>(id);
  const option = [...select.options].find((candidate) => candidate.value === value);
  if (!option) {
    throw new Error(`missing option: ${id}=${value}`);
  }
  option.selected = true;
  option.setAttribute("selected", "");
}

function press(button: HTMLButtonElement, key: string): void {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  button.dispatchEvent(event);
}

function importFile(json: string): void {
  const input = root.querySelector<HTMLInputElement>(".settings-file-input");
  if (!input) {
    throw new Error("missing file input");
  }
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [{ text: () => Promise.resolve(json) }],
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function status(): string {
  return root.querySelector(".settings-backup-status")?.textContent ?? "";
}

describe("renderUserscriptSettings", () => {
  test("renders a control for every setting from the saved values", () => {
    updateSettings({
      ...DEFAULT_SETTINGS,
      scrollStep: 300,
      fitHeight: false,
      keymap: { ...DEFAULT_SETTINGS.keymap, next: ["N"] },
    });
    render();

    expect(control<HTMLInputElement>("settings-userscript-scrollStep").value).toBe("300");
    expect(control<HTMLInputElement>("settings-userscript-fitHeight").checked).toBe(false);
    expect(control<HTMLInputElement>("settings-userscript-tagSuggestions").checked).toBe(true);
    expect(control<HTMLInputElement>("settings-userscript-netTimeoutMs").value).toBe("15000");
    expect(
      control<HTMLSelectElement>("settings-userscript-readerMode")
        .querySelector("option[selected]")
        ?.getAttribute("value"),
    ).toBe("single");
    expect(
      control<HTMLSelectElement>("settings-userscript-readingDirection")
        .querySelector("option[selected]")
        ?.getAttribute("value"),
    ).toBe("ltr");
    expect(capture("next").closest(".settings-key-row")?.textContent).toContain("N");
  });

  test("renders exactly one control per schema scalar", () => {
    render();

    for (const key of SCALAR_KEYS) {
      expect(root.querySelectorAll(`#settings-userscript-${key}`)).toHaveLength(1);
    }
  });

  test("exposes one draft binding per control", () => {
    const panel = render();

    expect(panel.bindings.map((binding) => binding.key).sort()).toEqual(
      [...SCALAR_KEYS, "keymap"].sort(),
    );
  });

  test("draft bindings read and write the controls through the shared adapter", () => {
    const panel = render();
    const fit = panel.bindings.find((binding) => binding.key === "fitHeight");
    const mode = panel.bindings.find((binding) => binding.key === "readerMode");
    if (!fit || !mode) {
      throw new Error("missing draft bindings");
    }

    fit.write(false);
    expect(control<HTMLInputElement>("settings-userscript-fitHeight").checked).toBe(false);
    control<HTMLInputElement>("settings-userscript-fitHeight").checked = true;
    expect(fit.read()).toBe(true);

    mode.write("spread");
    expect(
      control<HTMLSelectElement>("settings-userscript-readerMode")
        .querySelector("option[selected]")
        ?.getAttribute("value"),
    ).toBe("spread");
    expect(mode.read()).toBe("spread");
  });

  test("number controls take their bounds from the schema", () => {
    render();

    for (const field of NUMBER_FIELDS) {
      const input = control<HTMLInputElement>(`settings-userscript-${field.key}`);
      expect(input.getAttribute("min")).toBe(String(field.min));
      expect(input.getAttribute("max")).toBe(String(field.max));
    }
  });

  test("an emptied number field keeps its baseline instead of clamping to the minimum", () => {
    const panel = render();

    control<HTMLInputElement>("settings-userscript-netConcurrency").value = "";
    panel.apply();

    expect(getSettings().netConcurrency).toBe(DEFAULT_SETTINGS.netConcurrency);
  });

  test("a modified capture is rejected instead of storing a dead key", () => {
    const panel = render();
    capture("next").click();

    const event = new Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "key", { value: "k" });
    Object.defineProperty(event, "ctrlKey", { value: true });
    capture("next").dispatchEvent(event);

    panel.apply();
    expect(getSettings().keymap.next).not.toContain("K");
    expect(root.querySelector(".settings-keymap-status")?.textContent).toContain("unmodified");
  });

  test("apply clamps an out-of-range number through the store", () => {
    const panel = render();

    control<HTMLInputElement>("settings-userscript-netConcurrency").value = "999";
    panel.apply();

    expect(getSettings().netConcurrency).toBe(8);
    expect(control<HTMLInputElement>("settings-userscript-netConcurrency").value).toBe("8");
  });

  test("apply persists the draft and notifies once", () => {
    const panel = render();
    const seen: number[] = [];
    const off = onSettingsChange((settings) => seen.push(settings.scrollStep));

    control<HTMLInputElement>("settings-userscript-fitHeight").checked = false;
    control<HTMLInputElement>("settings-userscript-scrollStep").value = "640";
    choose("settings-userscript-readerMode", "spread");
    choose("settings-userscript-readingDirection", "rtl");
    expect(panel.isDirty()).toBe(true);

    panel.apply();

    expect(getSettings().fitHeight).toBe(false);
    expect(getSettings().scrollStep).toBe(640);
    expect(getSettings().readerMode).toBe("spread");
    expect(getSettings().readingDirection).toBe("rtl");
    expect(seen).toEqual([640]);
    // The controls are normalized to the persisted values, so the form is clean again.
    expect(control<HTMLInputElement>("settings-userscript-scrollStep").value).toBe("640");
    off();
  });

  test("reset restores the rendered baseline without touching the store", () => {
    const panel = render();
    expect(panel.isDirty()).toBe(false);
    control<HTMLInputElement>("settings-userscript-debug").checked = true;
    control<HTMLInputElement>("settings-userscript-gap").value = "40";
    press(capture("next"), "N");

    panel.reset();

    expect(panel.isDirty()).toBe(false);
    expect(getSettings().debug).toBe(false);
    expect(getSettings().gap).toBe(DEFAULT_SETTINGS.gap);
    expect(getSettings().keymap.next).toEqual(DEFAULT_SETTINGS.keymap.next);
    expect(control<HTMLInputElement>("settings-userscript-debug").checked).toBe(false);
  });

  test("captures a key and moves a conflicting binding off its old action", () => {
    const panel = render();

    capture("next").click();
    expect(capture("next").textContent).toBe("Press a key…");
    press(capture("next"), "Z");

    panel.apply();
    expect(getSettings().keymap.next).toContain("Z");

    // D starts on "next"; binding it to "prev" must move it rather than duplicate it.
    capture("prev").click();
    press(capture("prev"), "D");

    panel.apply();
    expect(getSettings().keymap.prev).toContain("D");
    expect(getSettings().keymap.next).not.toContain("D");
    expect(root.querySelector(".settings-keymap-status")?.textContent).toContain("Moved D");
  });

  test("capture stops at the shared per-action limit", () => {
    const panel = render();
    for (const key of ["Z", "X", "C", "V"]) {
      capture("next").click();
      press(capture("next"), key);
    }

    capture("next").click();
    press(capture("next"), "B");

    expect(root.querySelector(".settings-keymap-status")?.textContent).toContain("Up to 6");
    panel.apply();
    expect(getSettings().keymap.next).not.toContain("B");
  });

  test("Escape cancels capture and Tab is not bound", () => {
    const panel = render();
    capture("next").click();
    press(capture("next"), "Tab");
    expect(capture("next").textContent).toBe("Press a key…");

    press(capture("next"), "Escape");
    expect(capture("next").textContent).toBe("Add key");
    panel.apply();
    expect(getSettings().keymap.next).toEqual(DEFAULT_SETTINGS.keymap.next);
  });

  test("reset keys edits the draft until apply", () => {
    const panel = render();
    press(capture("next"), "N");
    root.querySelector<HTMLButtonElement>(".settings-keymap-reset")?.click();

    panel.apply();
    expect(getSettings().keymap).toEqual(DEFAULT_SETTINGS.keymap);
  });

  test("export writes the current draft, including unsaved edits", () => {
    let name = "";
    let contents = "";
    render({
      exportFile: (filename, text) => {
        name = filename;
        contents = text;
      },
    });

    control<HTMLInputElement>("settings-userscript-scrollStep").value = "777";
    root.querySelector<HTMLButtonElement>(".settings-export")?.click();

    expect(name).toBe("better-eh-settings.json");
    const parsed = JSON.parse(contents) as { values: { scrollStep: number } };
    expect(parsed.values.scrollStep).toBe(777);
    expect(status()).toContain("Exported");
  });

  test("import fills the controls and waits for apply", async () => {
    const panel = render();
    importFile(
      JSON.stringify({
        values: { scrollStep: 333, fitHeight: false, keymap: { next: ["N", "N"] } },
      }),
    );
    await flushMicrotasks(8);

    expect(control<HTMLInputElement>("settings-userscript-scrollStep").value).toBe("333");
    expect(control<HTMLInputElement>("settings-userscript-fitHeight").checked).toBe(false);
    expect(getSettings().scrollStep).toBe(DEFAULT_SETTINGS.scrollStep);
    expect(status()).toContain("review");

    panel.apply();
    expect(getSettings().scrollStep).toBe(333);
    expect(getSettings().keymap.next).toEqual(["N"]);
    // Actions missing from the file keep their defaults.
    expect(getSettings().keymap.prev).toEqual(DEFAULT_SETTINGS.keymap.prev);
  });

  test("invalid imports are reported without changing the controls", async () => {
    render();
    importFile("{not json");
    await flushMicrotasks(8);

    expect(status()).toContain("not valid JSON");
    expect(root.querySelector(".settings-backup-status")?.classList.contains("is-error")).toBe(
      true,
    );
    expect(control<HTMLInputElement>("settings-userscript-scrollStep").value).toBe(
      String(DEFAULT_SETTINGS.scrollStep),
    );
  });
});

describe("parseSettingsJson", () => {
  test("accepts the exported envelope and clamps numbers to their ranges", () => {
    const result = parseSettingsJson(
      serializeSettings({ ...DEFAULT_SETTINGS, gap: 12, netConcurrency: 2 }),
    );
    expect(result.ok).toBe(true);

    const clamped = parseSettingsJson(JSON.stringify({ values: { gap: -4, scrollStep: 1e9 } }));
    if (!clamped.ok) {
      throw new Error(clamped.error);
    }
    expect(clamped.settings.gap).toBe(0);
    expect(clamped.settings.scrollStep).toBe(5000);
  });

  test("rejects wrong types and malformed keymaps", () => {
    expect(parseSettingsJson("[]")).toEqual({
      ok: false,
      error: "That file does not contain a settings object.",
    });
    expect(parseSettingsJson('{"debug":"yes"}')).toEqual({
      ok: false,
      error: '"debug" must be true or false.',
    });
    expect(parseSettingsJson('{"gap":"12"}')).toEqual({
      ok: false,
      error: '"gap" must be a number.',
    });
    expect(parseSettingsJson('{"readerMode":"strip"}')).toEqual({
      ok: false,
      error: '"readerMode" must be single, spread, or continuous.',
    });
    expect(parseSettingsJson('{"readingDirection":"up"}')).toEqual({
      ok: false,
      error: '"readingDirection" must be ltr or rtl.',
    });
    const badKeymap = parseSettingsJson('{"keymap":{"next":"D"}}');
    expect(badKeymap.ok).toBe(false);
    if (!badKeymap.ok) {
      expect(badKeymap.error).toContain("list of keys");
    }
    expect(parseSettingsJson('{"keymap":{"next":[1]}}').ok).toBe(false);
  });

  test("rejects a non-object values envelope instead of resetting every setting", () => {
    const result = parseSettingsJson('{"values":[]}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("values");
    }
  });

  test("rejects keys that can never match the runtime", () => {
    expect(parseSettingsJson('{"keymap":{"next":["Ctrl+K"]}}').ok).toBe(false);
    expect(parseSettingsJson('{"keymap":{"next":["Shift"]}}').ok).toBe(false);
  });

  test("rejects a key bound to two actions", () => {
    const result = parseSettingsJson('{"keymap":{"next":["X"],"prev":["X"]}}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("more than one action");
    }
  });

  test("moves an explicit key off another action's defaults", () => {
    const result = parseSettingsJson('{"keymap":{"prev":["D"]}}');
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.settings.keymap.prev).toEqual(["D"]);
    expect(result.settings.keymap.next).not.toContain("D");
  });

  test("rejects an action with more keys than the shared limit", () => {
    const result = parseSettingsJson('{"keymap":{"next":["1","2","3","4","5","6","7"]}}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("at most");
    }
  });
});
