/** Replace rAF with a queue the test drains explicitly. */
export interface FrameQueue {
  readonly pending: Map<number, FrameRequestCallback>;
  run(): void;
  restore(): void;
}

export function installFrameQueue(): FrameQueue {
  const pending = new Map<number, FrameRequestCallback>();
  const originalFrame = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let nextId = 0;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    nextId += 1;
    pending.set(nextId, callback);
    return nextId;
  };
  globalThis.cancelAnimationFrame = (id: number): void => {
    pending.delete(id);
  };
  return {
    pending,
    run(): void {
      for (const [id, callback] of [...pending]) {
        pending.delete(id);
        callback(0);
      }
    },
    restore(): void {
      globalThis.requestAnimationFrame = originalFrame;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}
