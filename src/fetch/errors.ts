/** The request was superseded; no error is due. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

/** The server answered with a non-2xx status. */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

/** The site served its login wall (sad panda) instead of the page. */
export class LoginRequiredError extends Error {
  constructor() {
    super("Login required");
    this.name = "LoginRequiredError";
  }
}

/** The site throttled us; `text` carries the notice it answered with. */
export class RateLimitedError extends Error {
  readonly text: string;

  constructor(text: string) {
    super("Rate limited");
    this.name = "RateLimitedError";
    this.text = text;
  }
}

/**
 * The request queue dropped a queued request after a throttle notice.
 *
 * This is deliberately not an `AbortError`: a purge is a real failure the view must report, while
 * an `AbortError` means the caller superseded the request and no error is due.
 */
export class RequestPurgedError extends Error {
  constructor() {
    super("Request purged");
    this.name = "RequestPurgedError";
  }
}
