import { postForm } from "../net/http";
import type { UconfigField, UconfigSection } from "../parse/uconfig";
import { categorySwitchShown, categorySwitchValue, uconfigBody } from "../parse/uconfig";
import type { Child } from "../ui/dom";
import { el } from "../ui/dom";
import { errorText } from "../ui/error-text";
import { createCheckbox, createChoice, createSelect } from "../ui/form-controls";
import type { CheckedControl } from "../ui/form-controls";
import { trackJumpRow } from "../ui/jump-row";
import { listHeader } from "../ui/list-header";
import { createSettingsDraft } from "../ui/settings-draft";
import type { DraftBinding } from "../ui/settings-draft";
import { renderUserscriptSettings, USERSCRIPT_SETTINGS_SECTION_ID } from "../ui/settings-panel";
import { showToast } from "../ui/toast";
import { siteNav } from "../ui/topbar";
import type { ViewContext } from "./context";

type Save = (body: URLSearchParams, signal?: AbortSignal) => Promise<void>;

/** The site's settings form: a form POST to `/uconfig.php` with the current session's cookie. */
const saveSiteSettings: Save = async (body, signal) => {
  await postForm(`${location.origin}/uconfig.php`, body, {
    tag: "uconfig-save",
    failure: "Saving settings failed",
    signal,
  });
};

/** Injectable side effects; the production defaults post to the site. */
interface SettingsDeps {
  save?: Save;
}

function humanize(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words === "" ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

function sectionIds(sections: readonly UconfigSection[]): string[] {
  const used = new Set<string>();
  return sections.map((section, index) => {
    const anchor = section.anchor.replace(/[^\w-]+/g, "-");
    const base = anchor === "" ? `settings-section-${index}` : `settings-${anchor}`;
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) {
      id = `${base}-${suffix}`;
    }
    used.add(id);
    return id;
  });
}

function fieldId(sectionIndex: number, fieldIndex: number): string {
  return `setting-${sectionIndex}-${fieldIndex}`;
}

function labeledField(
  field: UconfigField,
  id: string,
  control: HTMLElement,
  sectionTitle: string,
): HTMLElement {
  const label = field.label ?? (sectionTitle !== "" ? sectionTitle : humanize(field.name));
  const hint = field.prompt !== "" && field.prompt !== label ? field.prompt : "";
  return el(
    "div",
    { class: "settings-field" },
    el("label", { class: "eyebrow", for: id, text: label }),
    control,
    hint === "" ? null : el("p", { class: "settings-hint", text: hint }),
  );
}

function radioGroup(
  field: UconfigField,
  id: string,
  bindings: DraftBinding<string>[],
): HTMLElement {
  const choices: CheckedControl[] = [];
  const options = field.options.map((option, index) => {
    const inputId = `${id}-${index}`;
    const choice = createChoice({
      type: "radio",
      id: inputId,
      name: field.name,
      value: option.value,
      checked: option.value === field.value,
      disabled: option.disabled,
    });
    choices.push(choice);
    return el(
      "label",
      { class: "settings-row", for: inputId },
      choice.element,
      el("span", { text: option.label }),
    );
  });

  bindings.push({
    key: field.name,
    read: () => choices.find((choice) => choice.readChecked())?.element.value ?? "",
    write: (value) => {
      for (const choice of choices) {
        choice.writeChecked(choice.element.value === value);
      }
    },
  });

  return el(
    "fieldset",
    { class: "settings-group" },
    el("legend", { class: "settings-subhead", text: field.prompt || humanize(field.name) }),
    el("div", { class: "settings-rows" }, ...options),
  );
}

function checkboxItem(
  field: UconfigField,
  id: string,
  bindings: DraftBinding<string>[],
): HTMLElement {
  const control = createCheckbox({
    id,
    name: field.name,
    value: field.value === "" ? "on" : field.value,
    checked: field.value !== "",
    disabled: field.disabled,
  });
  bindings.push({
    key: field.name,
    read: control.readValue,
    write: control.writeValue,
  });
  return el(
    "div",
    { class: "settings-row" },
    control.element,
    el("label", { for: id, text: field.label ?? humanize(field.name) }),
  );
}

