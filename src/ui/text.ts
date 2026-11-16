/** The noun form that matches `count`. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/** `count` followed by its matching noun, e.g. `3 votes` or `1 gallery`. */
export function countText(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${plural(count, singular, pluralForm)}`;
}
