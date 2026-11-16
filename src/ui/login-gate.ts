/**
 * The panel shown when a route needs a signed-in account.
 *
 * ExHentai answers anonymous requests with the forum login wall, and the site's own tabs
 * (favorites, watched, settings) are useless without a session, so those routes render this instead
 * of an error.
 */

import { nativePageAction, statePanel } from "./state-panel";

/** The forum login form; the only sign-in surface both hosts share. */
export const LOGIN_HREF = "https://forums.e-hentai.org/index.php?act=Login&CODE=00";

interface LoginGateOptions {
  /** Heading for the panel. */
  title?: string;
  /** One line explaining what needs an account. */
  message?: string;
  /** Native page to open instead, when the route has one. */
  nativeHref?: string;
}

/** Build the signed-out panel for a gated route. */
export function loginGate(options: LoginGateOptions = {}): HTMLElement {
  return statePanel({
    title: options.title ?? "Sign in required",
    text: options.message ?? "This page reads your account, so it needs a signed-in session.",
    headingLevel: 1,
    actions: [
      { label: "Sign in", href: LOGIN_HREF, native: true, primary: true },
      ...(options.nativeHref === undefined ? [] : [nativePageAction(options.nativeHref)]),
    ],
  });
}
