/**
 * `/mytags`: the saved user tags with inline editing, plus the form that adds a new one.
 *
 * Writes go through {@link applyMyTag}; rows pass their parsed state so saving does not re-fetch the
 * page just to learn the tag id. Anonymous pages (`apiUid = -1`) and pages without credentials
 * render read-only with an escape hatch to the native page.
 */

import type { GalleryPost } from "../data/gallery-actions";
import type { MyTagChange, TagsetChange } from "../data/my-tags";
import { applyMyTag, normalizeWeight, saveTagset as saveTagsetRequest } from "../data/my-tags";
import type { DocumentOptions, HtmlResponse } from "../fetch/loader";
import { loader } from "../fetch/loader";
import type { ApiCredentials } from "../parse/gallery";
import { isChecked } from "../parse/helpers";
import type { MyTagsPage, TagsetState, UserTagState } from "../parse/my-tags";
import { normalizeColor } from "../parse/my-tags";
import { nativeUrl } from "../routes/identity";
import { el, searchInput, textInput } from "../ui/dom";
import { errorText } from "../ui/error-text";
import { listHeader } from "../ui/list-header";
import { countText } from "../ui/text";
import { showToast } from "../ui/toast";
import { siteNav } from "../ui/topbar";
import type { ViewContext } from "./context";

/** Save the selected tagset through the page's own form. */
export type SaveTagset = (
  tagset: TagsetState,
  change: TagsetChange,
  signal: AbortSignal,
) => Promise<void>;

/** Optional transports so tests can drive saves without the network. */
export interface MyTagsViewDeps {
  /** Fetch the page that holds the saved tag ids; defaults to the shared loader. */
  loadDocument?: (url: string, options: DocumentOptions) => Promise<HtmlResponse>;
  /** Transport for the `setusertag` JSON API. */
  post?: GalleryPost;
  /** Transport for the native add-form POST. */
  addTag?: (url: string, body: URLSearchParams, signal?: AbortSignal) => Promise<void>;
  /** Transport for the tagset form; defaults to the native form POST. */
  saveTagset?: SaveTagset;
}

/** The in-app address of one tagset, preserving the page's other query parameters. */
function tagsetHref(pageUrl: string, id: string): string {
  const target = new URL(pageUrl);
  target.searchParams.set("tagset", id);
  return target.href;
}

/**
 * The native tagset manager: every set as a switchable chip, then the selected set's name, enable
 * flag and default colour. The form posts its parsed fields back through the page, so a site field
 * the app does not understand survives the save.
 */
