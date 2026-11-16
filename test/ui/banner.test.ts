import { beforeEach, describe, expect, test } from "bun:test";

import { showBanner } from "../../src/ui/banner";
import { installDom } from "./dom";

function closeButton(banner: Element | null): HTMLButtonElement {
  const button = banner?.querySelector<HTMLButtonElement>(".eh-banner-close");
  if (!button) {
    throw new Error("missing banner close button");
  }
  return button;
}

const document = installDom();

beforeEach(() => {
  // The banner module keeps its host across calls; clear the body so each test starts fresh.
  document.body.replaceChildren();
});

describe("showBanner", () => {
  test("coalesces identical messages without replacing the node", () => {
    showBanner("Offline mode");
    const first = document.querySelector(".eh-banner");
    showBanner("Offline mode");
    showBanner("Offline mode");

    const banners = document.querySelectorAll(".eh-banner");
    expect(banners).toHaveLength(1);
    expect(banners[0] === first).toBe(true);
    expect(banners[0]?.querySelector(".eh-banner-count")?.textContent).toBe("×3");

    closeButton(banners[0] ?? null).click();
    expect(document.querySelector(".eh-banner")).toBeNull();
    expect(document.getElementById("eh-banner-host")?.hidden).toBe(true);
  });

  test("dismissing one banner keeps the others", () => {
    showBanner("First warning");
    showBanner("Second warning");

    const banners = [...document.querySelectorAll(".eh-banner")];
    expect(banners).toHaveLength(2);

    closeButton(banners[0] ?? null).click();
    expect(document.querySelectorAll(".eh-banner")).toHaveLength(1);
    expect(document.querySelector(".eh-banner")?.textContent).toContain("Second warning");

    closeButton(document.querySelector(".eh-banner")).click();
    expect(document.querySelectorAll(".eh-banner")).toHaveLength(0);
  });
});
