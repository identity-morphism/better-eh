import { describe, expect, test } from "bun:test";

import { loginGate } from "../../src/ui/login-gate";
import { installDom } from "./dom";

describe("loginGate", () => {
  test("names the requirement and links to the forum login", () => {
    installDom();
    const gate = loginGate({
      title: "Favorites needs an account",
      message: "Sign in to load folders.",
    });

    // The gate is the shared state panel, so it carries the same structure as every empty state.
    expect(gate.className).toBe("empty-state");
    expect(gate.querySelector(".state-title")?.tagName).toBe("H1");
    expect(gate.querySelector(".state-title")?.textContent).toBe("Favorites needs an account");
    expect(gate.querySelector(".state-text")?.textContent).toBe("Sign in to load folders.");

    const link = gate.querySelector<HTMLAnchorElement>("a[href^='https://forums']");
    expect(link?.getAttribute("href")).toBe(
      "https://forums.e-hentai.org/index.php?act=Login&CODE=00",
    );
    expect(link?.getAttribute("data-native")).toBe("");
    expect(link?.textContent).toBe("Sign in");
    // Signing in is the way forward; it must outrank the escape hatch.
    expect(link?.className).toContain("btn-primary");
  });

  test("offers the native page only when the route has one", () => {
    installDom();
    const plain = loginGate();
    expect(plain.querySelectorAll("a").length).toBe(1);
    expect(plain.querySelector(".state-title")?.textContent).toBe("Sign in required");

    const escapable = loginGate({ nativeHref: "https://e-hentai.org/favorites.php" });
    const actions = escapable.querySelectorAll<HTMLAnchorElement>("a");
    expect(actions.length).toBe(2);
    expect(actions[1]?.getAttribute("href")).toBe("https://e-hentai.org/favorites.php");
    expect(actions[1]?.textContent).toBe("Open native page");
  });
});
