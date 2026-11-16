import { beforeEach, describe, expect, test } from "bun:test";

import { getResume, RESUME_TTL_MS, saveResume } from "../../src/data/resume";
import type { GalleryData } from "../../src/types";
import { GALLERY_URL, mountGallery, renderGalleryAt } from "./gallery-harness";

function save(pageNum: number, now = Date.now()): void {
  saveResume(
    GALLERY_URL,
    {
      pageUrl: `https://e-hentai.org/s/hash/${pageNum}-7`,
      pageNum,
      counterText: `${pageNum} / 42`,
    },
    now,
  );
}

describe("gallery resume control", () => {
  let host: HTMLElement;
  let data: GalleryData;

  beforeEach(async () => {
    ({ host, data } = await mountGallery({
      prepare: () => {
        GM_setValue("eh:resume:v1", {});
      },
    }));
  });

  test("offers the saved page with its counter as context", () => {
    save(17);
    renderGalleryAt(host, data);

    const link = host.querySelector<HTMLAnchorElement>(".gallery-resume");
    expect(link?.textContent).toContain("Resume page 17");
    expect(link?.getAttribute("href")).toBe("https://e-hentai.org/s/hash/17-7");
    expect(link?.getAttribute("title")).toContain("17 / 42");
  });

  test("omits the control when there is no live position", () => {
    save(2, Date.now() - RESUME_TTL_MS - 1);
    renderGalleryAt(host, data);
    expect(host.querySelector(".gallery-resume")).toBeNull();
  });

  test("clears the record without opening the page", () => {
    save(9);
    renderGalleryAt(host, data);

    host.querySelector<HTMLButtonElement>(".gallery-resume-clear")?.click();

    expect(host.querySelector(".gallery-resume")).toBeNull();
    expect(getResume(GALLERY_URL)).toBeNull();
  });
});
