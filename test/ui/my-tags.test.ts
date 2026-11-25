import { beforeEach, describe, expect, test } from "bun:test";

import type { MyTagsPage, TagsetState } from "../../src/parse/my-tags";
import type { MyTagsViewDeps, SaveTagset } from "../../src/views/my-tags";
import { renderMyTags } from "../../src/views/my-tags";
import { deferred, flushMicrotasks, until } from "./async";
import { installDom, mountHost, requireNode, viewContext } from "./dom";

const PAGE_URL = "https://e-hentai.org/mytags";

const data: MyTagsPage = {
  url: PAGE_URL,
  tagsets: {
    choices: [
      { id: "1", label: "Tagset #1 (2)", selected: true },
      { id: "2", label: "Reading (1)", selected: false },
    ],
    currentId: "1",
    name: "Tagset #1",
    enabled: true,
    color: "#ff8800",
    action: PAGE_URL,
    fields: [
      { name: "tagset_action", kind: "value", value: "" },
      { name: "tagset_name", kind: "value", value: "" },
      { name: "tagset_enable", kind: "checkbox", value: "on" },
      { name: "tagset_color", kind: "value", value: "#ff8800" },
    ],
  },
  tags: [
    {
      id: 4242,
      name: "female:entry",
      watched: true,
      hidden: false,
      color: "#ff8800",
      weight: 15,
    },
    {
      id: 4243,
      name: "language:english",
      watched: false,
      hidden: true,
      color: "",
      weight: 10,
    },
  ],
  api: {
    apiUrl: "https://api.e-hentai.org/api.php",
    apiUid: "424242",
    apiKey: "fake-api-key",
  },
};

let document: Document;
let host: HTMLElement;

function render(deps: MyTagsViewDeps = {}): void {
  renderMyTags(host, data, viewContext(), deps);
}

beforeEach(() => {
  document = installDom(PAGE_URL);
  host = mountHost(document);
});

