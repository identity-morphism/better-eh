import { beforeEach, describe, expect, test } from "bun:test";

import { parseUconfig } from "../../src/parse/uconfig";
import { DEFAULT_SETTINGS, getSettings, updateSettings } from "../../src/settings";
import { renderSettings } from "../../src/views/settings";
import { loadFixture } from "../dom";
import { flushMicrotasks } from "./async";
import { installDom, mountHost, viewContext } from "./dom";

const data = parseUconfig(await loadFixture("uconfig.html"));

type Save = (body: URLSearchParams, signal?: AbortSignal) => Promise<void>;

/** Real edits emit input/change; the view uses them to track its dirty state. */
function touch(): void {
  host.dispatchEvent(new Event("input", { bubbles: true }));
}

let host: HTMLElement;

beforeEach(() => {
  installDom();
  updateSettings(DEFAULT_SETTINGS);
  host = mountHost();
});

function userscript(id: string): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(`#settings-userscript-${id}`);
  if (!found) {
    throw new Error(`missing userscript control: ${id}`);
  }
  return found;
}

function input(name: string): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!found) {
    throw new Error(`missing input: ${name}`);
  }
  return found;
}

function button(selector: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(selector);
  if (!found) {
    throw new Error(`missing button: ${selector}`);
  }
  return found;
}

