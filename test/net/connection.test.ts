import { describe, expect, test } from "bun:test";

import { browserSavesData, shouldSaveData } from "../../src/net/connection";

interface NetworkConnection {
  saveData?: boolean;
  effectiveType?: string;
}

function navigatorWith(connection?: NetworkConnection): Navigator {
  return { connection } as unknown as Navigator;
}

describe("browserSavesData", () => {
  test("honors Save-Data and 2G-class effective types", () => {
    expect(browserSavesData(navigatorWith({ saveData: true }))).toBe(true);
    expect(browserSavesData(navigatorWith({ effectiveType: "slow-2g" }))).toBe(true);
    expect(browserSavesData(navigatorWith({ effectiveType: "2g" }))).toBe(true);
    expect(browserSavesData(navigatorWith({ effectiveType: "3g" }))).toBe(false);
    expect(browserSavesData(navigatorWith())).toBe(false);
    expect(browserSavesData(navigatorWith(undefined))).toBe(false);
  });
});

describe("shouldSaveData", () => {
  const metered = navigatorWith({ saveData: true });
  const fast = navigatorWith({ effectiveType: "4g" });

  test("honors the explicit modes over the browser hint", () => {
    expect(shouldSaveData("on", fast)).toBe(true);
    expect(shouldSaveData("off", metered)).toBe(false);
    expect(shouldSaveData("auto", metered)).toBe(true);
    expect(shouldSaveData("auto", fast)).toBe(false);
  });
});
