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
  test("restores a reachable target in one frame", () => {
    const env = fakeEnvironment(5000);
    restoreScrollWhenReady(480, env.deps);

    expect(env.frames).toHaveLength(1);
    expect(env.runNext()).toBe(true);
    expect(env.scroll()).toBe(480);
    expect(env.frames.filter((frame) => !frame.cancelled)).toHaveLength(0);
  });

  test("retries after appended pages raise the document", () => {
    const env = fakeEnvironment(3000);
    restoreScrollWhenReady(4000, env.deps);

    expect(env.runNext()).toBe(true);
    expect(env.scroll()).toBe(2100);
    expect(env.frames.filter((frame) => !frame.cancelled)).toHaveLength(1);

    env.setHeight(6000);
    expect(env.runNext()).toBe(true);
    expect(env.scroll()).toBe(4000);
    expect(env.frames.filter((frame) => !frame.cancelled)).toHaveLength(0);
  });

  test("stops once the document stops growing", () => {
    const env = fakeEnvironment(3000);
    restoreScrollWhenReady(4000, env.deps);

    expect(env.runNext()).toBe(true);
    env.setNow(3000);
    expect(env.runNext()).toBe(true);
    expect(env.frames.filter((frame) => !frame.cancelled)).toHaveLength(0);
  });

  test("stops at the deadline when the target never becomes reachable", () => {
    const env = fakeEnvironment(3000);
    restoreScrollWhenReady(9000, env.deps);

    env.setNow(9000);
    expect(env.runNext()).toBe(true);
    expect(env.scroll()).toBe(2100);
    expect(env.frames.filter((frame) => !frame.cancelled)).toHaveLength(0);
  });

  test("cancelling prevents the pending frame from running", () => {
    const env = fakeEnvironment(5000);
    const stop = restoreScrollWhenReady(480, env.deps);
    stop();

    expect(env.runNext()).toBe(false);
    expect(env.scroll()).toBe(0);
  });

  test("a zero target scrolls immediately", () => {
    const env = fakeEnvironment(5000, 800);
    const stop = restoreScrollWhenReady(0, env.deps);

    expect(env.scroll()).toBe(0);
    expect(env.frames).toHaveLength(0);
    stop();
  });
});
