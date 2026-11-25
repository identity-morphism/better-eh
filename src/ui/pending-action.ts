import { errorText } from "./error-text";

/**
 * One mutation's inputs: the request, how the control marks itself busy, what a success and a
 * failure paint, and where focus goes when a failure replaced the control's content.
 */
export interface PendingActionHooks<R> {
  /** The request. Its rejection is reported through `failed`. */
  run: () => Promise<R>;
  /** View lifetime; a result or failure that lands after abort is dropped. */
  signal: AbortSignal;
  /** Mark the control(s) busy before the request and clear them in every settlement. */
  setBusy?: (busy: boolean) => void;
  /** Paint the accepted result. Runs only when the request was not aborted. */
  success?: (result: R) => void;
  /** Fallback when the rejection is not an `Error`. */
  failure?: string;
  /** Paint the failure message. Runs only when the request was not aborted. */
  failed?: (message: string) => void;
  /** Focus target after a failure, once busy is cleared. */
  recover?: () => HTMLElement | null;
}

export interface PendingAction {
  /** True while one request is in flight. */
  readonly busy: boolean;
  /** Run `hooks`; false when one is already running, the request failed, or the view aborted. */
  run<R>(hooks: PendingActionHooks<R>): Promise<boolean>;
}

/**
 * The one mutation protocol: in-flight guard, busy marking, abort check, result/error paint and
 * focus restore. Controls supply their own attempt, paints and focus target; the ordering is not
 * repeated beside every button.
 */
export function createPendingAction(): PendingAction {
  let running = false;

  return {
    get busy() {
      return running;
    },

    async run<R>(hooks: PendingActionHooks<R>): Promise<boolean> {
      if (running) {
        return false;
      }
      running = true;
      hooks.setBusy?.(true);

      let recover = false;
      try {
        let result: R;
        try {
          result = await hooks.run();
        } catch (error) {
          if (hooks.signal.aborted) {
            return false;
          }
          hooks.failed?.(errorText(error, hooks.failure ?? "The action failed."));
          recover = true;
          return false;
        }
        if (hooks.signal.aborted) {
          return false;
        }
        hooks.success?.(result);
        return true;
      } finally {
        running = false;
        hooks.setBusy?.(false);
        if (recover) {
          hooks.recover?.()?.focus();
        }
      }
    },
  };
}
