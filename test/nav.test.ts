import { describe, expect, mock, test } from "bun:test";

// app.ts imports the built stylesheet, which does not exist in a clean checkout. The stub must be
// registered before app.ts is evaluated, so its import cannot be static.
void mock.module("../src/ui/styles", () => ({ injectStyles: () => undefined }));

const { isFragmentOnlyChange } = await import("../src/app");

const GALLERY = "https://e-hentai.org/g/123/0123456789/";

describe("isFragmentOnlyChange", () => {
  test("is true for jumps within the same document", () => {
    expect(isFragmentOnlyChange(GALLERY, `${GALLERY}#comments`)).toBe(true);
    expect(isFragmentOnlyChange(`${GALLERY}#comments`, `${GALLERY}#similar`)).toBe(true);
    expect(isFragmentOnlyChange(`${GALLERY}#comments`, GALLERY)).toBe(true);
  });

  test("is false when the path, query or origin changes", () => {
    expect(isFragmentOnlyChange(GALLERY, `${GALLERY}?p=2#comments`)).toBe(false);
    expect(isFragmentOnlyChange(GALLERY, "https://e-hentai.org/g/999/0123456789/#comments")).toBe(
      false,
    );
    expect(isFragmentOnlyChange(GALLERY, "https://exhentai.org/g/123/0123456789/#comments")).toBe(
      false,
    );
  });

  test("is false for an unchanged URL and for an empty current URL", () => {
    expect(isFragmentOnlyChange(GALLERY, GALLERY)).toBe(false);
    expect(isFragmentOnlyChange("", `${GALLERY}#comments`)).toBe(false);
  });
});
