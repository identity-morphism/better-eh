import { describe, expect, test } from "bun:test";

import { requireShell, SHELL_IDS } from "../../src/views/shell";
import { parseDocument } from "../dom";
import { installDom } from "../ui/dom";

describe("viewer shell contract", () => {
  test("shell.html provides every id requireShell may look up", async () => {
    const html = await Bun.file(`${import.meta.dir}/../../src/shell.html`).text();
    const doc = parseDocument(html);

    for (const id of SHELL_IDS) {
      expect(doc.getElementById(id), `missing #${id}`).not.toBeNull();
    }
  });

  test("requireShell names the id when the shell is missing it", () => {
    installDom();

    expect(() => requireShell("main-img")).toThrow("missing #main-img in shell.html");
  });
});
