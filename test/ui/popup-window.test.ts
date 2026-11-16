import { beforeEach, describe, expect, test } from "bun:test";

import { openPopup } from "../../src/ui/popup-window";
import { installDom } from "./dom";

beforeEach(() => {
  installDom();
});

describe("openPopup", () => {
  test("opens a sized popup window", () => {
    let args: unknown[] = [];
    Object.defineProperty(window, "open", {
      configurable: true,
      value: (...next: unknown[]) => {
        args = next;
        return {};
      },
    });

    openPopup("https://e-hentai.org/archiver.php", 800, 600);

    expect(args[0]).toBe("https://e-hentai.org/archiver.php");
    expect(args[1]).toBe("_blank");
    const features = String(args[2]).split(",");
    expect(features).toContain("popup=yes");
    expect(features).toContain("width=800");
    expect(features).toContain("height=600");
  });

  test("falls back to navigation when the popup is blocked", () => {
    Object.defineProperty(window, "open", { configurable: true, value: () => null });
    const location = { href: "" };
    Object.assign(globalThis, { location });

    openPopup("https://e-hentai.org/archiver.php", 800, 600);

    expect(location.href).toBe("https://e-hentai.org/archiver.php");
  });
});
