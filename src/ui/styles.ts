import appStyles from "../../.cache/app.css" with { type: "text" };
import viewerStyles from "../style.css" with { type: "text" };

let injected = false;

/** Inject the shared stylesheet once per document. */
export function injectStyles(): void {
  if (injected) {
    return;
  }
  injected = true;
  GM_addStyle(viewerStyles + appStyles);
}
