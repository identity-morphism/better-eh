import appStyles from "../../.cache/app.css" with { type: "text" };
import viewerStyles from "../style.css" with { type: "text" };

/** Marks the manager-injected sheet so the shell can tell it from the site's own styles. */
const APP_STYLE_ATTRIBUTE = "data-better-eh";

/** Fallback marker for managers whose `GM_addStyle` returns no element to mark. */
const APP_STYLE_SENTINEL = "/* better-eh-style */";

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
  // Tampermonkey and Violentmonkey return the inserted element; other managers return nothing
  // despite the type, so the sentinel in the text lets the shell identify the sheet either way.
  const style = GM_addStyle(APP_STYLE_SENTINEL + viewerStyles + appStyles) as unknown as
    Element | undefined;
  if (style !== undefined) {
    style.setAttribute(APP_STYLE_ATTRIBUTE, "");
  }
}

/** True for the sheet `injectStyles` added, so a native-stylesheet sweep leaves it in place. */
export function isAppStyle(node: Element): boolean {
  return (
    node.getAttribute(APP_STYLE_ATTRIBUTE) !== null || node.textContent.includes(APP_STYLE_SENTINEL)
  );
}