function checkboxGroup(
  group: readonly { field: UconfigField; index: number }[],
  sectionIndex: number,
  bindings: DraftBinding<string>[],
): HTMLElement {
  const items = group.map(({ field, index }) =>
    checkboxItem(field, fieldId(sectionIndex, index), bindings),
  );
  const prompt = group[0]?.field.prompt ?? "";
  if (prompt === "") {
    return el("div", { class: "settings-rows" }, ...items);
  }
  return el(
    "fieldset",
    { class: "settings-group" },
    el("legend", { class: "settings-subhead", text: prompt }),
    el("div", { class: "settings-rows" }, ...items),
  );
}

function selectField(
  field: UconfigField,
  id: string,
  bindings: DraftBinding<string>[],
  sectionTitle: string,
): HTMLElement {
  const control = createSelect({
    class: "field-select",
    id,
    name: field.name,
    disabled: field.disabled,
    value: field.value,
    options: field.options.map((option) => ({
      value: option.value,
      label: option.label,
      disabled: option.disabled,
    })),
  });
  bindings.push({
    key: field.name,
    read: control.read,
    write: control.write,
  });
  return labeledField(field, id, control.element, sectionTitle);
}

function textField(
  field: UconfigField,
  id: string,
  bindings: DraftBinding<string>[],
  sectionTitle: string,
): HTMLElement {
  const input = el("input", {
    class: "field-input",
    type: "text",
    id,
    name: field.name,
    value: field.value,
    // Numeric settings (max image size, page limits) otherwise open the alphabetic keyboard.
    inputmode: /^\d+$/u.test(field.value.trim()) ? "numeric" : null,
    autocomplete: "off",
    disabled: field.disabled ? "" : null,
  });
  bindings.push({
    key: field.name,
    read: () => input.value,
    write: (value) => {
      input.value = value;
    },
  });
  return labeledField(field, id, input, sectionTitle);
}

function textareaField(
  field: UconfigField,
  id: string,
  bindings: DraftBinding<string>[],
  sectionTitle: string,
): HTMLElement {
  const textarea = el("textarea", {
    class: "field-input settings-textarea",
    id,
    name: field.name,
    rows: 4,
    disabled: field.disabled ? "" : null,
  });
  textarea.value = field.value;
  bindings.push({
    key: field.name,
    read: () => textarea.value,
    write: (value) => {
      textarea.value = value;
    },
  });
  return labeledField(field, id, textarea, sectionTitle);
}

function hiddenField(field: UconfigField, bindings: DraftBinding<string>[]): HTMLInputElement {
  const input = el("input", { type: "hidden", name: field.name, value: field.value });
  bindings.push({
    key: field.name,
    read: () => input.value,
    write: (value) => {
      input.value = value;
    },
  });
  return input;
}

function renderField(
  field: UconfigField,
  sectionIndex: number,
  fieldIndex: number,
  bindings: DraftBinding<string>[],
  sectionTitle: string,
): HTMLElement {
  const id = fieldId(sectionIndex, fieldIndex);
  switch (field.kind) {
    case "radio":
      return radioGroup(field, id, bindings);
    case "checkbox":
      return checkboxItem(field, id, bindings);
    case "select":
      return selectField(field, id, bindings, sectionTitle);
    case "text":
      return textField(field, id, bindings, sectionTitle);
    case "textarea":
      return textareaField(field, id, bindings, sectionTitle);
    case "hidden":
      return hiddenField(field, bindings);
  }
}

/**
 * Default front-page/search categories.
 *
 * The site keeps each switch in a hidden `ct_*` input (`0` shown, `1` excluded) and toggles it from
 * a coloured chip. Rendering only the hidden inputs would make the setting unchangeable, so each
 * chip owns the hidden input through its draft binding: a click writes the next value through the
 * binding, repaints the chip and lets the event notify the shared draft.
 */
