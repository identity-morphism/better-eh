import { beforeEach, describe, expect, test } from "bun:test";

import { parseListPage } from "../../src/parse/list";
import { emptySearchQuery, parseSearchQuery } from "../../src/parse/query";
import { getSearchDraft, setSearchDraftText, setSearchQuery } from "../../src/search-draft";
import { renderGallery } from "../../src/views/gallery";
import { renderList } from "../../src/views/list";
import { loadFixture } from "../dom";
import { installDom, mountHost, viewContext } from "./dom";
import { mountGallery } from "./gallery-harness";

function click(node: Element, altKey = false): void {
  const event = new Event("click", { bubbles: true, cancelable: true });
  Object.assign(event, {
    button: 0,
    altKey,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  });
  node.dispatchEvent(event);
}

function chipByText(host: HTMLElement, text: string): HTMLElement {
  const chip = [...host.querySelectorAll<HTMLElement>(".tag-chip")].find(
    (node) => node.textContent === text,
  );
  if (!chip) {
    throw new Error(`missing tag chip ${text}`);
  }
  return chip;
}

describe("gallery tag search", () => {
  let host: HTMLElement;
  let navigations: string[];

  beforeEach(async () => {
    const mounted = await mountGallery({ fixture: "gallery.html" });

    setSearchQuery({ ...emptySearchQuery(), text: "cat" });
    host = mounted.host;
    navigations = [];
    renderGallery(
      host,
      mounted.data,
      viewContext({
        navigate: (url) => {
          navigations.push(url);
        },
      }),
    );
  });

  test("carries a submitted search from the list into a gallery", async () => {
    const listDocument = installDom("https://e-hentai.org/?f_search=test");
    const listUrl = "https://e-hentai.org/?f_search=test";
    const listData = parseListPage(await loadFixture("list.html"), listUrl);
    const listHost = mountHost(listDocument);
    renderList(listHost, listData, parseSearchQuery(new URL(listUrl)), viewContext());
    expect(getSearchDraft().text).toBe("test");

    const gallery = await mountGallery({ fixture: "gallery.html" });
    renderGallery(gallery.host, gallery.data, viewContext());

    expect(gallery.host.querySelector<HTMLInputElement>("input[name='f_search']")?.value).toBe(
      "test",
    );
    expect(gallery.host.querySelectorAll(".term-chip")).toHaveLength(1);
  });

  test("keeps the previous search in the topbar", () => {
    const input = host.querySelector<HTMLInputElement>("input[name='f_search']");

    expect(input?.value).toBe("cat");
    expect(host.querySelectorAll(".term-chip")).toHaveLength(1);
  });

  test("appends a clicked tag instead of replacing the search", () => {
    click(chipByText(host, "bob smith"));

    expect(getSearchDraft().text).toBe('cat a:"bob smith$"');
    expect(host.querySelector<HTMLInputElement>("input[name='f_search']")?.value).toBe(
      'cat a:"bob smith$"',
    );
    expect(host.querySelectorAll(".term-chip")).toHaveLength(2);
    expect(navigations).toEqual([]);
  });

  test("recognizes a tag the draft spells with its full namespace", () => {
    setSearchDraftText('artist:"alice$"');

    const alice = chipByText(host, "alice");
    expect(alice.classList.contains("is-added")).toBe(true);
    expect(alice.title).toContain("In the search");
  });

  test("alt-click excludes and a second click toggles it off", () => {
    click(chipByText(host, "alice"), true);
    expect(getSearchDraft().text).toBe("cat -a:alice$");

    click(chipByText(host, "alice"));
    expect(getSearchDraft().text).toBe("cat a:alice$");

    click(chipByText(host, "alice"));
    expect(getSearchDraft().text).toBe("cat");
  });

  test("describes what a click will do to an applied tag", () => {
    click(chipByText(host, "alice"), true);
    const excluded = chipByText(host, "alice");
    expect(excluded.title).toContain("Excluded from the search");
    expect(excluded.title).toContain("Click to include");
    expect(excluded.title).toContain("Alt-click to remove");

    click(chipByText(host, "alice"));
    const included = chipByText(host, "alice");
    expect(included.title).toContain("In the search");
    expect(included.title).toContain("Click to remove");
  });

  test("removing a chip edits the draft query", () => {
    click(chipByText(host, "bob smith"));
    const chip = [...host.querySelectorAll<HTMLElement>(".term-chip")].find(
      (node) => node.querySelector(".term-value")?.textContent === "bob smith",
    );

    chip?.querySelector<HTMLButtonElement>(".term-toggle")?.click();
    expect(getSearchDraft().text).toBe("cat");
    expect(host.querySelector<HTMLInputElement>("input[name='f_search']")?.value).toBe("cat");
  });

  test("refreshes tag links as the draft changes", () => {
    const alice = chipByText(host, "alice");
    expect(alice.getAttribute("href")).toBe("/?f_search=cat+a%3Aalice%24");

    click(chipByText(host, "bob smith"));
    expect(alice.getAttribute("href")).toBe("/?f_search=cat+a%3A%22bob+smith%24%22+a%3Aalice%24");

    click(chipByText(host, "bob smith"));
    expect(alice.getAttribute("href")).toBe("/?f_search=cat+a%3Aalice%24");
  });

  test("submitting the draft navigates to the combined search", () => {
    click(chipByText(host, "bob smith"));
    const form = host.querySelector<HTMLFormElement>("form.topbar-search");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(navigations).toEqual(["/?f_search=cat+a%3A%22bob+smith%24%22"]);
    expect(getSearchDraft().text).toBe('cat a:"bob smith$"');
  });
});
