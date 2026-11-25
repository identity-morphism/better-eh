import { describe, expect, test } from "bun:test";

import { loginGate } from "../../src/ui/login-gate";
import { installDom } from "./dom";

describe("loginGate", () => {
  test("names the requirement, links to the forum login, and offers the native page when there is one", () => {
    installDom();
    const gate = loginGate({
      title: "Favorites needs an account",
      message: "Sign in to load folders.",
      nativeHref: "https://e-hentai.org/favorites.php",
    });

    expect(gate.querySelector(".state-title")?.textContent).toBe("Favorites needs an account");
    expect(gate.querySelector(".state-text")?.textContent).toBe("Sign in to load folders.");

    const [signIn, native] = gate.querySelectorAll<HTMLAnchorElement>("a");
    expect(signIn?.getAttribute("href")).toBe(
      "https://forums.e-hentai.org/index.php?act=Login&CODE=00",
    );
    expect(signIn?.getAttribute("data-native")).toBe("");
    expect(signIn?.textContent).toBe("Sign in");
    // Signing in is the way forward; it must outrank the escape hatch.
    expect(signIn?.className).toContain("btn-primary");

    expect(native?.getAttribute("href")).toBe("https://e-hentai.org/favorites.php");
    expect(native?.textContent).toBe("Open native page");
  });

  test("falls back to the default heading and no native escape", () => {
    installDom();
    const gate = loginGate();

    expect(gate.querySelector(".state-title")?.textContent).toBe("Sign in required");
    expect(gate.querySelectorAll("a")).toHaveLength(1);
  });
});
