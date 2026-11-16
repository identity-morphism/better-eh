/**
 * Anchored panel geometry.
 *
 * Every floating panel in the app measures the same three things before it opens: the room below
 * its anchor, the room above it and the space on either side. Keeping that math in one place is
 * what makes a keyboard-shrunk viewport behave the same everywhere: `innerHeight` ignores the
 * on-screen keyboard, `visualViewport` does not. The panel itself lives in the top layer, so this
 * module only ever sets `left`/`right`, `top`/`bottom`, `width` and the height cap.
 */

/** Gap between a panel and the viewport edge. */
const PANEL_MARGIN = 8;

/** Default gap between an anchor and its panel. */
const ANCHOR_GAP = 6;

interface PanelFit {
  /** Height a panel is squeezed to before it stops shrinking. */
  floor: number;
}

interface Placement {
  /** Element the panel hangs off; `null` centres the panel in the viewport. */
  anchor: HTMLElement | null;
  /** Anchor edge the panel lines up with. */
  align?: "start" | "end";
  /** Space between the anchor and the panel. */
  gap?: number;
  /** Grow the panel to at least the anchor's width and at least this many pixels. */
  minWidth?: number;
  /** Height bounds for the side the panel opens on. */
  fit?: PanelFit;
}

interface Viewport {
  width: number;
  height: number;
  top: number;
  left: number;
}

interface Size {
  width: number;
  height: number;
}

function viewport(): Viewport {
  if (typeof window === "undefined") {
    return { width: 0, height: 0, top: 0, left: 0 };
  }
  const visual = window.visualViewport;
  if (visual && visual.height > 0) {
    return {
      width: visual.width,
      height: visual.height,
      top: visual.offsetTop,
      left: visual.offsetLeft,
    };
  }
  return { width: window.innerWidth || 0, height: window.innerHeight || 0, top: 0, left: 0 };
}

function boxSize(node: HTMLElement): Size {
  const rect = node.getBoundingClientRect();
  return {
    width: node.offsetWidth || rect.width || 0,
    height: node.offsetHeight || rect.height || 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Place `panel` against its anchor and cap its height to the room beside it.
 *
 * The panel must already be in the document and laid out: its own box decides whether it fits below
 * the anchor. Callers that resize their content call this again.
 */
export function placePanel(panel: HTMLElement, placement: Placement): void {
  const view = viewport();
  const { anchor } = placement;
  const gap = placement.gap ?? ANCHOR_GAP;
  // The top layer's own `inset: 0` would pin the panel to both edges; `left` alone drives the pair.
  panel.style.right = "auto";

  if (anchor === null) {
    const size = boxSize(panel);
    const left = view.width > 0 ? (view.width - size.width) / 2 + view.left : 0;
    const top = view.height > 0 ? (view.height - size.height) / 2 + view.top : 0;
    panel.style.left = `${Math.round(Math.max(view.left + PANEL_MARGIN, left))}px`;
    panel.style.top = `${Math.round(Math.max(view.top + PANEL_MARGIN, top))}px`;
    panel.style.maxHeight = view.height > 0 ? `${view.height - PANEL_MARGIN * 2}px` : "";
    return;
  }

  const rect = anchor.getBoundingClientRect();
  const natural = boxSize(panel);
  const width =
    placement.minWidth === undefined
      ? natural.width
      : Math.min(
          Math.max(rect.width, placement.minWidth),
          Math.max(240, view.width - PANEL_MARGIN * 2),
        );
  if (placement.minWidth !== undefined) {
    panel.style.width = `${Math.round(width)}px`;
  }

  const rawLeft = placement.align === "end" ? rect.right - width : rect.left;
  const left =
    view.width > 0
      ? clamp(rawLeft, view.left + PANEL_MARGIN, view.left + view.width - width - PANEL_MARGIN)
      : rawLeft;
  panel.style.left = `${Math.round(left)}px`;

  const below = view.height > 0 ? view.top + view.height - rect.bottom - PANEL_MARGIN : 0;
  const above = view.height > 0 ? rect.top - view.top - PANEL_MARGIN : 0;
  const needed = natural.height + gap;
  const openBelow = view.height === 0 || needed <= below || below >= above;
  const room = openBelow ? below : above;
  const maxHeight = room > 0 ? Math.max(placement.fit?.floor ?? 0, room - gap) : 0;

  panel.style.maxHeight = maxHeight > 0 ? `${Math.round(maxHeight)}px` : "";
  if (openBelow) {
    panel.style.top = `${Math.round(rect.bottom + gap)}px`;
    panel.style.bottom = "auto";
  } else {
    // Pin the bottom edge rather than deriving a top: the panel's height is content-sized.
    panel.style.top = "auto";
    panel.style.bottom = `${Math.round(view.top + view.height - rect.top + gap)}px`;
  }
}
