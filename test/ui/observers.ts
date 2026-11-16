import { flushMicrotasks } from "./async";

/** Minimal IntersectionObserver: tests fire intersections by hand. */
export class TestObserver {
  static instances: TestObserver[] = [];

  readonly callback: IntersectionObserverCallback;
  readonly targets = new Set<Element>();
  readonly rootMargin: string | undefined;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin;
    TestObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  trigger(target: Element): void {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

/** Install the hand-driven observer and reset the instance log between tests. */
export function installTestObservers(): void {
  TestObserver.instances = [];
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = TestObserver;
}

export function lastObserver(): TestObserver {
  const observer = TestObserver.instances.at(-1);
  if (!observer) {
    throw new Error("no observer was created");
  }
  return observer;
}

/** Drain the promise chain behind a fetch without involving the clock. */
export function settle(): Promise<void> {
  return flushMicrotasks(10);
}
