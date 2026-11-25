import { beforeEach, describe, expect, test } from "bun:test";

import { syncScrollEdges, trackJumpRow } from "../../src/ui/jump-row";
import { installDom } from "./dom";
import { installTestObservers, lastObserver, TestObserver } from "./observers";

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

    syncScrollEdges(row);

    expect(row.hasAttribute("data-scrolled")).toBe(false);
    expect(row.hasAttribute("data-at-end")).toBe(false);
  });
});

let frames: FrameRequestCallback[];

beforeEach(() => {
  installDom();
  frames = [];
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => undefined,
  });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  installTestObservers();
});

function runFrames(): void {
  const pending = [...frames];
  frames = [];
  for (const callback of pending) {
    callback(0);
  }
}

/** The boot path schedules a second frame once the sticky chrome has measured. */
function runBootFrames(): void {
  runFrames();
  runFrames();
}

interface JumpRowFixture {
  row: HTMLElement;
  links: HTMLElement[];
  sections: HTMLElement[];
}

function setTop(section: HTMLElement, top: number): void {
  Object.defineProperty(section, "getBoundingClientRect", {
    value: () => ({ top }) as DOMRect,
    configurable: true,
  });
}

function jumpRow(): JumpRowFixture {
  const row = document.createElement("nav");
  const links = [0, 1, 2].map((index) => {
    const link = document.createElement("a");
    link.textContent = `Section ${index}`;
    row.append(link);
    return link;
  });
  const sections = [0, 1, 2].map((index) => {
    const section = document.createElement("section");
    section.id = `section-${index}`;
    document.body.append(section);
    setTop(section, index === 0 ? -200 : 200 + index * 100);
    return section;
  });
  document.body.append(row);
  return { row, links, sections };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`missing item ${index}`);
  }
  return item;
}

function countAttributeWrites(links: HTMLElement[]): string[] {
  const writes: string[] = [];
  links.forEach((link, index) => {
    const set = link.setAttribute.bind(link);
    const remove = link.removeAttribute.bind(link);
    Object.defineProperty(link, "setAttribute", {
      configurable: true,
      value: (name: string, value: string) => {
        writes.push(`set:${index}`);
        set(name, value);
      },
    });
    Object.defineProperty(link, "removeAttribute", {
      configurable: true,
      value: (name: string) => {
        writes.push(`remove:${index}`);
        remove(name);
      },
    });
  });
  return writes;
}

describe("trackJumpRow", () => {
  test("touches only the previous and next link on a section crossing", () => {
    const { row, links, sections } = jumpRow();
    const controller = new AbortController();
    trackJumpRow({ row, links, sections }, controller.signal);
    runBootFrames();

    expect(links[0]?.getAttribute("aria-current")).toBe("true");
    expect(lastObserver().targets.size).toBe(3);

    const writes = countAttributeWrites(links);

    setTop(at(sections, 0), -200);
    setTop(at(sections, 1), 90);
    setTop(at(sections, 2), 200);
    lastObserver().trigger(at(sections, 1));

    expect(writes).toEqual(["remove:0", "set:1"]);
    expect(links[0]?.getAttribute("aria-current")).toBeNull();
    expect(links[1]?.getAttribute("aria-current")).toBe("true");

    setTop(at(sections, 1), -100);
    setTop(at(sections, 2), 90);
    lastObserver().trigger(at(sections, 2));

    expect(writes).toEqual(["remove:0", "set:1", "remove:1", "set:2"]);
    expect(links[2]?.getAttribute("aria-current")).toBe("true");
    expect(links[0]?.getAttribute("aria-current")).toBeNull();

    controller.abort();
  });

  test("coalesces resize work and reuses the observer for the same band", () => {
    const { row, links, sections } = jumpRow();
    const controller = new AbortController();
    trackJumpRow({ row, links, sections }, controller.signal);
    runBootFrames();

    expect(TestObserver.instances.length).toBe(1);
    const observer = lastObserver();

    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(frames.length).toBe(1);

    runFrames();
    expect(TestObserver.instances.length).toBe(1);
    expect(lastObserver()).toBe(observer);
    expect(observer.targets.size).toBe(3);

    controller.abort();
    expect(observer.targets.size).toBe(0);
  });
});