function tagsetPanel(
  data: MyTagsPage,
  tagset: TagsetState,
  editable: boolean,
  ctx: ViewContext,
  save: SaveTagset,
): HTMLElement {
  const choices = el(
    "div",
    { class: "my-tags-tagsets", role: "group", "aria-label": "Tag sets" },
    ...tagset.choices.map((choice) =>
      el("a", {
        class: "my-tags-tagset-link",
        href: tagsetHref(data.url, choice.id),
        "aria-current": choice.selected ? "page" : null,
        text: choice.label,
      }),
    ),
  );

  const name = textInput({
    class: "field-input my-tags-tagset-name",
    value: tagset.name,
    "aria-label": "Tag set name",
  });
  const enabled = el("input", {
    type: "checkbox",
    class: "my-tags-tagset-enable",
    checked: tagset.enabled ? "checked" : null,
  });
  const color = textInput({
    class: "field-input my-tags-tagset-color",
    value: tagset.color,
    placeholder: "#default",
    maxlength: "7",
    "aria-label": "Default colour for this tag set",
  });
  for (const control of [name, enabled, color]) {
    control.disabled = !editable;
  }

  const hasEnable = tagset.fields.some((field) => field.name === "tagset_enable");
  const error = el("p", { class: "my-tags-tagset-error", role: "alert" });
  error.hidden = true;
  const saveButton = el("button", {
    class: "btn btn-primary my-tags-tagset-save",
    type: "button",
    text: "Save tag set",
  });
  const renameButton = el("button", {
    class: "btn my-tags-tagset-rename",
    type: "button",
    text: "Rename tag set",
  });

  let busy = false;
  const submit = async (change: TagsetChange, message: string): Promise<void> => {
    if (busy) {
      return;
    }
    error.hidden = true;
    busy = true;
    saveButton.disabled = true;
    renameButton.disabled = true;
    try {
      await save(tagset, change, ctx.signal);
      if (ctx.signal.aborted) {
        return;
      }
      showToast(message);
      ctx.reload();
    } catch (failure) {
      if (ctx.signal.aborted) {
        return;
      }
      error.textContent = errorText(failure, "Could not save the tag set.");
      error.hidden = false;
    } finally {
      busy = false;
      saveButton.disabled = false;
      renameButton.disabled = false;
    }
  };

  /** Every visible control, so one action cannot silently discard an edit in another. */
  const liveChange = (nameValue?: string): TagsetChange => ({
    enabled: isChecked(enabled),
    color: color.value,
    ...(nameValue === undefined ? {} : { name: nameValue }),
  });

  saveButton.addEventListener(
    "click",
    () => {
      const next = name.value.trim();
      const renamed = next !== tagset.name.trim();
      if (renamed && next === "") {
        error.textContent = "Enter a tag set name.";
        error.hidden = false;
        name.focus();
        return;
      }
      void submit(
        liveChange(renamed ? next : undefined),
        renamed ? "Tag set renamed" : "Tag set saved",
      );
    },
    { signal: ctx.signal },
  );
  renameButton.addEventListener(
    "click",
    () => {
      const next = name.value.trim();
      if (next === "") {
        error.textContent = "Enter a tag set name.";
        error.hidden = false;
        name.focus();
        return;
      }
      void submit(liveChange(next), "Tag set renamed");
    },
    { signal: ctx.signal },
  );

  return el(
    "section",
    { class: "settings-section my-tags-tagsets-section", "aria-label": "Tag sets" },
    el("h2", { class: "settings-title", text: "Tag sets" }),
    choices,
    el(
      "div",
      { class: "my-tags-tagset-form" },
      el(
        "label",
        { class: "settings-field my-tags-tagset-name-field" },
        el("span", { text: "Name" }),
        name,
      ),
      hasEnable
        ? el(
            "label",
            { class: "settings-row my-tags-tagset-enable-field" },
            enabled,
            el("span", { text: "Enable flagging and watching for tags in this set" }),
          )
        : null,
      el(
        "label",
        { class: "settings-field my-tags-tagset-color-field" },
        el("span", { text: "Default colour" }),
        color,
      ),
    ),
    el("p", {
      class: "settings-hint",
      text: "Leave the colour empty for the site default. Tag colours in this set fall back to it.",
    }),
    editable
      ? el("div", { class: "my-tags-tagset-actions" }, saveButton, renameButton, error)
      : null,
  );
}

interface TagInputs {
  node: HTMLElement;
  watched: HTMLInputElement;
  hidden: HTMLInputElement;
  weight: HTMLInputElement;
  colorEnabled: HTMLInputElement;
  color: HTMLInputElement;
}

/** Anonymous pages carry `apiuid = -1`; both cases leave no usable write credentials. */
function writableApi(data: MyTagsPage): ApiCredentials | null {
  const api = data.api;
  return api !== null && api.apiUid !== "-1" ? api : null;
}

function describeTag(tag: UserTagState): string {
  const parts: string[] = [];
  if (tag.watched) {
    parts.push("Watched");
  }
  if (tag.hidden) {
    parts.push("Hidden");
  }
  parts.push(`Weight ${tag.weight}`);
  if (tag.color !== "") {
    parts.push(tag.color);
  }
  return parts.join(" · ");
}

/** The shared control block: watch/hide stay exclusive, colour only applies while enabled. */
function tagInputs(tag: UserTagState | null, readOnly: boolean, signal: AbortSignal): TagInputs {
  const watched = el("input", {
    type: "checkbox",
    class: "my-tags-watch",
    checked: tag?.watched === true ? "checked" : null,
  });
  const hidden = el("input", {
    type: "checkbox",
    class: "my-tags-hide",
    checked: tag?.hidden === true ? "checked" : null,
  });
  const weight = el("input", {
    type: "number",
    class: "field-input my-tags-weight",
    min: "-99",
    max: "99",
    step: "1",
    inputmode: "numeric",
    value: String(tag?.weight ?? 10),
  });
  const initialColor = tag?.color ?? "";
  const colorEnabled = el("input", {
    type: "checkbox",
    class: "my-tags-color-enable",
    checked: initialColor !== "" ? "checked" : null,
  });
  const color = el("input", {
    type: "color",
    class: "my-tags-color",
    value: initialColor === "" ? "#ff8800" : initialColor,
    "aria-label": "Tag colour",
  });
  color.disabled = readOnly || !isChecked(colorEnabled);
  for (const control of [watched, hidden, weight, colorEnabled]) {
    control.disabled = readOnly;
  }

  watched.addEventListener(
    "change",
    () => {
      if (isChecked(watched)) {
        hidden.checked = false;
      }
    },
    { signal },
  );
  hidden.addEventListener(
    "change",
    () => {
      if (isChecked(hidden)) {
        watched.checked = false;
      }
    },
    { signal },
  );
  colorEnabled.addEventListener(
    "change",
    () => {
      color.disabled = readOnly || !isChecked(colorEnabled);
    },
    { signal },
  );

  const node = el(
    "div",
    { class: "my-tags-fields" },
    el("label", { class: "check" }, watched, el("span", { text: "Watched" })),
    el("label", { class: "check" }, hidden, el("span", { text: "Hidden" })),
    el("label", { class: "field my-tags-weight-field" }, el("span", { text: "Weight" }), weight),
    el("label", { class: "check" }, colorEnabled, el("span", { text: "Colour" })),
    color,
  );

  return { node, watched, hidden, weight, colorEnabled, color };
}

