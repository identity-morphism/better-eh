import { describe, expect, test } from "bun:test";

import type { ScrollRestoreDeps } from "../../src/ui/scroll-restore";
import { restoreScrollWhenReady } from "../../src/ui/scroll-restore";

interface Frame {
  id: number;
  callback: () => void;
  cancelled: boolean;
}

function fakeEnvironment(
  height: number,
  scroll = 0,
  now = 0,
): {
  deps: ScrollRestoreDeps;
  frames: Frame[];
  setHeight: (value: number) => void;
  setNow: (value: number) => void;
  runNext: () => boolean;
  scroll: () => number;
} {
  const frames: Frame[] = [];
  let nextId = 1;
  let currentHeight = height;
  let currentScroll = scroll;
  let currentNow = now;

  const deps: ScrollRestoreDeps = {
    scrollTo: (target) => {
      currentScroll = Math.max(0, Math.min(target, currentHeight - 900));
    },
    scrollY: () => currentScroll,
    scrollHeight: () => currentHeight,
    now: () => currentNow,
    frame: (callback) => {
      const id = nextId++;
      frames.push({ id, callback, cancelled: false });
      return id;
    },
    cancelFrame: (id) => {
      const frame = frames.find((candidate) => candidate.id === id);
      if (frame) {
        frame.cancelled = true;
      }
    },
  };

  return {
    deps,
    frames,
    setHeight: (value) => {
      currentHeight = value;
    },
    setNow: (value) => {
      currentNow = value;
    },
    runNext: () => {
      const frame = frames.find((candidate) => !candidate.cancelled);
      if (!frame) {
        return false;
      }
      frame.cancelled = true;
      frame.callback();
      return true;
    },
    scroll: () => currentScroll,
  };
}

describe("restoreScrollWhenReady", () => {
  test("drives the endless region itself instead of stalling at one page", async () => {
    // 2000px of document, a 900px viewport, and a saved position four pages down.
    const env = fakeEnvironment(2000, 0, 0);
    let pages = 0;
    restoreScrollWhenReady(9000, {
      ...env.deps,
      advance: () => {
        pages += 1;
        env.setHeight(2000 + pages * 1000);
        return Promise.resolve(true);
      },
    });

    for (let step = 0; step < 24; step += 1) {
      env.setNow(step * 100);
      env.runNext();
      await Promise.resolve();
    }

    expect(pages).toBeGreaterThan(3);
    expect(env.scroll()).toBe(9000);
  });

  test("restores a reachable target and retries as appended pages raise the document", () => {
    const env = fakeEnvironment(5000);
    restoreScrollWhenReady(480, env.deps);

    expect(env.frames).toHaveLength(1);
    expect(env.runNext()).toBe(true);
    expect(env.scroll()).toBe(480);
    expect(env.frames.filter((frame) => !frame.cancelled)).toHaveLength(0);

    const growing = fakeEnvironment(3000);
    restoreScrollWhenReady(4000, growing.deps);
    expect(growing.runNext()).toBe(true);
    expect(growing.scroll()).toBe(2100);
    expect(growing.frames.filter((frame) => !frame.cancelled)).toHaveLength(1);

    growing.setHeight(6000);
    expect(growing.runNext()).toBe(true);
    expect(growing.scroll()).toBe(4000);
    expect(growing.frames.filter((frame) => !frame.cancelled)).toHaveLength(0);
  });

  test("stops once the document stops growing or the deadline passes", () => {
    const stalled = fakeEnvironment(3000);
    restoreScrollWhenReady(4000, stalled.deps);

    expect(stalled.runNext()).toBe(true);
    stalled.setNow(3000);
    expect(stalled.runNext()).toBe(true);
    expect(stalled.frames.filter((frame) => !frame.cancelled)).toHaveLength(0);

    const late = fakeEnvironment(3000);
    restoreScrollWhenReady(9000, late.deps);

    late.setNow(9000);
    expect(late.runNext()).toBe(true);
    expect(late.scroll()).toBe(2100);
    expect(late.frames.filter((frame) => !frame.cancelled)).toHaveLength(0);
  });

  test("cancelling and a zero target resolve without reaching the saved position", () => {
    const cancelled = fakeEnvironment(5000);
    const stop = restoreScrollWhenReady(480, cancelled.deps);
    stop();

    expect(cancelled.runNext()).toBe(false);
    expect(cancelled.scroll()).toBe(0);

    const top = fakeEnvironment(5000, 800);
    const noop = restoreScrollWhenReady(0, top.deps);
    expect(top.scroll()).toBe(0);
    expect(top.frames).toHaveLength(0);
    noop();
  });
});
