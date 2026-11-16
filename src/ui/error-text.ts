/** Message to show for a rejected action, preferring the request's own explanation. */
export function errorText(error: unknown, fallback = "Something went wrong."): string {
  return error instanceof Error ? error.message : fallback;
}
