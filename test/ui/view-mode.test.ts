import { beforeEach, describe, expect, test } from "bun:test";

import { applyViewMode, resetViewMode, setCursorHidden } from "../../src/view-mode";
import { installDom } from "./dom";

const VIEW_CLASSES = [
  "eh-viewer",
  "fit-h",
  "fit-w",
  "reader-spread",
  "reader-continuous",
  "reader-rtl",
  "no-cursor",
] as const;

type ViewClass = (typeof VIEW_CLASSES)[number];
type ViewModeState = Parameters<typeof applyViewMode>[0];

function viewMode(overrides: Partial<ViewModeState> = {}): ViewModeState {
  return {
    viewer: true,
    fitHeight: true,
    cursorHidden: false,
    readerMode: "single",
    readingDirection: "ltr",
    ...overrides,
  };
}

function expectClasses(expected: readonly ViewClass[]): void {
  for (const cls of VIEW_CLASSES) {
    expect(document.body.classList.contains(cls), cls).toBe(expected.includes(cls));
  }
}

beforeEach(() => {
  installDom();
});

describe("view mode", () => {
  test("maps the viewer's layout onto body classes and clears them when leaving", () => {
    const cases: readonly [ViewModeState, ViewClass[]][] = [
      [viewMode(), ["eh-viewer", "fit-h"]],
      [
        viewMode({ fitHeight: false, readerMode: "continuous" }),
        ["eh-viewer", "fit-w", "reader-continuous"],
      ],
      [
        viewMode({ readerMode: "spread", readingDirection: "rtl" }),
        ["eh-viewer", "fit-h", "reader-spread", "reader-rtl"],
      ],
    ];

    for (const [mode, classes] of cases) {
      applyViewMode(mode);
      expectClasses(classes);
    }

    applyViewMode(viewMode({ viewer: false, readerMode: "spread", readingDirection: "rtl" }));
    expectClasses([]);
  });

  test("keeps the cursor class independent of the layout switch, and reset spares body classes", () => {
    document.body.classList.add("is-loading");
    applyViewMode(viewMode());
    setCursorHidden(true);
    expectClasses(["eh-viewer", "fit-h", "no-cursor"]);

    applyViewMode(viewMode({ fitHeight: false, cursorHidden: true }));
    expectClasses(["eh-viewer", "fit-w", "no-cursor"]);

    resetViewMode();
    expectClasses([]);
    expect(document.body.classList.contains("is-loading")).toBe(true);
  });
});