function radio(name: string, value: string): HTMLInputElement {
  const found = [
    ...host.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`),
  ].find((candidate) => candidate.value === value);
  if (!found) {
    throw new Error(`missing radio: ${name}=${value}`);
  }
  return found;
}

function option(select: HTMLSelectElement, index: number): HTMLOptionElement {
  const found = select.options[index];
  if (!found) {
    throw new Error(`missing option: ${index}`);
  }
  return found;
}

describe("renderSettings", () => {
  test("renders one section per model section with a jump nav", () => {
    renderSettings(host, data, viewContext());

    const rendered = [...host.querySelectorAll<HTMLElement>("section.settings-section")];
    expect(rendered.map((section) => section.querySelector("h2")?.textContent)).toEqual([
      ...data.map((section) => section.title),
      "Better EH",
    ]);

    const links = [...host.querySelectorAll<HTMLAnchorElement>(".settings-jump a")];
    expect(links.map((link) => link.textContent)).toEqual([
      ...data.map((section) => section.title),
      "Better EH",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      rendered.map((section) => `#${section.id}`),
    );
  });

  test("renders radio groups as labelled fieldsets and keeps disabled options", () => {
    renderSettings(host, data, viewContext());

    const first = radio("uh", "0");
    expect(first.getAttribute("checked")).toBe("");

    const group = first.closest("fieldset");
    expect(group?.querySelector("legend")?.textContent).toBe("Load images through H@H?");
    expect(group?.querySelectorAll('input[type="radio"][name="uh"]')).toHaveLength(3);
    expect(radio("uh", "2").hasAttribute("disabled")).toBe(true);
  });

  test("wires labels to standalone controls and renders hidden inputs", () => {
    renderSettings(host, data, viewContext());

    const rx = input("rx");
    expect(host.querySelector(`label[for="${rx.id}"]`)?.textContent).toBe("Horizontal");

    const co = host.querySelector<HTMLSelectElement>('select[name="co"]');
    if (!co) {
      throw new Error("missing select");
    }
    expect(host.querySelector(`label[for="${co.id}"]`)?.textContent).toBe("H@H Region");
    expect([...co.options].map((item) => item.textContent)).toEqual(["Auto", "Europe", "NA"]);

    expect(host.querySelectorAll('input[type="hidden"][name^="ct_"]')).toHaveLength(3);
    expect(host.querySelector('input[name="profile_name"]')).toBeNull();
  });

  test("links to the site's own settings page for the controls we do not own", () => {
    renderSettings(host, data, viewContext());

    const link = host.querySelector<HTMLAnchorElement>(".settings-native");
    expect(link?.getAttribute("href")).toBe("/uconfig.php?eh_native=1");
    expect(link?.getAttribute("data-native")).toBe("");
  });

  test("default categories are chips that drive the hidden ct_* switches", () => {
    renderSettings(host, data, viewContext());

    const chips = [...host.querySelectorAll<HTMLButtonElement>(".settings-cat-chips .cat-chip")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["Doujinshi", "Misc", "Game CG"]);

    const doujinshi = chips[0];
    const misc = chips[1];
    if (!doujinshi || !misc) {
      throw new Error("missing category chips");
    }
    expect(doujinshi.getAttribute("aria-pressed")).toBe("true");
    expect(misc.getAttribute("aria-pressed")).toBe("false");

    doujinshi.click();
    expect(input("ct_doujinshi").value).toBe("1");
    expect(doujinshi.getAttribute("aria-pressed")).toBe("false");

    misc.click();
    expect(input("ct_misc").value).toBe("0");
    expect(misc.getAttribute("aria-pressed")).toBe("true");
  });

  test("groups checkboxes that share a prompt under one legend", () => {
    renderSettings(host, data, viewContext());

    const group = input("xn_0").closest("fieldset");
    expect(group?.querySelector("legend")?.textContent).toBe("Historic UI elements.");
    expect(group?.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  test("Apply posts one body with only the changed values overridden", async () => {
    const calls: URLSearchParams[] = [];
    const save: Save = (body) => {
      calls.push(body);
      return Promise.resolve();
    };

    renderSettings(host, data, viewContext(), { save });
    input("rx").value = "640";
    radio("uh", "1").checked = true;
    radio("uh", "0").checked = false;
    touch();
    button(".settings-apply").click();
    await flushMicrotasks(8);

    expect(calls).toHaveLength(1);
    const body = calls[0];
    if (!body) {
      throw new Error("missing posted body");
    }

    expect(body.getAll("uh")).toEqual(["1"]);
    expect(body.get("rx")).toBe("640");
    expect(body.get("xu")).toBe("one two");
    expect(body.get("xn_0")).toBe("on");
    expect(body.has("xn_1")).toBe(false);
    expect(body.get("apply")).toBe("Apply");

    // Nothing left to post, so the button returns to its clean state.
    expect(button(".settings-apply").disabled).toBe(true);
    expect(button(".settings-apply").textContent).toBe("Apply");
  });

  test("disables Apply while saving and restores the label afterwards", async () => {
    const { promise: pending, resolve: release } = Promise.withResolvers<void>();
    const save: Save = () => pending;

    renderSettings(host, data, viewContext(), { save });
    const apply = button(".settings-apply");
    input("rx").value = "320";
    touch();
    apply.click();
    await flushMicrotasks(8);

    expect(apply.disabled).toBe(true);
    expect(apply.textContent).toBe("Saving…");
    expect(button(".settings-reset").disabled).toBe(true);

    release();
    await flushMicrotasks(8);

    expect(apply.textContent).toBe("Apply");
    // The save made the form clean again, so both buttons retire until the next edit.
    expect(apply.disabled).toBe(true);
    expect(button(".settings-reset").disabled).toBe(true);

    input("rx").value = "480";
    touch();
    expect(apply.disabled).toBe(false);
  });

  test("shows a failure inline, keeps the edits and re-enables Apply", async () => {
    const save: Save = () => Promise.reject(new Error("network down"));

    renderSettings(host, data, viewContext(), { save });
    input("rx").value = "800";
    touch();
    button(".settings-apply").click();
    await flushMicrotasks(8);

    expect(input("rx").value).toBe("800");
    // The edits survived, so the form is still dirty and Apply is available.
    expect(button(".settings-apply").disabled).toBe(false);

    const error = host.querySelector<HTMLElement>(".settings-error");
    expect(error?.hasAttribute("hidden")).toBe(false);
    expect(error?.textContent).toBe("network down");
  });

  test("Reset restores the parsed values", () => {
    renderSettings(host, data, viewContext());

    input("rx").value = "640";
    radio("uh", "1").checked = true;
    radio("uh", "0").checked = false;
    input("xn_0").checked = false;

    const co = host.querySelector<HTMLSelectElement>('select[name="co"]');
    if (!co) {
      throw new Error("missing select");
    }
    option(co, 1).selected = true;
    touch();

    button(".settings-reset").click();

    expect(input("rx").value).toBe("0");
    expect(radio("uh", "0").checked).toBe(true);
    expect(radio("uh", "1").checked).toBe(false);
    expect(input("xn_0").checked).toBe(true);
    expect(option(co, 0).selected).toBe(true);
    expect(option(co, 1).selected).toBe(false);
  });

  test("a successful save moves the Reset baseline to the saved values", async () => {
    const save: Save = () => Promise.resolve();

    renderSettings(host, data, viewContext(), { save });
    input("rx").value = "640";
    touch();
    button(".settings-apply").click();
    await flushMicrotasks(8);

    input("rx").value = "900";
    touch();
    button(".settings-reset").click();

    expect(input("rx").value).toBe("640");
  });

  test("Apply saves userscript settings without posting the site form", async () => {
    const calls: URLSearchParams[] = [];
    const save: Save = (body) => {
      calls.push(body);
      return Promise.resolve();
    };

    renderSettings(host, data, viewContext(), { save });
    userscript("scrollStep").value = "300";
    userscript("debug").checked = true;
    touch();

    expect(button(".settings-apply").disabled).toBe(false);
    button(".settings-apply").click();
    await flushMicrotasks(8);

    expect(calls).toHaveLength(0);
    expect(getSettings().scrollStep).toBe(300);
    expect(getSettings().debug).toBe(true);
    // Applied values are the new baseline, so the form is clean.
    expect(button(".settings-apply").disabled).toBe(true);
    expect(host.querySelector<HTMLElement>(".settings-dirty")?.hasAttribute("hidden")).toBe(true);
  });

  test("a failed site save leaves userscript edits unsaved and visible", async () => {
    const save: Save = () => Promise.reject(new Error("network down"));

    renderSettings(host, data, viewContext(), { save });
    input("rx").value = "640";
    userscript("scrollStep").value = "300";
    touch();
    button(".settings-apply").click();
    await flushMicrotasks(8);

    expect(getSettings().scrollStep).toBe(DEFAULT_SETTINGS.scrollStep);
    expect(userscript("scrollStep").value).toBe("300");
    expect(button(".settings-apply").disabled).toBe(false);
    expect(host.querySelector<HTMLElement>(".settings-error")?.textContent).toBe("network down");
  });

  test("a successful save applies both halves and rebases both resets", async () => {
    const save: Save = () => Promise.resolve();

    renderSettings(host, data, viewContext(), { save });
    input("rx").value = "640";
    userscript("gap").value = "24";
    touch();
    button(".settings-apply").click();
    await flushMicrotasks(8);

    expect(getSettings().gap).toBe(24);

    // The next Reset returns to the values that were just saved.
    userscript("gap").value = "40";
    input("rx").value = "900";
    touch();
    button(".settings-reset").click();

    expect(userscript("gap").value).toBe("24");
    expect(input("rx").value).toBe("640");
    expect(button(".settings-apply").disabled).toBe(true);
  });

  test("Reset restores userscript controls to the rendered values", () => {
    renderSettings(host, data, viewContext());

    userscript("gap").value = "40";
    userscript("fitHeight").checked = false;
    touch();
    button(".settings-reset").click();

    expect(userscript("gap").value).toBe(String(DEFAULT_SETTINGS.gap));
    expect(userscript("fitHeight").checked).toBe(DEFAULT_SETTINGS.fitHeight);
    expect(button(".settings-apply").disabled).toBe(true);
  });

  test("a chip-only edit is dirty and posts the changed category switch", async () => {
    const calls: URLSearchParams[] = [];
    renderSettings(host, data, viewContext(), {
      save: (body) => {
        calls.push(body);
        return Promise.resolve();
      },
    });

    const chip = host.querySelector<HTMLButtonElement>(".settings-cat-chips .cat-chip");
    if (!chip) {
      throw new Error("missing category chip");
    }
    expect(button(".settings-apply").disabled).toBe(true);

    chip.click();

    expect(input("ct_doujinshi").value).toBe("1");
    expect(button(".settings-apply").disabled).toBe(false);
    expect(host.querySelector<HTMLElement>(".settings-dirty")?.hasAttribute("hidden")).toBe(false);

    button(".settings-apply").click();
    await flushMicrotasks(8);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.get("ct_doujinshi")).toBe("1");
    // The save rebased the chip, so the form is clean while the new value stays visible.
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(button(".settings-apply").disabled).toBe(true);
  });

  test("Reset restores the category chip's visual state", () => {
    renderSettings(host, data, viewContext());

    const chip = host.querySelector<HTMLButtonElement>(".settings-cat-chips .cat-chip");
    if (!chip) {
      throw new Error("missing category chip");
    }
    chip.click();
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(chip.classList.contains("is-off")).toBe(true);

    button(".settings-reset").click();

    expect(input("ct_doujinshi").value).toBe("0");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.classList.contains("is-off")).toBe(false);
    expect(button(".settings-apply").disabled).toBe(true);
  });

  test("a chip-only edit arms the leave guard", () => {
    let leaveGuard: (() => boolean) | null = null;
    renderSettings(host, data, {
      ...viewContext(),
      setLeaveGuard: (guard) => {
        leaveGuard = guard;
      },
    });
    const guard = (): (() => boolean) => {
      if (leaveGuard === null) {
        throw new Error("missing leave guard");
      }
      return leaveGuard;
    };

    const chip = host.querySelector<HTMLButtonElement>(".settings-cat-chips .cat-chip");
    if (!chip) {
      throw new Error("missing category chip");
    }
    expect(guard()()).toBe(true);

    const original = globalThis.confirm;
    globalThis.confirm = () => false;
    try {
      chip.click();
      expect(guard()()).toBe(false);
    } finally {
      globalThis.confirm = original;
    }
  });
});
