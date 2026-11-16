import { describe, expect, test } from "bun:test";

import { syncScrollEdges } from "../../src/ui/jump-row";
import { installDom } from "./dom";

function rowWith(scrollWidth: number, clientWidth: number): HTMLElement {
  const row = installDom().createElement("nav");
  Object.defineProperty(row, "scrollWidth", { value: scrollWidth });
  Object.defineProperty(row, "clientWidth", { value: clientWidth });
  return row;
}

describe("jump row scroll edges", () => {
  test("moves from the leading edge through both edges to the trailing edge", () => {
    const row = rowWith(1000, 400);

    syncScrollEdges(row);
    expect(row.hasAttribute("data-scrolled")).toBe(false);
    expect(row.hasAttribute("data-at-end")).toBe(false);

    row.scrollLeft = 300;
    syncScrollEdges(row);
    expect(row.hasAttribute("data-scrolled")).toBe(true);
    expect(row.hasAttribute("data-at-end")).toBe(false);

    row.scrollLeft = 600;
    syncScrollEdges(row);
    expect(row.hasAttribute("data-scrolled")).toBe(true);
    expect(row.hasAttribute("data-at-end")).toBe(true);
  });

  test("leaves a row that does not overflow unmarked", () => {
    const row = rowWith(400, 400);
    row.scrollLeft = 0;

    syncScrollEdges(row);

    expect(row.hasAttribute("data-scrolled")).toBe(false);
    expect(row.hasAttribute("data-at-end")).toBe(false);
  });
});
