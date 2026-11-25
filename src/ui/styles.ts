import appStyles from "../../.cache/app.css" with { type: "text" };
import viewerStyles from "../style.css" with { type: "text" };

let injected = false;

/**
 * Inject both stylesheets once per document.
 *
 * The concatenation order below does not decide precedence — the cascade layers do. Every rule in
 * `.cache/app.css` sits in a Tailwind layer (`theme`, `base`, `components`, `utilities`), while
 * `src/style.css` is injected unlayered, and an unlayered declaration beats every layered one no
 * matter how specific the layered selector is. The reader sheet relies on that: it has to win over
 * the app's own components and utilities, and it must stay free of the pipeline that would put it
 * into a layer. It is not immune to the site's unlayered sheet, which wins specificity ties and,
 * being parsed later, order ties — which is why its rules are ID-rooted or scoped to a viewer body
 * class.
 */
export function injectStyles(): void {
  if (injected) {
    return;
  }
  injected = true;
  GM_addStyle(viewerStyles + appStyles);
}
