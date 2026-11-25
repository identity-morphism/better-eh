import { beforeEach, describe, expect, test } from "bun:test";

import { createCardGrid } from "../../src/ui/card-grid";
import { installDom } from "./dom";

function card(): HTMLElement {
  return document.createElement("article");
}

beforeEach(() => {
  installDom();
});

describe("createCardGrid", () => {
  test("keeps existing cards in their column when a page is appended", () => {
    const controller = new AbortController();
    const grid = createCardGrid(controller.signal);
    Object.defineProperty(grid.element, "clientWidth", { value: 900, configurable: true });

    const first = Array.from({ length: 6 }, card);
    grid.append(first);
    grid.refresh();

    const columns = [...grid.element.querySelectorAll<HTMLElement>(".card-column")];
    expect(columns.length).toBeGreaterThan(1);
    const placements = first.map((node) => node.parentElement);

    const more = Array.from({ length: 3 }, card);
    grid.append(more);

    expect(first.map((node) => node.parentElement)).toEqual(placements);
    expect(
      more.every((node) => node.parentElement?.classList.contains("card-column") === true),
    ).toBe(true);
  });

  test("records cards until refresh, then places them all once", () => {
    const controller = new AbortController();
    const grid = createCardGrid(controller.signal);
    Object.defineProperty(grid.element, "clientWidth", { value: 900, configurable: true });

    const cards = Array.from({ length: 5 }, card);
    grid.append(cards);

    // Before the grid is attached and refreshed nothing has been placed yet.
    expect(grid.size()).toBe(5);
    expect(grid.element.querySelectorAll(".card-column")).toHaveLength(0);
    expect(cards.every((node) => node.parentElement === null)).toBe(true);

    grid.refresh();

    const columns = [...grid.element.querySelectorAll<HTMLElement>(".card-column")];
    expect(columns.length).toBeGreaterThan(1);
    expect(
      cards.every((node) => node.parentElement?.classList.contains("card-column") === true),
    ).toBe(true);
    expect(new Set(cards.map((node) => node.parentElement)).size).toBe(columns.length);
    expect(columns.reduce((total, column) => total + column.children.length, 0)).toBe(5);
  });

  test("removing appended cards leaves the remaining layout untouched", () => {
    const controller = new AbortController();
    const grid = createCardGrid(controller.signal);
    Object.defineProperty(grid.element, "clientWidth", { value: 900, configurable: true });

    const first = Array.from({ length: 4 }, card);
    const more = Array.from({ length: 3 }, card);
    grid.append([...first, ...more]);
    grid.refresh();

    const placements = first.map((node) => node.parentElement);
    grid.remove(more);

    expect(first.map((node) => node.parentElement)).toEqual(placements);
    expect(more.every((node) => node.parentElement === null)).toBe(true);
  });
});
