import { describe, expect, test } from "bun:test";

import { preloadImage } from "../../src/fetch/images";
import { installDom } from "../ui/dom";

// `preloadImage` reads the global DOM and keeps one hidden container for the whole module.
installDom();

describe("preloadImage", () => {
  test("an errored image leaves the cache and the DOM, so the next call retries", () => {
    const src = "https://img.test/broken.jpg";
    const img = preloadImage(src);

    expect(preloadImage(src)).toBe(img);
    expect(img.parentNode).not.toBeNull();

    img.dispatchEvent(new Event("error"));

    expect(img.parentNode).toBeNull();
    expect(preloadImage(src)).not.toBe(img);
  });
});
