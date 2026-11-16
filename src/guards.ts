/** Shape guards shared by the persistence modules. */

/** A non-null, non-array object, the shape every stored record is checked against. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An array whose element type is still unknown. */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
