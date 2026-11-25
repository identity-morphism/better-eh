import { describe, expect, test } from "bun:test";

import type { CursorPage } from "../../src/ui/page-cursor";
import { createPageCursor } from "../../src/ui/page-cursor";
import { deferred } from "./async";

function pages(entries: Record<string, CursorPage<string>>): {
  calls: string[];
  load: (url: string) => Promise<CursorPage<string>>;
} {
  const calls: string[] = [];
  return {
    calls,
    load: (url) => {
      calls.push(url);
      return Promise.resolve(entries[url] ?? { items: [], next: null });
    },
  };
}

describe("createPageCursor", () => {
  test("deduplicates items across overlapping pages and stops at the end", async () => {
    const source = pages({
      "/p2": { items: ["a", "b"], next: "/p3" },
      "/p3": { items: ["b", "c"], next: null },
    });
    const cursor = createPageCursor<string>({
      next: "/p2",
      key: (value) => value,
      initialKeys: ["a"],
      signal: new AbortController().signal,
      load: source.load,
    });

    expect(await cursor.loadNext()).toEqual(["b"]);
    expect(cursor.state().done).toBe(false);
    expect(await cursor.loadNext()).toEqual(["c"]);
    expect(cursor.state().done).toBe(true);
    expect(await cursor.loadNext()).toBeNull();
    expect(source.calls).toEqual(["/p2", "/p3"]);
  });

  test("ends when a page points at itself or back at an already-fetched page", async () => {
    let selfCalls = 0;
    const self = createPageCursor<string>({
      next: "/same",
      key: (value) => value,
      signal: new AbortController().signal,
      load: () => {
        selfCalls++;
        return Promise.resolve({ items: ["a"], next: "/same" });
      },
    });

    expect(await self.loadNext()).toEqual(["a"]);
    expect(self.state().done).toBe(true);
    expect(self.state().looped).toBe(true);
    expect(await self.loadNext()).toBeNull();
    expect(selfCalls).toBe(1);

    let backCalls = 0;
    const back = createPageCursor<string>({
      next: "/p1",
      key: (value) => value,
      signal: new AbortController().signal,
      load: (url) => {
        backCalls++;
        return Promise.resolve({ items: [url], next: url === "/p1" ? "/p2" : "/p1" });
      },
    });

    expect(await back.loadNext()).toEqual(["/p1"]);
    expect(await back.loadNext()).toEqual(["/p2"]);
    expect(back.state().looped).toBe(true);
    expect(await back.loadNext()).toBeNull();
    expect(backCalls).toBe(2);
  });

  test("joins concurrent loads into one request", async () => {
    const pending = deferred<CursorPage<string>>();
    let calls = 0;
    const cursor = createPageCursor<string>({
      next: "/p2",
      key: (value) => value,
      signal: new AbortController().signal,
      load: () => {
        calls++;
        return pending.promise;
      },
    });

    const first = cursor.loadNext();
    const second = cursor.loadNext();
    expect(cursor.state().loading).toBe(true);
    expect(calls).toBe(1);

    pending.resolve({ items: ["a"], next: null });
    expect(await first).toEqual(["a"]);
    expect(await second).toEqual(["a"]);
    expect(cursor.state().loading).toBe(false);
    expect(cursor.state().done).toBe(true);
    expect(calls).toBe(1);
  });

  test("does nothing once aborted or stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    let abortedCalls = 0;
    const aborted = createPageCursor<string>({
      next: "/p2",
      key: (value) => value,
      signal: controller.signal,
      load: () => {
        abortedCalls++;
        return Promise.resolve({ items: ["a"], next: null });
      },
    });

    expect(await aborted.loadNext()).toBeNull();
    expect(abortedCalls).toBe(0);

    let stoppedCalls = 0;
    const stopped = createPageCursor<string>({
      next: "/p2",
      key: (value) => value,
      signal: new AbortController().signal,
      load: () => {
        stoppedCalls++;
        return Promise.resolve({ items: ["a"], next: null });
      },
    });
    stopped.stop();

    expect(await stopped.loadNext()).toBeNull();
    expect(stoppedCalls).toBe(0);
  });

  test("aborts the in-flight request and ignores its late page", async () => {
    const controller = new AbortController();
    const pending = deferred<CursorPage<string>>();
    const signals: AbortSignal[] = [];
    const cursor = createPageCursor<string>({
      next: "/p2",
      key: (value) => value,
      signal: controller.signal,
      load: (_url, signal) => {
        signals.push(signal);
        return pending.promise;
      },
    });

    const loading = cursor.loadNext();
    expect(cursor.state().loading).toBe(true);
    controller.abort();
    expect(signals[0]?.aborted).toBe(true);

    pending.resolve({ items: ["a"], next: null });
    expect(await loading).toBeNull();
    expect(cursor.state().loading).toBe(false);
    expect(cursor.state().failed).toBe(false);
    expect(cursor.state().done).toBe(false);
    expect(await cursor.loadNext()).toBeNull();
  });
});