function categoryChips(
  entries: readonly { field: UconfigField; index: number }[],
  sectionIndex: number,
  bindings: DraftBinding<string>[],
): HTMLElement {
  const row = el("div", { class: "settings-cat-chips" });
  for (const { field } of entries) {
    const category = field.category;
    if (!category) {
      continue;
    }
    const input = el("input", { type: "hidden", name: field.name, value: field.value });
    const chip = el("button", {
      class: `cat-chip ${category.cls}`,
      type: "button",
      text: category.name,
      title: "Show this category by default",
    });
    const paint = (): void => {
      const shown = categorySwitchShown(input.value);
      chip.setAttribute("aria-pressed", shown ? "true" : "false");
      chip.classList.toggle("is-off", !shown);
    };
    const binding: DraftBinding<string> = {
      key: field.name,
      read: () => input.value,
      write: (value) => {
        input.value = value;
        paint();
      },
    };
    binding.write(field.value);
    chip.addEventListener("click", () => {
      binding.write(categorySwitchValue(!categorySwitchShown(input.value)));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    row.append(input, chip);
    bindings.push(binding);
  }
  return el(
    "div",
    { class: "settings-field", id: `setting-${sectionIndex}-categories` },
    el("span", { class: "eyebrow", text: "Default categories" }),
    row,
  );
}

/** Checkboxes that share a prompt form one option group (the language matrix, for example). */
function renderSection(
  section: UconfigSection,
  sectionIndex: number,
  id: string,
  bindings: DraftBinding<string>[],
): HTMLElement {
  const children: Child[] = [];
  const categoryEntries = section.fields
    .map((field, fieldIndex) => ({ field, index: fieldIndex }))
    .filter(({ field }) => field.category !== null);
  const categoryIndexes = new Set(categoryEntries.map(({ index }) => index));
  if (categoryEntries.length > 0) {
    children.push(categoryChips(categoryEntries, sectionIndex, bindings));
  }
  let index = 0;

  while (index < section.fields.length) {
    const field = section.fields[index];
    if (!field) {
      index++;
      continue;
    }
    if (categoryIndexes.has(index)) {
      index++;
      continue;
    }
    if (field.kind !== "checkbox") {
      children.push(renderField(field, sectionIndex, index, bindings, section.title));
      index++;
      continue;
    }

    const group: { field: UconfigField; index: number }[] = [{ field, index }];
    let next = index + 1;
    while (next < section.fields.length) {
      const candidate = section.fields[next];
      if (candidate?.kind !== "checkbox" || candidate.prompt !== field.prompt) {
        break;
      }
      group.push({ field: candidate, index: next });
      next++;
    }
    children.push(
      group.length === 1 && field.prompt === ""
        ? renderField(field, sectionIndex, index, bindings, section.title)
        : checkboxGroup(group, sectionIndex, bindings),
    );
    index = next;
  }

  return el(
    "section",
    { class: "settings-section", id, "aria-labelledby": `${id}-title` },
    el("h2", { class: "settings-title", id: `${id}-title`, text: section.title }),
    ...children,
  );
}

/**
 * Render the site settings form with a section jump nav and a sticky Apply/Reset bar.
 *
 * Apply posts the full form body but marks only the controls the user changed as overrides, so
 * untouched settings round-trip byte-for-byte. While the request is in flight the button is
 * disabled and reads "Saving…"; a failure leaves the user's edits in place and shows the message
 * inline, while success moves the Reset baseline to the saved state.
 */
export function renderSettings(
  host: HTMLElement,
  sections: readonly UconfigSection[],
  ctx: ViewContext,
  deps?: SettingsDeps,
): void {
  host.replaceChildren();

  const ids = sectionIds(sections);
  const uconfigBindings: DraftBinding<string>[] = [];
  const sectionNodes: HTMLElement[] = [];
  const jumpLinks: HTMLElement[] = [];
  let markCurrent: ((index: number) => void) | null = null;

  const panel = renderUserscriptSettings({ onChange: () => syncDirty() });

  // Scroll explicitly: native hash jumps are unreliable inside the app shell, and a plain `#hash`
  // would also add a history entry per section.
  const jumpLink = (id: string, title: string, index: number): HTMLElement => {
    const link = el("a", { class: "settings-jump-link", href: `#${id}`, text: title });
    link.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        document.getElementById(id)?.scrollIntoView({ block: "start" });
        history.replaceState(history.state, "", `#${id}`);
        markCurrent?.(index);
      },
      { signal: ctx.signal },
    );
    return link;
  };

  sections.forEach((section, index) => {
    const id = ids[index] ?? `settings-section-${index}`;
    sectionNodes.push(renderSection(section, index, id, uconfigBindings));
    jumpLinks.push(jumpLink(id, section.title, index));
  });
  sectionNodes.push(panel.element);
  jumpLinks.push(jumpLink(USERSCRIPT_SETTINGS_SECTION_ID, "Better EH", sections.length));

  const errorNode = el("p", { class: "settings-error", role: "alert", hidden: "" });
  const apply = el("button", {
    class: "btn btn-primary settings-apply",
    type: "button",
    text: "Apply",
  });
  const reset = el("button", {
    class: "btn btn-ghost settings-reset",
    type: "button",
    text: "Reset",
  });
  const dirtyLabel = el("span", {
    class: "settings-dirty",
    role: "status",
    text: "Unsaved changes",
    hidden: "",
  });
  const actions = el(
    "div",
    { class: "settings-actions", role: "group", "aria-label": "Settings actions" },
    errorNode,
    dirtyLabel,
    el("div", { class: "settings-action-buttons" }, reset, apply),
  );

  const jump = el(
    "nav",
    { class: "settings-jump", "aria-label": "Settings sections" },
    ...jumpLinks,
  );

  host.append(
    siteNav(ctx.signal),
    listHeader({
      title: "Settings",
      summary: [
        el("a", {
          class: "settings-native",
          href: "/uconfig.php?eh_native=1",
          "data-native": "",
          text: "Native settings",
          title: "Open the site's own settings page (display-name profiles, category switches)",
        }),
      ],
    }),
    el("div", { class: "settings-page" }, jump, ...sectionNodes, actions),
  );

  markCurrent = trackJumpRow({ row: jump, links: jumpLinks, sections: sectionNodes }, ctx.signal);

  const save: Save = deps?.save ?? saveSiteSettings;
  // One draft over both halves: the panel's bindings and the site's uconfig fields share a
  // baseline, so Reset and the dirty answer cannot disagree.
  const draft = createSettingsDraft({
    bindings: [...uconfigBindings, ...panel.bindings],
    onChange: () => syncDirty(),
  });
  const uconfigKeys = new Set(uconfigBindings.map((binding) => binding.key));
  let saving = false;
  let dirty = false;

  const clearError = (): void => {
    errorNode.textContent = "";
    errorNode.setAttribute("hidden", "");
  };

  const showError = (message: string): void => {
    errorNode.textContent = message;
    errorNode.removeAttribute("hidden");
  };

  /** Reflect the shared draft in the sticky bar. */
  function syncDirty(): void {
    dirty = draft.isDirty();
    apply.disabled = !dirty || saving;
    reset.disabled = !dirty || saving;
    dirtyLabel.hidden = !dirty;
  }

  const submit = async (): Promise<void> => {
    if (saving) {
      return;
    }

    // The diff decides whether there is anything to post; the button state is only a hint.
    const changed = draft.changed();
    const overrides = new Map<string, string>();
    for (const [key, value] of changed) {
      if (uconfigKeys.has(key)) {
        overrides.set(key, String(value));
      }
    }
    const settingsChanged = panel.bindings.some((binding) => changed.has(binding.key));
    if (overrides.size === 0 && !settingsChanged) {
      syncDirty();
      return;
    }

    saving = true;
    clearError();
    apply.disabled = true;
    reset.disabled = true;
    apply.textContent = "Saving…";

    try {
      if (overrides.size > 0) {
        await save(uconfigBody(sections, overrides), ctx.signal);
        if (ctx.signal.aborted) {
          return;
        }
      }
      if (settingsChanged) {
        panel.apply();
      }
      // The one rebase: success makes both halves' current values the new Reset baseline.
      draft.rebase();
      showToast("Settings saved");
    } catch (cause) {
      if (!ctx.signal.aborted) {
        showError(errorText(cause, "Saving settings failed."));
      }
    } finally {
      saving = false;
      apply.textContent = "Apply";
      syncDirty();
    }
  };

  apply.addEventListener(
    "click",
    () => {
      void submit();
    },
    { signal: ctx.signal },
  );

  reset.addEventListener(
    "click",
    () => {
      clearError();
      draft.reset();
    },
    { signal: ctx.signal },
  );

  for (const type of ["input", "change"] as const) {
    host.addEventListener(type, syncDirty, { signal: ctx.signal });
  }

  // Losing a long edit to a stray click on a tab is the expensive failure here.
  ctx.setLeaveGuard(() => !dirty || confirm("Discard unsaved changes to your settings?"));
  window.addEventListener(
    "beforeunload",
    (event) => {
      if (!dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    },
    { signal: ctx.signal },
  );
  ctx.signal.addEventListener("abort", () => ctx.setLeaveGuard(null), { once: true });

  syncDirty();
}
