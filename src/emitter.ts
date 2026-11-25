/**
 * The one listener contract behind in-app change notifications.
 *
 * Every surface that repaints after a write — settings, quick tags, the search draft, a favorites
 * selection, a cached snapshot — needs the same three mechanics: a listener set, an unsubscribe
 * function, and a notify loop. Owning them once keeps iteration and teardown identical instead of
 * five near-copies drifting apart.
 */

export type Unsubscribe = () => void;

export interface Emitter<T> {
  /** Observe changes; returns the function that stops observing. */
  subscribe(listener: (value: T) => void): Unsubscribe;
  /** Notify every current listener, in subscription order. */
  emit(value: T): void;
}

export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(value: T) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(value) {
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
}
