import type { DataSaverMode, ReaderMode, ReadingDirection } from "./types";

/**
 * One declaration of every scalar userscript preference.
 *
 * `ScalarSettings` is the typed half of `UserSettings`; the table below is the single source for
 * defaults, bounds, select options, and the panel's controls. The record type enumerates the
 * interface's keys, so a setting added to one without the other is a compile error. The keymap is
 * structured and edited separately.
 */

/** The values every scalar setting can hold; `UserSettings` adds the keymap. */
export interface ScalarSettings {
  fitHeight: boolean;
  debug: boolean;
  scrollStep: number;
  prefetchCount: number;
  maxNlRetry: number;
  imgCacheLimit: number;
  listThumbSize: number;
  galleryThumbSize: number;
  listInfiniteScroll: boolean;
  galleryInfiniteScroll: boolean;
  gap: number;
  netConcurrency: number;
  netIntervalMs: number;
  netTimeoutMs: number;
  tagSuggestions: boolean;
  dataSaver: DataSaverMode;
  readerMode: ReaderMode;
  readingDirection: ReadingDirection;
}

/** Every setting that holds one value; the keymap is the only structured setting. */
export type ScalarKey = keyof ScalarSettings;

type KeysOf<Value> = { [K in ScalarKey]: ScalarSettings[K] extends Value ? K : never }[ScalarKey];

/** Scalar keys whose value is a boolean. */
export type BooleanKey = KeysOf<boolean>;
/** Scalar keys whose value is a number. */
export type NumberKey = KeysOf<number>;
/** Scalar keys whose value is one of several fixed strings. */
export type SelectKey = KeysOf<string>;

interface BooleanField<K extends BooleanKey = BooleanKey> {
  control: "boolean";
  key: K;
  default: boolean;
  label: string;
  hint: string;
}

export interface NumberField<K extends NumberKey = NumberKey> {
  control: "number";
  key: K;
  default: number;
  min: number;
  max: number;
  label: string;
  hint: string;
}

interface SelectField<K extends SelectKey = SelectKey> {
  control: "select";
  key: K;
  default: ScalarSettings[K];
  label: string;
  hint: string;
  options: readonly { value: ScalarSettings[K]; label: string }[];
}

export type ScalarField = BooleanField | NumberField | SelectField;

type SchemaEntry<K extends ScalarKey> = K extends NumberKey
  ? NumberField<K>
  : K extends BooleanKey
    ? BooleanField<K>
    : K extends SelectKey
      ? SelectField<K>
      : never;

export const SETTINGS_SCHEMA: { readonly [K in ScalarKey]: SchemaEntry<K> } = {
  fitHeight: {
    control: "boolean",
    key: "fitHeight",
    default: true,
    label: "Fit image to the screen height",
    hint: "The viewer's default; F toggles it per page.",
  },
  debug: {
    control: "boolean",
    key: "debug",
    default: false,
    label: "Debug logging",
    hint: "Log requests and reader state to the console.",
  },
  scrollStep: {
    control: "number",
    key: "scrollStep",
    default: 220,
    min: 20,
    max: 5000,
    label: "Scroll step",
    hint: "Pixels moved by the natural-width scroll keys.",
  },
  prefetchCount: {
    control: "number",
    key: "prefetchCount",
    default: 2,
    min: 0,
    max: 10,
    label: "Prefetch depth",
    hint: "Pages warmed in each direction; 0 disables it. Needs two or more network slots.",
  },
  maxNlRetry: {
    control: "number",
    key: "maxNlRetry",
    default: 4,
    min: 0,
    max: 10,
    label: "Image retries",
    hint: "Attempts per image before the fallback view is shown.",
  },
  imgCacheLimit: {
    control: "number",
    key: "imgCacheLimit",
    default: 20,
    min: 1,
    max: 200,
    label: "Image cache",
    hint: "Decoded images kept in memory; keep at least twice the prefetch depth.",
  },
  listThumbSize: {
    control: "number",
    key: "listThumbSize",
    default: 220,
    min: 120,
    max: 480,
    label: "List thumbnail size",
    hint: "Target width of a feed card in pixels.",
  },
  galleryThumbSize: {
    control: "number",
    key: "galleryThumbSize",
    default: 200,
    min: 80,
    max: 400,
    label: "Gallery thumbnail size",
    hint: "Target width of a gallery thumbnail in pixels.",
  },
  listInfiniteScroll: {
    control: "boolean",
    key: "listInfiniteScroll",
    default: false,
    label: "Infinite scroll on feeds",
    hint: "Append the next listing page while scrolling.",
  },
  galleryInfiniteScroll: {
    control: "boolean",
    key: "galleryInfiniteScroll",
    default: false,
    label: "Infinite scroll in galleries",
    hint: "Append thumbnails while scrolling.",
  },
  gap: {
    control: "number",
    key: "gap",
    default: 12,
    min: 0,
    max: 64,
    label: "Grid gap",
    hint: "Space between cards and thumbnails.",
  },
  netConcurrency: {
    control: "number",
    key: "netConcurrency",
    default: 2,
    min: 1,
    max: 8,
    label: "Network concurrency",
    hint: "Requests allowed on the wire at once; prefetch only uses a spare slot.",
  },
  netIntervalMs: {
    control: "number",
    key: "netIntervalMs",
    default: 450,
    min: 0,
    max: 10_000,
    label: "Request interval",
    hint: "Minimum milliseconds between request starts.",
  },
  netTimeoutMs: {
    control: "number",
    key: "netTimeoutMs",
    default: 15_000,
    min: 1000,
    max: 120_000,
    label: "Request timeout",
    hint: "Milliseconds before a request is aborted.",
  },
  tagSuggestions: {
    control: "boolean",
    key: "tagSuggestions",
    default: true,
    label: "Tag suggestions",
    hint: "Show the tag combobox while typing in the search bar.",
  },
  dataSaver: {
    control: "select",
    key: "dataSaver",
    default: "auto",
    label: "Data saver",
    hint: "Skip the background vocabulary and page prefetch on Save-Data or 2G connections.",
    options: [
      { value: "auto", label: "Automatic" },
      { value: "on", label: "Always" },
      { value: "off", label: "Never" },
    ],
  },
  readerMode: {
    control: "select",
    key: "readerMode",
    default: "single",
    label: "Reader layout",
    hint: "Single page, facing pair, or a vertical stack.",
    options: [
      { value: "single", label: "Single page" },
      { value: "spread", label: "Spread (two pages)" },
      { value: "continuous", label: "Continuous scroll" },
    ],
  },
  readingDirection: {
    control: "select",
    key: "readingDirection",
    default: "ltr",
    label: "Page direction",
    hint: "Right-to-left mirrors spreads, click zones, and swipes.",
    options: [
      { value: "ltr", label: "Left to right" },
      { value: "rtl", label: "Right to left" },
    ],
  },
};

