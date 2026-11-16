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
  test("maps each view state onto the body's layout classes", () => {
    const cases: readonly [ViewModeState, ViewClass[]][] = [
      [viewMode(), ["eh-viewer", "fit-h"]],
      [viewMode({ fitHeight: false }), ["eh-viewer", "fit-w"]],
      [
        viewMode({ readerMode: "spread", readingDirection: "rtl" }),
        ["eh-viewer", "fit-h", "reader-spread", "reader-rtl"],
      ],
      [
        viewMode({ fitHeight: false, readerMode: "continuous" }),
        ["eh-viewer", "fit-w", "reader-continuous"],
      ],
    ];

    for (const [mode, classes] of cases) {
      applyViewMode(mode);
      expectClasses(classes);
    }
  });

  test("keeps the cursor class independent of the layout switch", () => {
    applyViewMode(viewMode());
    setCursorHidden(true);
    expectClasses(["eh-viewer", "fit-h", "no-cursor"]);

    applyViewMode(viewMode({ fitHeight: false, cursorHidden: true }));
    expectClasses(["eh-viewer", "fit-w", "no-cursor"]);

    setCursorHidden(false);
    expectClasses(["eh-viewer", "fit-w"]);
  });

  test("leaving the viewer clears the viewer, fit, reader and cursor classes", () => {
    applyViewMode(viewMode({ cursorHidden: true, readerMode: "spread", readingDirection: "rtl" }));

    applyViewMode(
      viewMode({
        viewer: false,
        cursorHidden: false,
        readerMode: "spread",
        readingDirection: "rtl",
      }),
    );
    expectClasses([]);
  });

  test("reset strips every view class and keeps unrelated body classes", () => {
    document.body.classList.add("is-loading");
    applyViewMode(viewMode({ cursorHidden: true }));

    resetViewMode();
    expectClasses([]);
    expect(document.body.classList.contains("is-loading")).toBe(true);
  });
});
