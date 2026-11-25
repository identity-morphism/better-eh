/** The site's signed-in session, as its cookies expose it. */

/** Member id of the signed-in account, or null when the site has no session cookie. */
export function memberId(): string | null {
  return /(?:^|; )ipb_member_id=(\d+)/.exec(document.cookie)?.[1] ?? null;
}

/** Whether the tab carries a signed-in session. */
export function isLoggedIn(): boolean {
  return memberId() !== null;
}
