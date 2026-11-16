/** A promise whose settlement the test controls. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  return Promise.withResolvers<T>();
}

/** Await a call that must fail, returning its error instead of failing the test on the throw. */
export async function failure(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to fail");
}

/** Drain pending promise continuations without involving the clock. */
export async function flushMicrotasks(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await Promise.resolve();
  }
}

/** Flush promise continuations until `ready` holds, without binding the test to a clock. */
export async function until(ready: () => boolean, turns = 500): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    if (ready()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("the asynchronous flow never reached its observable state");
}
