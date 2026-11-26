import { beforeEach, describe, expect, test } from "bun:test";

import { nativeZoomLimit, ZoomController } from "../../src/zoom";
import { installDom } from "./dom";

test("nativeZoomLimit reports the pixels a source runs out at and never blocks an unknown size", () => {
  expect(nativeZoomLimit(500, 1000)).toBe(2);
  expect(nativeZoomLimit(1000, 500)).toBe(0.5);
  expect(nativeZoomLimit(0, 1000)).toBe(Number.POSITIVE_INFINITY);
  expect(nativeZoomLimit(500, 0)).toBe(Number.POSITIVE_INFINITY);
});

let document: Document;
let surface: HTMLElement;

beforeEach(() => {
  document = installDom();
  surface = document.createElement("img");
  Object.defineProperty(surface, "clientWidth", { value: 500 });
  Object.defineProperty(surface, "clientHeight", { value: 700 });
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});

function controller(
  fitHeight = true,
  signal = new AbortController().signal,
  getSurface = () => surface,
): ZoomController {
  const container = document.createElement("div");
  document.body.append(container);
  return new ZoomController(container, getSurface, () => fitHeight, signal);
}

function mouse(type: string, init: { clientX?: number; clientY?: number } = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { button: 0, ...init });
  return event;
}

describe("ZoomController pinch level", () => {
  test("clamps a pinch between fit and five times and clears the transform at fit", () => {
    const zoom = controller();

    zoom.setZoom(2, true);
    expect(zoom.getZoomLevel()).toBe(2);
    expect(surface.style.transform).toContain("scale(2)");

    zoom.setZoom(9, true);
    expect(zoom.getZoomLevel()).toBe(5);

    zoom.setZoom(0.2, true);
    expect(zoom.getZoomLevel()).toBe(1);
    expect(surface.style.transform).toBe("");
  });

  test("pans a zoomed surface within the viewport limits", () => {
    const zoom = controller();

    zoom.setZoom(3, true);
    zoom.panBy(-100, 40);
    expect(surface.style.transform).toContain("translate(-100px, 40px)");

    zoom.panBy(-1000, 1000);
    expect(surface.style.transform).toContain("translate(-250px, 650px)");
  });

  test("ignores pinch levels outside fit-height", () => {
    const zoom = controller(false);

    zoom.setZoom(3, false);

    expect(zoom.getZoomLevel()).toBe(1);
    expect(surface.style.transform).toBe("");
  });
});

describe("ZoomController keys, wheel and drag", () => {
  test("zooms with Ctrl+wheel and reports the level", () => {
    const levels: number[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    const zoom = new ZoomController(
      container,
      () => surface,
      () => true,
      new AbortController().signal,
      (level) => levels.push(level),
    );

    window.dispatchEvent(
      Object.assign(new Event("wheel", { cancelable: true }), { ctrlKey: false, deltaY: -100 }),
    );
    expect(zoom.getZoomLevel()).toBe(1);

    window.dispatchEvent(
      Object.assign(new Event("wheel", { cancelable: true }), { ctrlKey: true, deltaY: -100 }),
    );
    expect(zoom.getZoomLevel()).toBeCloseTo(1.1);
    expect(levels.at(-1)).toBeCloseTo(1.1);
    zoom.reset();
  });

  test("clamps the keyboard floor, refuses zoom outside fit-height and resets", () => {
    const zoom = controller();

    zoom.updateZoom(-0.5, true);
    expect(zoom.getZoomLevel()).toBe(0.7);
    zoom.reset();
    expect(zoom.getZoomLevel()).toBe(1);
    expect(surface.style.transform).toBe("");

    zoom.updateZoom(0.1, false);
    expect(zoom.getZoomLevel()).toBe(1);
    expect(document.getElementById("eh-toast")?.textContent).toContain("Press F");
  });

  test("pans with the scroll keys while zoomed", () => {
    const zoom = controller();
    zoom.setZoom(2, true);

    const up = new Event("keydown");
    Object.defineProperty(up, "key", { value: "ArrowUp" });
    expect(zoom.handleKey(up as KeyboardEvent, true)).toBe(true);
    expect(surface.style.transform).toContain("translate(0px, 220px)");

    const down = new Event("keydown");
    Object.defineProperty(down, "key", { value: "ArrowDown" });
    expect(zoom.handleKey(down as KeyboardEvent, true)).toBe(true);
    expect(surface.style.transform).toContain("translate(0px, 0px)");
    zoom.reset();
  });

  test("drags a zoomed surface and reports the pan once", () => {
    const zoom = controller();
    const container = document.body.lastElementChild as HTMLElement;
    zoom.setZoom(3, true);

    container.dispatchEvent(mouse("mousedown", { clientX: 100, clientY: 100 }));
    window.dispatchEvent(mouse("mousemove", { clientX: 150, clientY: 130 }));
    window.dispatchEvent(mouse("mouseup"));

    expect(surface.style.transform).toContain("translate(50px, 30px)");
    expect(zoom.consumePanned()).toBe(true);
    expect(zoom.consumePanned()).toBe(false);
    zoom.reset();
  });

  test("re-applies the zoom to a new surface and clears the old one", () => {
    let current = surface;
    const zoom = controller(true, new AbortController().signal, () => current);
    zoom.setZoom(2, true);
    expect(surface.style.transform).toContain("scale(2)");

    const next = document.createElement("img");
    Object.defineProperty(next, "clientWidth", { value: 500 });
    Object.defineProperty(next, "clientHeight", { value: 700 });
    current = next;
    zoom.syncSurface();

    expect(surface.style.transform).toBe("");
    expect(next.style.transform).toContain("scale(2)");
    zoom.reset();
  });

  test("clears the transform and cursor when the view aborts", () => {
    const abort = new AbortController();
    const zoom = controller(true, abort.signal);
    const container = document.body.lastElementChild as HTMLElement;
    zoom.setZoom(2, true);

    abort.abort();

    expect(surface.style.transform).toBe("");
    expect(container.style.cursor).toBe("");
  });
});
