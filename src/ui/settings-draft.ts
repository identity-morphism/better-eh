/**
 * The one draft engine behind the settings form.
 *
 * A control joins the draft by exposing a binding: a stable key, a read of its current value and a
 * write of a baseline value back into the control. The engine owns the snapshot taken when the
 * draft is created, so dirty comparison, Reset and the rebase after a successful save all have one
 * implementation. The site's uconfig form and the userscript panel bind into the same instance in
 * the settings view; the panel also keeps its own instance for standalone use.
 */

/**
 * One control's draft interface. Both halves of the settings page compose these, so a control only
 * needs to know how to read itself and how to restore a value.
 */
export interface DraftBinding<T = unknown> {
  /** Unique within a draft. */
  readonly key: string;
  read(): T;
  /** Restore a baseline value without dispatching DOM events. */
  write(value: T): void;
  /** Compare a current value with the baseline; `Object.is` when omitted. */
  equals?(a: T, b: T): boolean;
}

interface SettingsDraftOptions {
  bindings: readonly DraftBinding[];
  /** Called after reset and rebase, once the controls have been repainted. */
  onChange?: () => void;
}

interface SettingsDraft {
  /** Whether any binding differs from the baseline. */
  isDirty(): boolean;
  /** The current values that differ from the baseline. */
  changed(): Map<string, unknown>;
  /** Write the baseline back through the bindings. */
  reset(): void;
  /** Capture the controls' current values as the new baseline. */
  rebase(): void;
}

export function createSettingsDraft({ bindings, onChange }: SettingsDraftOptions): SettingsDraft {
  const baseline = new Map<string, unknown>();

  const changed = (): Map<string, unknown> => {
    const current = new Map<string, unknown>();
    for (const binding of bindings) {
      const value = binding.read();
      if (baseline.has(binding.key)) {
        const previous = baseline.get(binding.key);
        const same = binding.equals ? binding.equals(value, previous) : Object.is(value, previous);
        if (same) {
          continue;
        }
      }
      current.set(binding.key, value);
    }
    return current;
  };

  const capture = (): void => {
    baseline.clear();
    for (const binding of bindings) {
      baseline.set(binding.key, binding.read());
    }
  };

  const draft: SettingsDraft = {
    isDirty: () => changed().size > 0,
    changed,
    reset: () => {
      for (const binding of bindings) {
        if (baseline.has(binding.key)) {
          binding.write(baseline.get(binding.key));
        }
      }
      onChange?.();
    },
    rebase: () => {
      capture();
      onChange?.();
    },
  };

  capture();
  return draft;
}