describe("renderMyTags", () => {
  test("renders the heading, count, add form and one row per saved tag", () => {
    render();

    expect(host.querySelector("h1")?.textContent).toBe("My Tags");
    expect(host.querySelector(".my-tags-count")?.textContent).toBe("2 tags");
    expect(host.querySelector("#my-tags")).not.toBeNull();
    expect(host.querySelectorAll(".my-tags-row")).toHaveLength(2);

    const form = requireNode<HTMLFormElement>(host, "#my-tags-add");
    expect(form.querySelector(".my-tags-add-name")).not.toBeNull();
  });

  test("filters rows by tag name", () => {
    render();

    const filter = requireNode<HTMLInputElement>(host, ".my-tags-filter");
    filter.value = "ENGLISH";
    filter.dispatchEvent(new Event("input", { bubbles: true }));

    const rows = [...host.querySelectorAll<HTMLElement>(".my-tags-row")];
    expect(rows.map((row) => row.hidden)).toEqual([true, false]);
    expect(host.querySelector<HTMLElement>(".my-tags-no-match")?.hidden).toBe(true);

    filter.value = "missing";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    expect(rows.map((row) => row.hidden)).toEqual([true, true]);
    expect(host.querySelector<HTMLElement>(".my-tags-no-match")?.hidden).toBe(false);
  });

  test("saves an existing row with its weight and without refetching My Tags", async () => {
    let fetched = 0;
    const calls: Array<{ url: string; body: unknown }> = [];
    const deps: MyTagsViewDeps = {
      loadDocument: () => {
        fetched += 1;
        return Promise.reject(new Error("the saved row must not fetch the page"));
      },
      post: (url, body) => {
        calls.push({ url, body });
        return Promise.resolve({ tagid: 4242 });
      },
    };
    render(deps);

    const row = requireNode<HTMLElement>(host, '[data-tag-id="4242"]');
    const weight = requireNode<HTMLInputElement>(row, ".my-tags-weight");
    weight.value = "25";
    requireNode<HTMLButtonElement>(row, ".my-tags-save").click();
    await until(
      () => row.querySelector(".my-tags-row-state")?.textContent.includes("Weight 25") === true,
    );

    expect(fetched).toBe(0);
    expect(calls.map((call) => call.url)).toEqual(["https://api.e-hentai.org/api.php"]);
    expect(calls[0]?.body).toMatchObject({
      method: "setusertag",
      tagid: 4242,
      tagwatch: 1,
      taghide: 0,
      tagcolor: "#ff8800",
      tagweight: 25,
    });
    expect(row.querySelector(".my-tags-row-state")?.textContent).toContain("Weight 25");
    expect(document.getElementById("eh-toast")?.textContent).toBe("My Tags updated");
  });

  test("shows a save failure inline", async () => {
    render({
      post: () => Promise.reject(new Error("API is down")),
    });

    const row = requireNode<HTMLElement>(host, '[data-tag-id="4243"]');
    requireNode<HTMLButtonElement>(row, ".my-tags-save").click();
    await until(() => {
      const error = row.querySelector<HTMLElement>(".my-tags-error");
      return error?.textContent === "API is down" && error.hidden === false;
    });

    const error = requireNode<HTMLElement>(row, ".my-tags-error");
    expect(error.textContent).toBe("API is down");
    expect(error.hidden).toBe(false);
  });

  test("renders the tagset manager with its choices and current controls", () => {
    render();

    const section = requireNode(host, ".my-tags-tagsets-section");
    expect(requireNode(section, ".settings-title").textContent).toBe("Tag sets");
    const links = [...section.querySelectorAll<HTMLAnchorElement>(".my-tags-tagset-link")];
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Tagset #1 (2)", "https://e-hentai.org/mytags?tagset=1"],
      ["Reading (1)", "https://e-hentai.org/mytags?tagset=2"],
    ]);
    expect(links[0]?.getAttribute("aria-current")).toBe("page");
    expect(links[1]?.getAttribute("aria-current")).toBeNull();

    const name = requireNode<HTMLInputElement>(section, ".my-tags-tagset-name");
    const enable = requireNode<HTMLInputElement>(section, ".my-tags-tagset-enable");
    const color = requireNode<HTMLInputElement>(section, ".my-tags-tagset-color");
    expect(name.value).toBe("Tagset #1");
    expect(enable.hasAttribute("checked")).toBe(true);
    expect(color.value).toBe("#ff8800");
    expect(name.disabled).toBe(false);
  });

  test("hides the enable control when the native form does not offer it", () => {
    if (data.tagsets === null) {
      throw new Error("the fixture has no tagset");
    }
    const withoutEnable: TagsetState = {
      ...data.tagsets,
      enabled: false,
      fields: data.tagsets.fields.filter((field) => field.name !== "tagset_enable"),
    };
    renderMyTags(host, { ...data, tagsets: withoutEnable }, viewContext());

    expect(host.querySelector(".my-tags-tagset-enable")).toBeNull();
  });

  test("saves the visible tagset edits, reloads and reports a rename", async () => {
    const saved: unknown[] = [];
    let reloads = 0;
    const saveTagset: SaveTagset = (_tagset, change) => {
      saved.push(change);
      return Promise.resolve();
    };
    const ctx = viewContext({
      reload: () => {
        reloads += 1;
      },
    });
    renderMyTags(host, data, ctx, { saveTagset });

    requireNode<HTMLInputElement>(host, ".my-tags-tagset-enable").checked = false;
    requireNode<HTMLInputElement>(host, ".my-tags-tagset-color").value = "#00FF00";
    requireNode<HTMLButtonElement>(host, ".my-tags-tagset-save").click();
    await until(() => reloads === 1);

    expect(saved).toEqual([{ enabled: false, color: "#00FF00" }]);
    expect(document.getElementById("eh-toast")?.textContent).toBe("Tag set saved");

    requireNode<HTMLInputElement>(host, ".my-tags-tagset-name").value = "Reading queue";
    requireNode<HTMLButtonElement>(host, ".my-tags-tagset-save").click();
    await until(() => reloads === 2);

    expect(saved[1]).toEqual({ enabled: false, color: "#00FF00", name: "Reading queue" });
    expect(document.getElementById("eh-toast")?.textContent).toBe("Tag set renamed");
  });

  test("does not reload or report after the view was aborted", async () => {
    const pending = deferred<void>();
    let reloads = 0;
    const controller = new AbortController();
    const ctx = viewContext({
      signal: controller.signal,
      reload: () => {
        reloads += 1;
      },
    });
    renderMyTags(host, data, ctx, {
      saveTagset: () => pending.promise,
    });

    requireNode<HTMLButtonElement>(host, ".my-tags-tagset-save").click();
    controller.abort();
    pending.resolve();
    await flushMicrotasks(20);

    expect(reloads).toBe(0);
    expect(document.getElementById("eh-toast")).toBeNull();
  });

  test("rejects a blank tagset name without posting", () => {
    const saved: unknown[] = [];
    render({
      saveTagset: (_tagset, change) => {
        saved.push(change);
        return Promise.resolve();
      },
    });

    requireNode<HTMLInputElement>(host, ".my-tags-tagset-name").value = "   ";
    requireNode<HTMLButtonElement>(host, ".my-tags-tagset-rename").click();

    const error = requireNode<HTMLElement>(host, ".my-tags-tagset-error");
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("Enter a tag set name.");
    expect(saved).toHaveLength(0);
  });

  test("renders read-only with a native link when writes are unavailable", () => {
    const accounts: Array<MyTagsPage["api"]> = [
      null,
      {
        apiUrl: "https://api.e-hentai.org/api.php",
        apiUid: "-1",
        apiKey: "fake-api-key",
      },
    ];
    for (const api of accounts) {
      renderMyTags(host, { ...data, api }, viewContext());

      expect(host.querySelector("#my-tags-add")).toBeNull();
      expect(host.querySelectorAll(".my-tags-save")).toHaveLength(0);
      const note = requireNode<HTMLElement>(host, ".my-tags-readonly");
      expect(note.textContent).toContain("Editing is unavailable");
      expect(requireNode<HTMLAnchorElement>(note, "a").getAttribute("href")).toBe(
        "https://e-hentai.org/mytags?eh_native=1",
      );
      expect(requireNode<HTMLInputElement>(host, ".my-tags-watch").disabled).toBe(true);
      expect(requireNode<HTMLInputElement>(host, ".my-tags-tagset-name").disabled).toBe(true);
      expect(host.querySelector(".my-tags-tagset-save")).toBeNull();
      expect(host.querySelectorAll(".my-tags-row")).toHaveLength(2);
    }
  });
});
