import { beforeEach, expect, test } from "bun:test";

import { diagnosticReport } from "../src/diagnostics";
import { clearEventLog, log, recentEvents, recordError, warn } from "../src/log";

beforeEach(() => {
  clearEventLog();
});

test("keeps only the newest bounded tail", () => {
  for (let index = 0; index < 105; index += 1) {
    log("line", index);
  }
  warn("still here");

  const events = recentEvents();
  expect(events).toHaveLength(100);
  expect(events[0]?.message).toBe("line 6");
  expect(events.at(-1)).toMatchObject({ level: "warn", message: "still here" });
});

test("builds a report with version, route, scalars and recent errors", () => {
  log("opened", { route: "/g/1" });
  recordError(new Error("boom"), "test");

  const report = diagnosticReport();

  expect(report).toContain("Better EH");
  expect(report).toContain("URL:");
  expect(report).toContain("Settings:");
  expect(report).toContain('"scrollStep"');
  expect(report).not.toContain('"keymap"');
  expect(report).toContain("test Error: boom");
});

test("describes circular values instead of throwing", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  expect(() => log(circular)).not.toThrow();
  expect(recentEvents()[0]?.message).toBe("[object Object]");
});
