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

function controller(fitHeight = true): ZoomController {
  const container = document.createElement("div");
  document.body.append(container);
  return new ZoomController(
    container,
    () => surface,
    () => fitHeight,
    new AbortController().signal,
  );
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
