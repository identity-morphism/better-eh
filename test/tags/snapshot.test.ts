import { describe, expect, test } from "bun:test";

import { createSnapshot } from "../../src/tags/snapshot";

describe("cached snapshots", () => {
  test("reads the cache once and serves it synchronously", () => {
    let reads = 0;
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 60_000,
      retryMs: 60_000,
      load: () => Promise.reject(new Error("unexpected download")),
      readCache: () => {
        reads++;
        return { value: 7, updated: 1_000 };
      },
      writeCache: () => undefined,
      onError: "throw",
    });

    expect(snapshot.get()).toBe(7);
    expect(snapshot.get()).toBe(7);
    expect(snapshot.updated()).toBe(1_000);
    expect(reads).toBe(1);
  });

  test("reads storage again when nothing was cached yet", () => {
    let stored: number | null = null;
    let reads = 0;
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 60_000,
      retryMs: 60_000,
      load: () => Promise.reject(new Error("unexpected download")),
      readCache: () => {
        reads++;
        return stored === null ? null : { value: stored, updated: 1_000 };
      },
      writeCache: () => undefined,
      onError: "throw",
    });

    expect(snapshot.get()).toBeNull();
    stored = 7;
    expect(snapshot.get()).toBe(7);
    expect(snapshot.updated()).toBe(1_000);
    expect(reads).toBe(2);
  });

  test("serves a fresh cache without downloading", async () => {
    let downloads = 0;
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 60_000,
      retryMs: 60_000,
      load: () => {
        downloads++;
        return Promise.resolve(2);
      },
      readCache: () => ({ value: 1, updated: Date.now() }),
      writeCache: () => undefined,
      onError: "throw",
    });

    await expect(snapshot.load()).resolves.toBe(1);
    expect(downloads).toBe(0);
  });

  test("serves a stale cache immediately and refreshes it in the background", async () => {
    const gate = Promise.withResolvers<number>();
    const stored = Promise.withResolvers<void>();
    const seen: number[] = [];
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 1_000,
      retryMs: 1_000,
      load: () => gate.promise,
      readCache: () => ({ value: 1, updated: 0 }),
      writeCache: () => {
        stored.resolve();
      },
      onError: "throw",
    });
    snapshot.onChange((value) => {
      seen.push(value);
    });

    await expect(snapshot.load()).resolves.toBe(1);

    gate.resolve(2);
    await stored.promise;

    expect(snapshot.get()).toBe(2);
    expect(snapshot.updated()).toBeGreaterThan(0);
    expect(seen).toEqual([2]);
  });

  test("suppresses another attempt inside the retry window", async () => {
    const gate = Promise.withResolvers<number>();
    const stored = Promise.withResolvers<void>();
    let downloads = 0;
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 0,
      retryMs: 60_000,
      load: () => {
        downloads++;
        return gate.promise;
      },
      readCache: () => ({ value: 1, updated: 0 }),
      writeCache: () => {
        stored.resolve();
      },
      onError: "throw",
    });

    await expect(snapshot.load()).resolves.toBe(1);
    gate.resolve(2);
    await stored.promise;

    await expect(snapshot.load()).resolves.toBe(2);
    expect(downloads).toBe(1);
  });

  test("shares one in-flight download", async () => {
    const gate = Promise.withResolvers<number>();
    let downloads = 0;
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 1_000,
      retryMs: 1_000,
      load: () => {
        downloads++;
        return gate.promise;
      },
      readCache: () => null,
      writeCache: () => undefined,
      onError: "throw",
    });

    const first = snapshot.load();
    const second = snapshot.load();

    expect(downloads).toBe(1);
    expect(second).toBe(first);

    gate.resolve(3);
    await expect(first).resolves.toBe(3);
    expect(snapshot.get()).toBe(3);
  });

  test("a forced load supersedes an in-flight one", async () => {
    const first = Promise.withResolvers<number>();
    const second = Promise.withResolvers<number>();
    const writes: number[] = [];
    let downloads = 0;
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 60_000,
      retryMs: 60_000,
      load: () => {
        downloads++;
        return downloads === 1 ? first.promise : second.promise;
      },
      readCache: () => null,
      writeCache: (value) => {
        writes.push(value);
      },
      onError: "throw",
    });

    const superseded = snapshot.load(true);
    const fresh = snapshot.load(true);

    second.resolve(2);
    await expect(fresh).resolves.toBe(2);

    first.resolve(1);
    await expect(superseded).resolves.toBe(2);
    expect(snapshot.get()).toBe(2);
    expect(writes).toEqual([2]);
  });

  test("attempts again after a failed download when nothing is cached", async () => {
    let downloads = 0;
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 1_000,
      retryMs: 60_000,
      load: () => {
        downloads++;
        return Promise.reject(new Error("mirrors down"));
      },
      readCache: () => null,
      writeCache: () => undefined,
      onError: "throw",
    });

    await expect(snapshot.load()).rejects.toThrow("mirrors down");
    await expect(snapshot.load()).rejects.toThrow("mirrors down");
    expect(downloads).toBe(2);
  });

  test("rejects with the download error when nothing is cached", async () => {
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 1_000,
      retryMs: 1_000,
      load: () => Promise.reject(new Error("mirrors down")),
      readCache: () => null,
      writeCache: () => undefined,
      onError: "throw",
    });

    await expect(snapshot.load()).rejects.toThrow("mirrors down");
    expect(snapshot.get()).toBeNull();
  });

  test("falls back to the cached value when the download fails", async () => {
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 1_000,
      retryMs: 1_000,
      load: () => Promise.reject(new Error("mirrors down")),
      readCache: () => ({ value: 4, updated: 0 }),
      writeCache: () => undefined,
      onError: "cached",
    });

    await expect(snapshot.load(true)).resolves.toBe(4);
    expect(snapshot.get()).toBe(4);
  });

  test("resolves null for a cached-policy failure with nothing cached", async () => {
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 1_000,
      retryMs: 1_000,
      load: () => Promise.reject(new Error("mirrors down")),
      readCache: () => null,
      writeCache: () => undefined,
      onError: "cached",
    });

    await expect(snapshot.load()).resolves.toBeNull();
  });

  test("publishes a rebound value and notifies listeners once", () => {
    const seen: number[] = [];
    const snapshot = createSnapshot<number>({
      label: "test",
      ttlMs: 60_000,
      retryMs: 60_000,
      load: () => Promise.resolve(2),
      readCache: () => ({ value: 1, updated: 1_000 }),
      writeCache: () => undefined,
      onError: "throw",
    });
    const stop = snapshot.onChange((value) => {
      seen.push(value);
    });

    snapshot.publish(5);
    stop();
    snapshot.publish(6);

    expect(snapshot.get()).toBe(6);
    expect(snapshot.updated()).toBe(1_000);
    expect(seen).toEqual([5]);
  });
});
