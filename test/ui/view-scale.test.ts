import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_SETTINGS, updateSetting } from "../../src/settings";
import { bindViewScale } from "../../src/ui/view-scale";

type ResizeListener = (event: Event) => void;

let resizeListeners: Set<ResizeListener>;
let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
let restoreWindow: () => void;
let restoreRaf: () => void;
let restoreCancelRaf: () => void;

function replaceGlobal(key: string, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return () => {
    if (original === undefined) {
      delete (globalThis as Record<string, unknown>)[key];
    } else {
      Object.defineProperty(globalThis, key, original);
    }
  };
}

beforeEach(() => {
  resizeListeners = new Set();
  frames = new Map();
  nextFrameId = 1;

  restoreWindow = replaceGlobal("window", {
    addEventListener: (type: string, listener: ResizeListener): void => {
      if (type === "resize") {
        resizeListeners.add(listener);
      }
    },
    removeEventListener: (type: string, listener: ResizeListener): void => {
      if (type === "resize") {
        resizeListeners.delete(listener);
      }
    },
  });
  restoreRaf = replaceGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  restoreCancelRaf = replaceGlobal("cancelAnimationFrame", (id: number): void => {
    frames.delete(id);
  });
});

afterEach(() => {
  restoreCancelRaf();
  restoreRaf();
  restoreWindow();
  updateSetting("gap", DEFAULT_SETTINGS.gap);
});

function dispatchResize(): void {
  for (const listener of resizeListeners) {
    listener({} as Event);
  }
}

function flushFrame(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) {
    callback(0);
  }
}

describe("bindViewScale", () => {
  test("applies on mount and again when settings change", () => {
    const gaps: number[] = [];
    const controller = new AbortController();
    bindViewScale({ signal: controller.signal, apply: (settings) => gaps.push(settings.gap) });

    expect(gaps).toEqual([DEFAULT_SETTINGS.gap]);

    updateSetting("gap", 40);
    expect(gaps).toEqual([DEFAULT_SETTINGS.gap, 40]);

    controller.abort();
  });

  test("stops listening after the signal aborts", () => {
    const gaps: number[] = [];
    const controller = new AbortController();
    bindViewScale({ signal: controller.signal, apply: (settings) => gaps.push(settings.gap) });
    expect(resizeListeners.size).toBe(1);

    controller.abort();
    expect(resizeListeners.size).toBe(0);

    updateSetting("gap", 24);
    dispatchResize();
    flushFrame();
    expect(gaps).toEqual([DEFAULT_SETTINGS.gap]);
  });

  test("coalesces a resize burst into one animation frame", () => {
    const gaps: number[] = [];
    const controller = new AbortController();
    bindViewScale({ signal: controller.signal, apply: (settings) => gaps.push(settings.gap) });

    dispatchResize();
    dispatchResize();
    expect(frames.size).toBe(1);

    flushFrame();
    expect(gaps).toEqual([DEFAULT_SETTINGS.gap, DEFAULT_SETTINGS.gap]);
    controller.abort();
  });
});
