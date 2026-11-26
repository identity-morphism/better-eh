import { expect, test } from "bun:test";

import { registerMenuCommands } from "../src/menu";

interface MenuGlobals {
  GM_registerMenuCommand?: (caption: string, command: () => void) => void;
}

const globals = globalThis as unknown as MenuGlobals;

test("registration is a no-op when the manager has no menu API", () => {
  globals.GM_registerMenuCommand = undefined;
  expect(() => registerMenuCommands()).not.toThrow();
});

test("registers every command in order", () => {
  const commands: string[] = [];
  globals.GM_registerMenuCommand = (caption) => {
    commands.push(caption);
  };

  registerMenuCommands();

  expect(commands).toEqual([
    "Toggle fit-height / natural-width",
    "Toggle debug mode",
    "Toggle infinite scroll (feed)",
    "Toggle infinite scroll (gallery)",
    "Toggle tag suggestions",
    "Reset keymap to defaults",
    "Refresh tag data now",
    "Clear cached tag data",
  ]);
});
