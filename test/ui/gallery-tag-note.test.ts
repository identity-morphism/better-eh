import { beforeEach, describe, expect, test } from "bun:test";

import type { GalleryData } from "../../src/types";
import { mountGallery, renderGalleryAt } from "./gallery-harness";

const NOTE = "definition revised please read the wiki";

/** Add the inline API credentials the site prints for a signed-in gallery page. */
function addApiConfig(doc: Document): void {
  const script = doc.createElement("script");
  script.textContent =
    'var api_url = "https://api.e-hentai.org/api.php"; var apiuid = 1; var apikey = "key"; var gid = 123456; var token = "abcdef1234";';
  doc.head.append(script);
}

/** Add the site's `ns:tag | note` link to the fixture's tag table before parsing. */
function addNotedTag(doc: Document): void {
  const row = doc.createElement("tr");
  row.innerHTML = `
    <td class="tc">language:</td>
    <td><a href="https://e-hentai.org/tag/language:japanese">japanese | ${NOTE}</a></td>
  `;
  doc.querySelector("#taglist tbody")?.append(row);
}

describe("gallery tag section", () => {
  let document: Document;
  let host: HTMLElement;
  let data: GalleryData;

  beforeEach(async () => {
    ({ document, host, data } = await mountGallery({
      fixture: "gallery-comments.html",
      prepare: (doc) => {
        addApiConfig(doc);
        addNotedTag(doc);
      },
    }));
    renderGalleryAt(host, data);
  });

  function notedChip(): HTMLElement {
    const chip = [...host.querySelectorAll<HTMLElement>(".tag-chip")].find(
      (node) => node.querySelector(".tag-name")?.textContent === "japanese",
    );
    if (!chip) {
      throw new Error("missing noted tag chip");
    }
    return chip;
  }

  test("labels the section with a heading", () => {
    const section = host.querySelector(".tag-section");

    expect(section?.querySelector("h2")?.textContent).toBe("Tags");
  });

  test("renders the note as a separate muted span with a full accessible name", () => {
    const chip = notedChip();

    expect(chip.querySelector(".tag-name")?.textContent).toBe("japanese");
    expect(chip.querySelector(".tag-note")?.textContent).toBe(NOTE);
    expect(chip.getAttribute("aria-label")).toBe(`japanese — ${NOTE}`);
    expect(chip.getAttribute("title")).toContain(`japanese | ${NOTE}`);
  });

  test("names the tag in its menu without the raw id", () => {
    notedChip().dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));

    const menu = document.querySelector<HTMLElement>(".tag-menu");
    expect(menu?.querySelector(".tag-menu-title")?.textContent).toBe("japanese");
    expect(menu?.querySelector(".tag-menu-ns")?.textContent).toBe("language");
  });

  test("offers a touch menu trigger that opens the same actions", () => {
    const trigger =
      notedChip().parentElement?.querySelector<HTMLButtonElement>(".tag-menu-trigger");
    expect(trigger).not.toBeNull();
    trigger?.click();

    expect(document.querySelector(".tag-menu-title")?.textContent).toBe("japanese");
    expect(document.querySelector(".tag-menu-color")).not.toBeNull();
  });

  test("opens the tag menu when the gallery has API credentials", () => {
    notedChip().dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));

    expect(document.querySelector(".tag-menu")).not.toBeNull();
  });

  test("uses the shared empty panel for a gallery without thumbnails", () => {
    const panel = host.querySelector(".empty-state");

    expect(panel?.querySelector(".state-text")?.textContent).toBe(
      "No page thumbnails found for this gallery.",
    );
    const action = panel?.querySelector<HTMLAnchorElement>(".state-actions a");
    expect(action?.textContent).toBe("Open native page");
    expect(new URL(action?.href ?? "").searchParams.get("eh_native")).toBe("1");
  });
});
