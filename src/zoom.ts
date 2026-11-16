import { isKey } from "./keymap";
import { getSettings } from "./settings";
import { showToast } from "./ui/toast";

/**
 * Zoom level at which a source image runs out of pixels.
 *
 * `displayed` and `natural` are in the same unit (CSS pixels vs source pixels): pass the rendered
 * size multiplied by the device pixel ratio so Retina screens ask for originals sooner.
 */
export function nativeZoomLimit(displayed: number, natural: number): number {
  return displayed > 0 && natural > 0 ? natural / displayed : Number.POSITIVE_INFINITY;
}

export class ZoomController {
  private zoomLevel = 1.0;
  private zoomSnapTimer: number | undefined;
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private hasMoved = false;

  private readonly container: HTMLElement;
  /** The element the current layout scales: the image, the spread, or the active stack page. */
  private readonly getSurface: () => HTMLElement;
  private readonly getFitHeight: () => boolean;
  private readonly onZoom: ((level: number) => void) | undefined;
  private surface: HTMLElement | null = null;

  constructor(
    container: HTMLElement,
    getSurface: () => HTMLElement,
    getFitHeight: () => boolean,
    signal: AbortSignal,
    onZoom?: (level: number) => void,
  ) {
    this.container = container;
    this.getSurface = getSurface;
    this.getFitHeight = getFitHeight;
    this.onZoom = onZoom;
    this.initEvents(signal);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(this.zoomSnapTimer);
        this.isDragging = false;
        this.surface?.classList.remove("no-transition");
        this.surface?.style.removeProperty("transform");
        this.surface = null;
        this.container.style.removeProperty("cursor");
      },
      { once: true },
    );
  }

  /** Follow a layout change without leaving a transform on an element that scrolled away. */
  private currentSurface(): HTMLElement {
    const next = this.getSurface();
    if (next !== this.surface) {
      this.surface?.style.removeProperty("transform");
      this.surface?.classList.remove("no-transition");
      this.surface = next;
    }
    return next;
  }

  private initEvents(signal: AbortSignal) {
    this.container.addEventListener("mousedown", (e) => this.onMouseDown(e), { signal });
    window.addEventListener("mousemove", (e) => this.onMouseMove(e), { signal });
    window.addEventListener("mouseup", () => this.onMouseUp(), { signal });

    window.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          this.updateZoom(e.deltaY < 0 ? 0.1 : -0.1, this.getFitHeight());
        }
      },
      { passive: false, signal },
    );
  }

  private updateTransform() {
    const surface = this.currentSurface();
    const imgWidth = surface.clientWidth;
    const imgHeight = surface.clientHeight;
    const scaledWidth = imgWidth * this.zoomLevel;
    const scaledHeight = imgHeight * this.zoomLevel;

    const limitX = Math.max(0, (scaledWidth - window.innerWidth) / 2);
    const limitY = Math.max(0, (scaledHeight - window.innerHeight) / 2);

    this.panX = Math.max(-limitX, Math.min(this.panX, limitX));
    this.panY = Math.max(-limitY, Math.min(this.panY, limitY));

    surface.style.transform =
      this.zoomLevel === 1.0 && this.panX === 0 && this.panY === 0
        ? ""
        : `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
  }

  public updateZoom(delta: number | null, isFitHeight: boolean): void {
    if (delta === null) {
      this.reset();
    } else if (!isFitHeight) {
      showToast("Press F to switch to fit-height before zooming");
      return;
    } else {
      this.zoomLevel = Math.max(0.7, Math.min(5.0, this.zoomLevel + delta));
      this.updateTransform();
      this.onZoom?.(this.zoomLevel);
      showToast(`Zoom ${Math.round(this.zoomLevel * 100)}%`);
    }

    clearTimeout(this.zoomSnapTimer);
    if (this.zoomLevel < 1.0) {
      this.zoomSnapTimer = window.setTimeout(() => {
        this.reset();
        showToast("Zoom 100%");
      }, 200);
    }
  }

  public reset() {
    clearTimeout(this.zoomSnapTimer);
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.hasMoved = false;
    this.updateTransform();
    this.onZoom?.(this.zoomLevel);
  }

  /** Current continuous zoom level, where 1 is the fitted size. */
  public getZoomLevel(): number {
    return this.zoomLevel;
  }

  /**
   * Apply a continuous level for a touch pinch.
   *
   * Pinching starts at the fitted size, so the range is 1–5 rather than the keyboard's 0.7 floor;
   * the normal snap timer must not reset a pinch that is still moving.
   */
  public setZoom(level: number, isFitHeight: boolean): void {
    if (!isFitHeight) {
      return;
    }
    clearTimeout(this.zoomSnapTimer);
    this.zoomLevel = Math.max(1, Math.min(5, level));
    this.updateTransform();
    this.onZoom?.(this.zoomLevel);
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0 || !this.getFitHeight()) {
      return;
    }
    if (e.target instanceof Element && e.target.closest("#hud, #page-info")) {
      return;
    }

    e.preventDefault();
    if (this.zoomLevel > 1.0) {
      this.isDragging = true;
      this.hasMoved = false;
      this.startX = e.clientX - this.panX;
      this.startY = e.clientY - this.panY;
      this.container.style.cursor = "grabbing";
      this.currentSurface().classList.add("no-transition");
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (this.isDragging) {
      const newPanX = e.clientX - this.startX;
      const newPanY = e.clientY - this.startY;
      if (Math.abs(newPanX - this.panX) > 2 || Math.abs(newPanY - this.panY) > 2) {
        this.hasMoved = true;
      }
      this.panX = newPanX;
      this.panY = newPanY;
      this.updateTransform();
    }
  }

  private onMouseUp() {
    if (this.isDragging) {
      this.isDragging = false;
      this.container.style.removeProperty("cursor");
      this.surface?.classList.remove("no-transition");
    }
  }

  public handleKey(e: KeyboardEvent, isFitHeight: boolean): boolean {
    if (isFitHeight && this.zoomLevel > 1.0) {
      if (isKey(e, "up")) {
        this.panY += getSettings().scrollStep;
        this.updateTransform();
        return true;
      }
      if (isKey(e, "down")) {
        this.panY -= getSettings().scrollStep;
        this.updateTransform();
        return true;
      }
    }
    return false;
  }

  /** Move a zoomed touch surface by the pointer delta, clamped like mouse dragging. */
  public panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.updateTransform();
  }

  /** True once after a drag, so the click that ends it does not also turn a page. */
  public consumePanned(): boolean {
    const panned = this.hasMoved;
    this.hasMoved = false;
    return panned;
  }
}