/** Read the controls into the change the mutation layer expects. */
function readChange(inputs: TagInputs): MyTagChange {
  const rawWeight = inputs.weight.value.trim();
  return {
    watched: isChecked(inputs.watched),
    hidden: isChecked(inputs.hidden),
    weight: rawWeight === "" ? undefined : Number(rawWeight),
    color: isChecked(inputs.colorEnabled) ? inputs.color.value : null,
  };
}

function readOnlyNote(data: MyTagsPage): HTMLElement {
  return el(
    "p",
    { class: "my-tags-readonly", role: "status" },
    "Editing is unavailable on this page. ",
    el("a", {
      class: "my-tags-native",
      href: nativeUrl(data.url),
      "data-native": "",
      text: "Open the native My Tags page",
    }),
    ".",
  );
}

/** Render `/mytags`: filter, add form, and one editable row per saved tag. */
export function renderMyTags(
  host: HTMLElement,
  data: MyTagsPage,
  ctx: ViewContext,
  deps?: MyTagsViewDeps,
): void {
  host.replaceChildren();

  const api = writableApi(data);
  const load =
    deps?.loadDocument ??
    ((url: string, options: DocumentOptions) => loader.document(url, options));

  const filter = searchInput({
    class: "field-input my-tags-filter",
    placeholder: "Filter tags",
    "aria-label": "Filter tags",
  });
  const toolbar = el(
    "div",
    { class: "my-tags-toolbar" },
    el("label", { class: "field my-tags-filter-field" }, el("span", { text: "Filter" }), filter),
  );

  const list = el("div", { class: "my-tags-list" });
  const noMatch = el("p", {
    class: "my-tags-no-match",
    text: "No tags match this filter.",
  });
  noMatch.hidden = true;

  const filterRows = (): void => {
    const needle = filter.value.trim().toLowerCase();
    let shown = 0;
    for (const row of list.querySelectorAll<HTMLElement>(".my-tags-row")) {
      const match = needle === "" || (row.dataset.tagName ?? "").includes(needle);
      row.hidden = !match;
      if (match) {
        shown += 1;
      }
    }
    noMatch.hidden = needle === "" || shown > 0 || data.tags.length === 0;
  };
  filter.addEventListener("input", filterRows, { signal: ctx.signal });

  const buildAddForm = (credentials: ApiCredentials): HTMLElement => {
    const name = textInput({
      class: "field-input my-tags-add-name",
      placeholder: "namespace:tag",
      "aria-label": "Tag name",
    });
    const inputs = tagInputs(null, false, ctx.signal);
    const error = el("p", { class: "my-tags-error", role: "alert" });
    error.hidden = true;
    const submit = el("button", {
      class: "btn btn-primary my-tags-add-submit",
      type: "submit",
      text: "Add tag",
    });
    const form = el(
      "form",
      { id: "my-tags-add", class: "my-tags-add", autocomplete: "off" },
      el("h2", { class: "my-tags-add-title", text: "Add a tag" }),
      el(
        "div",
        { class: "my-tags-add-fields" },
        el("label", { class: "field my-tags-name-field" }, el("span", { text: "Tag" }), name),
        inputs.node,
      ),
      el("p", {
        class: "my-tags-hint",
        text: "Use the site's namespace:tag form. Weight runs from -99 to 99.",
      }),
      el("div", { class: "my-tags-add-actions" }, submit),
      error,
    );

    let adding = false;
    const add = async (): Promise<void> => {
      if (adding) {
        return;
      }
      const tag = name.value.trim();
      error.hidden = true;
      if (tag === "") {
        error.textContent = "Enter a tag name.";
        error.hidden = false;
        name.focus();
        return;
      }

      adding = true;
      submit.disabled = true;
      submit.textContent = "Adding…";
      try {
        const result = await applyMyTag(tag, readChange(inputs), {
          config: credentials,
          myTagsUrl: data.url,
          loadDocument: load,
          post: deps?.post,
          addTag: deps?.addTag,
          signal: ctx.signal,
        });
        showToast(result === "added" ? "Tag added to My Tags" : "My Tags updated");
        form.reset();
        inputs.weight.value = "10";
        inputs.color.disabled = true;
        // The site assigns the new tag's id; only a fresh page exposes the editable row.
        ctx.reload();
      } catch (failure) {
        error.textContent = errorText(failure, "Could not save tag.");
        error.hidden = false;
      } finally {
        adding = false;
        submit.disabled = false;
        submit.textContent = "Add tag";
      }
    };

    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        void add();
      },
      { signal: ctx.signal },
    );
    return form;
  };

  const buildRow = (tag: UserTagState, credentials: ApiCredentials | null): HTMLElement => {
    const inputs = tagInputs(tag, credentials === null, ctx.signal);
    const state: UserTagState = { ...tag };
    const summary = el("span", { class: "my-tags-row-state", text: describeTag(state) });
    const error = el("p", { class: "my-tags-error", role: "alert" });
    error.hidden = true;
    const row = el(
      "div",
      {
        class: "my-tags-row",
        "data-tag-id": String(tag.id),
        "data-tag-name": tag.name.toLowerCase(),
      },
      el(
        "div",
        { class: "my-tags-row-head" },
        el("span", { class: "my-tags-row-name", text: tag.name }),
        summary,
      ),
      inputs.node,
      error,
    );

    if (credentials !== null) {
      const save = el("button", {
        class: "btn btn-small my-tags-save",
        type: "button",
        text: "Save",
      });
      const actions = el("div", { class: "my-tags-row-actions" }, save);
      row.append(actions);
      let busy = false;

      const saveRow = async (): Promise<void> => {
        if (busy) {
          return;
        }
        busy = true;
        save.disabled = true;
        save.textContent = "Saving…";
        error.hidden = true;
        try {
          const change = readChange(inputs);
          await applyMyTag(tag.name, change, {
            config: credentials,
            myTagsUrl: data.url,
            existing: state,
            loadDocument: load,
            post: deps?.post,
            addTag: deps?.addTag,
            signal: ctx.signal,
          });
          const rawWeight = inputs.weight.value.trim();
          Object.assign(state, {
            watched: isChecked(inputs.watched),
            hidden: isChecked(inputs.hidden),
            color: isChecked(inputs.colorEnabled) ? normalizeColor(inputs.color.value) : "",
            weight: rawWeight === "" ? state.weight : normalizeWeight(Number(rawWeight)),
          });
          summary.textContent = describeTag(state);
          showToast("My Tags updated");
        } catch (failure) {
          error.textContent = errorText(failure, "Could not save tag.");
          error.hidden = false;
        } finally {
          busy = false;
          save.disabled = false;
          save.textContent = "Save";
        }
      };

      save.addEventListener(
        "click",
        () => {
          void saveRow();
        },
        { signal: ctx.signal },
      );
    }

    return row;
  };

  for (const tag of data.tags) {
    list.append(buildRow(tag, api));
  }

  const tagsetSection =
    data.tagsets === null
      ? null
      : tagsetPanel(
          data,
          data.tagsets,
          api !== null,
          ctx,
          deps?.saveTagset ??
            ((tagset, change, signal) => saveTagsetRequest(tagset, change, { signal })),
        );
  const page = el("div", { id: "my-tags", class: "my-tags-page" }, tagsetSection, toolbar);
  if (api === null) {
    page.append(readOnlyNote(data));
  } else {
    page.append(buildAddForm(api));
  }
  page.append(list);
  if (data.tags.length === 0) {
    page.append(
      el("p", {
        class: "my-tags-empty",
        text: api === null ? "No saved tags." : "No tags yet. Add your first tag above.",
      }),
    );
  }
  page.append(noMatch);

  host.append(
    siteNav(ctx.signal),
    listHeader({
      title: "My Tags",
      summary: [el("span", { class: "my-tags-count", text: countText(data.tags.length, "tag") })],
    }),
    page,
  );
}
