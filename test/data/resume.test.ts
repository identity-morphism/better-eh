import { beforeEach, describe, expect, test } from "bun:test";

import {
  clearResume,
  galleryKey,
  getResume,
  RESUME_LIMIT,
  RESUME_TTL_MS,
  saveResume,
} from "../../src/data/resume";

const GALLERY = "https://e-hentai.org/g/123456/abcdef1234/";
const STORE_KEY = "eh:resume:v1";

beforeEach(() => {
  GM_setValue(STORE_KEY, {});
});

function entry(pageNum: number): {
  pageUrl: string;
  pageNum: number;
  counterText: string;
} {
  return {
    pageUrl: `https://e-hentai.org/s/hash/${pageNum}`,
    pageNum,
    counterText: `${pageNum} / 50`,
  };
}

describe("reading position", () => {
  test("saves, replaces, reads, and clears a position", () => {
    saveResume(GALLERY, entry(7));
    expect(getResume(GALLERY)?.pageNum).toBe(7);

    saveResume(`${GALLERY}?p=2`, entry(12));
    expect(getResume(GALLERY)?.pageNum).toBe(12);
    expect(getResume(GALLERY)?.counterText).toBe("12 / 50");

    clearResume(GALLERY);
    expect(getResume(GALLERY)).toBeNull();
  });

  test("ignores invalid gallery URLs", () => {
    expect(galleryKey("https://e-hentai.org/s/hash/1-2")).toBeNull();
    saveResume("https://e-hentai.org/s/hash/1-2", entry(1));
    expect(getResume("https://e-hentai.org/s/hash/1-2")).toBeNull();
  });

  test("expires an old position", () => {
    const now = Date.now();
    saveResume(GALLERY, entry(4), now);
    expect(getResume(GALLERY, now + RESUME_TTL_MS - 1)?.pageNum).toBe(4);
    expect(getResume(GALLERY, now + RESUME_TTL_MS)).toBeNull();
  });

  test("keeps the most recent galleries within the bound", () => {
    const now = Date.now();
    for (let index = 0; index < RESUME_LIMIT + 8; index++) {
      saveResume(`https://e-hentai.org/g/${index}/badc0de${index}/`, entry(index), now + index);
    }

    const newest = RESUME_LIMIT + 7;
    const checkAt = now + newest + 1;
    expect(getResume("https://e-hentai.org/g/0/badc0de0/", checkAt)).toBeNull();
    expect(getResume(`https://e-hentai.org/g/${newest}/badc0de${newest}/`, checkAt)?.pageNum).toBe(
      newest,
    );
  });

  test("tolerates a corrupt store", () => {
    GM_setValue(STORE_KEY, "not an object");
    expect(getResume(GALLERY)).toBeNull();
    saveResume(GALLERY, entry(2));
    expect(getResume(GALLERY)?.pageNum).toBe(2);
  });
});