/** Schema keys in declaration order, which the panel groups by control. */
export const SCALAR_KEYS: readonly ScalarKey[] = Object.freeze(
  Object.keys(SETTINGS_SCHEMA) as ScalarKey[],
);

function fieldsOf(control: "boolean"): readonly BooleanField[];
function fieldsOf(control: "number"): readonly NumberField[];
function fieldsOf(control: "select"): readonly SelectField[];
function fieldsOf(control: ScalarField["control"]): readonly ScalarField[] {
  return SCALAR_KEYS.map((key) => SETTINGS_SCHEMA[key]).filter(
    (field) => field.control === control,
  );
}

export const BOOLEAN_FIELDS = fieldsOf("boolean");
export const NUMBER_FIELDS = fieldsOf("number");
export const SELECT_FIELDS = fieldsOf("select");

/** The scalar defaults, ready to spread into `DEFAULT_SETTINGS`. */
export function defaultScalars(): ScalarSettings {
  const defaults: Partial<Record<ScalarKey, ScalarSettings[ScalarKey]>> = {};
  for (const key of SCALAR_KEYS) {
    defaults[key] = SETTINGS_SCHEMA[key].default;
  }
  return defaults as ScalarSettings;
}

/** Round a numeric setting and keep it inside the schema's bounds. */
export function clampNumber(key: NumberKey, value: number): number {
  const field: NumberField = SETTINGS_SCHEMA[key];
  return Math.min(field.max, Math.max(field.min, Math.round(value)));
}

function optionList(options: readonly { value: string }[]): string {
  const values = options.map((option) => option.value);
  if (values.length <= 2) {
    return values.join(" or ");
  }
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

export type ScalarValidation<K extends ScalarKey = ScalarKey> =
  { ok: true; value: ScalarSettings[K] } | { ok: false; error: string };

/**
 * Check one incoming value against the schema.
 *
 * Numbers are rounded and clamped; a select value outside its options and a value of the wrong type
 * are rejected with a message the import dialog can show.
 */
export function validateScalar<K extends ScalarKey>(key: K, value: unknown): ScalarValidation<K> {
  const field: ScalarField = SETTINGS_SCHEMA[key];
  if (field.control === "boolean") {
    return typeof value === "boolean"
      ? { ok: true, value: value as ScalarSettings[K] }
      : { ok: false, error: `"${key}" must be true or false.` };
  }
  if (field.control === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? { ok: true, value: clampNumber(field.key, value) as ScalarSettings[K] }
      : { ok: false, error: `"${key}" must be a number.` };
  }
  const options: readonly { value: string }[] = field.options;
  return options.some((option) => option.value === value)
    ? { ok: true, value: value as ScalarSettings[K] }
    : { ok: false, error: `"${key}" must be ${optionList(options)}.` };
}

/** Validate `value` and write it onto `target`; invalid values leave `target` untouched. */
export function applyScalar<K extends ScalarKey>(
  target: Partial<ScalarSettings>,
  key: K,
  value: unknown,
): boolean {
  const result = validateScalar(key, value);
  if (!result.ok) {
    return false;
  }
  target[key] = result.value;
  return true;
}
