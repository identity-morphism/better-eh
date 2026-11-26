import { expect, test } from "bun:test";

import { injectStyles } from "../../src/ui/styles";
import { installDom } from "./dom";

interface StyleGlobals {
  GM_addStyle?: (css: string) => unknown;
}

test("appends and marks the sheet when the manager has no style API", () => {
  installDom();
  (globalThis as unknown as StyleGlobals).GM_addStyle = undefined;

  injectStyles();

  const style = document.querySelector("style[data-better-eh]");
  expect(style).not.toBeNull();
  expect(style?.textContent).toContain("/* better-eh-style */");
});
