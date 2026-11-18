import { beforeEach, describe, expect, test } from "bun:test";

import type { MyTagsPage } from "../../src/parse/my-tags";
import type { MyTagsViewDeps } from "../../src/views/my-tags";
import { renderMyTags } from "../../src/views/my-tags";
import { until } from "./async";
import { installDom, mountHost, requireNode, viewContext } from "./dom";

const PAGE_URL = "https://e-hentai.org/mytags";

const data: MyTagsPage = {
  url: PAGE_URL,
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
    expect(form.querySelector(".my-tags-watch")).not.toBeNull();
    expect(form.querySelector(".my-tags-hide")).not.toBeNull();
    expect(form.querySelector(".my-tags-weight")).not.toBeNull();
    expect(form.querySelector(".my-tags-color-enable")).not.toBeNull();
    expect(form.querySelector(".my-tags-color")).not.toBeNull();
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
    expect(calls).toEqual([
      {
        url: "https://api.e-hentai.org/api.php",
        body: {
          method: "setusertag",
          apiuid: "424242",
          apikey: "fake-api-key",
          tagid: 4242,
          tagwatch: 1,
          taghide: 0,
          tagcolor: "#ff8800",
          tagweight: 25,
        },
      },
    ]);
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
      expect(host.querySelectorAll(".my-tags-row")).toHaveLength(2);
    }
  });
});
