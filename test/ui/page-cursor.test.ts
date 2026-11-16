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
  test("is already done when there is no first page", async () => {
    let calls = 0;
    const cursor = createPageCursor<string>({
      next: null,
      key: (value) => value,
      signal: new AbortController().signal,
      load: () => {
        calls++;
        return Promise.resolve({ items: ["a"], next: null });
      },
    });

    expect(cursor.state().done).toBe(true);
    expect(await cursor.loadNext()).toBeNull();
    expect(calls).toBe(0);
  });

  test("deduplicates items across overlapping pages", async () => {
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

  test("ends when a page points at itself", async () => {
    let calls = 0;
    const cursor = createPageCursor<string>({
      next: "/same",
      key: (value) => value,
      signal: new AbortController().signal,
      load: () => {
        calls++;
        return Promise.resolve({ items: ["a"], next: "/same" });
      },
    });

    expect(await cursor.loadNext()).toEqual(["a"]);
    expect(cursor.state().done).toBe(true);
    expect(cursor.state().looped).toBe(true);
    expect(await cursor.loadNext()).toBeNull();
    expect(calls).toBe(1);
  });

  test("ends when a page points back at an already-fetched page", async () => {
    let calls = 0;
    const cursor = createPageCursor<string>({
      next: "/p1",
      key: (value) => value,
      signal: new AbortController().signal,
      load: (url) => {
        calls++;
        return Promise.resolve({ items: [url], next: url === "/p1" ? "/p2" : "/p1" });
      },
    });

    expect(await cursor.loadNext()).toEqual(["/p1"]);
    expect(cursor.state().done).toBe(false);
    expect(await cursor.loadNext()).toEqual(["/p2"]);
    expect(cursor.state().done).toBe(true);
    expect(cursor.state().looped).toBe(true);
    expect(await cursor.loadNext()).toBeNull();
    expect(calls).toBe(2);
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

  test("keeps the cursor after a failure and retries the same page", async () => {
    let calls = 0;
    const cursor = createPageCursor<string>({
      next: "/p2",
      key: (value) => value,
      signal: new AbortController().signal,
      load: () => {
        calls++;
        return calls === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ items: ["b"], next: null });
      },
    });

    expect(await cursor.loadNext()).toBeNull();
    expect(cursor.state().failed).toBe(true);
    expect(cursor.state().done).toBe(false);

    expect(await cursor.loadNext()).toBeNull();
    expect(calls).toBe(1);

    cursor.retry();
    expect(cursor.state().failed).toBe(false);
    expect(await cursor.loadNext()).toEqual(["b"]);
    expect(cursor.state().done).toBe(true);
    expect(calls).toBe(2);
  });

  test("does nothing once its signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const cursor = createPageCursor<string>({
      next: "/p2",
      key: (value) => value,
      signal: controller.signal,
      load: () => {
        calls++;
        return Promise.resolve({ items: ["a"], next: null });
      },
    });

    expect(await cursor.loadNext()).toBeNull();
    expect(calls).toBe(0);
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

  test("refuses loads after stop()", async () => {
    let calls = 0;
    const cursor = createPageCursor<string>({
      next: "/p2",
      key: (value) => value,
      signal: new AbortController().signal,
      load: () => {
        calls++;
        return Promise.resolve({ items: ["a"], next: null });
      },
    });

    cursor.stop();
    expect(await cursor.loadNext()).toBeNull();
    expect(calls).toBe(0);
  });
});
