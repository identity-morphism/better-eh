import { RequestPurgedError } from "../fetch/errors";
import { getSettings } from "../settings";
import type { Priority } from "./priority";
import { priorityOf } from "./priority";

interface Task {
  url: string;
  init: RequestInit;
  priority: Priority;
  tag: string;
  seq: number;
  controller: AbortController;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
  detach: (() => void) | null;
}

interface RequestOptions {
  init?: RequestInit;
  priority?: Priority;
  tag?: string;
  /** Drops a queued request at once; aborts a request already on the wire. */
  signal?: AbortSignal;
}

/** Priority-aware request scheduler with concurrency and interval limits. */
export class RequestQueue {
  private readonly pending: Task[] = [];
  private active = 0;
  private lastStart = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  /** Requests currently on the wire, excluding queued work. */
  get activeCount(): number {
    return this.active;
  }

  fetch(url: string, options: RequestOptions = {}): Promise<Response> {
    const { promise, resolve, reject } = Promise.withResolvers<Response>();
    const controller = new AbortController();
    const userSignal = options.signal;

    const task: Task = {
      url,
      init: options.init ?? {},
      priority: options.priority ?? priorityOf("background"),
      tag: options.tag ?? "default",
      seq: this.seq++,
      controller,
      resolve,
      reject,
      detach: null,
    };

    if (userSignal) {
      if (userSignal.aborted) {
        reject(userSignal.reason);
        return promise;
      }
      const onAbort = (): void => {
        const index = this.pending.indexOf(task);
        if (index === -1) {
          // Already started (or settled): the transport sees the abort and `run` cleans up.
          controller.abort(userSignal.reason);
          return;
        }
        // Still queued: drop it here. Leaving it in the queue would burn a concurrency slot and
        // the start interval on a request nobody is waiting for, which is how a burst of
        // canceled prefetches used to stall the pages the reader actually asked for.
        this.pending.splice(index, 1);
        this.finish(task);
        reject(userSignal.reason);
      };
      userSignal.addEventListener("abort", onAbort, { once: true });
      task.detach = () => {
        userSignal.removeEventListener("abort", onAbort);
      };
    }

    this.pending.push(task);
    this.pending.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    this.pump();
    return promise;
  }

  /**
   * Drop queued work the predicate selects; a purged request rejects with `RequestPurgedError`.
   *
   * The payload includes `priority`, so a caller can spare work the reader is waiting on without
   * relying on every producer to agree on a tag.
   */
  purge(predicate: (task: { url: string; tag: string; priority: Priority }) => boolean): void {
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const task = this.pending[index];
      if (!task || !predicate(task)) {
        continue;
      }
      this.pending.splice(index, 1);
      this.finish(task);
      task.reject(new RequestPurgedError());
    }
  }

  private pump(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const concurrency = Math.max(1, getSettings().netConcurrency);
    while (this.active < concurrency) {
      const task = this.pending.shift();
      if (!task) {
        return;
      }

      const now = Date.now();
      const wait = this.lastStart + getSettings().netIntervalMs - now;
      if (wait > 0) {
        this.pending.unshift(task);
        this.timer = setTimeout(() => {
          this.pump();
        }, wait);
        return;
      }

      this.active++;
      this.lastStart = now;
      void this.run(task);
    }
  }

  private async run(task: Task): Promise<void> {
    const timeout = setTimeout(
      () => {
        task.controller.abort(new DOMException("Request timed out", "TimeoutError"));
      },
      Math.max(1000, getSettings().netTimeoutMs),
    );

    try {
      const response = await fetch(task.url, {
        ...task.init,
        signal: task.controller.signal,
      });
      task.resolve(response);
    } catch (error) {
      task.reject(error);
    } finally {
      clearTimeout(timeout);
      this.active--;
      this.finish(task);
      this.pump();
    }
  }

  private finish(task: Task): void {
    task.detach?.();
    task.detach = null;
  }
}

export const net = new RequestQueue();
