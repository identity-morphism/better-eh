import { describe, expect, test } from "bun:test";

import type { UconfigField, UconfigSection } from "../../src/parse/uconfig";
import { parseUconfig, uconfigBody } from "../../src/parse/uconfig";
import { loadFixture, parseDocument } from "../dom";

const sections = parseUconfig(await loadFixture("uconfig.html"));
const fields = sections.flatMap((entry) => entry.fields);

function field(name: string): UconfigField {
  const found = fields.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`missing field: ${name}`);
  }
  return found;
}

function section(anchor: string): UconfigSection {
  const found = sections.find((candidate) => candidate.anchor === anchor);
  if (!found) {
    throw new Error(`missing section: ${anchor}`);
  }
  return found;
}

/** Apply the values a live update would write back over the parsed fields. */
function withValues(
  entries: readonly UconfigField[],
  values: Readonly<Record<string, string>>,
): UconfigField[] {
  return entries.map((entry) => ({ ...entry, value: values[entry.name] ?? entry.value }));
}

describe("parseUconfig", () => {
  test("groups fields under the heading anchors in document order", () => {
    expect(sections.map((entry) => [entry.anchor, entry.title])).toEqual([
      ["imgload", "Image Load Settings"],
      ["imgsize", "Image Size Settings"],
      ["frontpage", "Front Page / Search Settings"],
      ["uploaders", "Excluded Uploaders"],
    ]);

    // The `orgimg` anchor has no heading, so its block belongs to the previous section.
    expect(section("imgsize").fields.map((entry) => entry.name)).toEqual(["rx", "ry", "oi"]);
    expect(sections.some((entry) => entry.anchor === "orgimg")).toBe(false);
  });

  test("models a radio group with its prompt and option state", () => {
    const uh = field("uh");

    expect(uh.kind).toBe("radio");
    expect(uh.prompt).toBe("Load images through H@H?");
    expect(uh.label).toBeNull();
    expect(uh.value).toBe("0");
    expect(uh.disabled).toBe(false);
    expect(
      uh.options.map((option) => [option.value, option.label, option.selected, option.disabled]),
    ).toEqual([
      ["0", "Any client", true, false],
      ["1", "Default port", false, false],
      ["2", "No HTTPS", false, true],
    ]);
  });

  test("models a select with its leading label and option flags", () => {
    const co = field("co");

    expect(co.kind).toBe("select");
    expect(co.prompt).toBe("");
    expect(co.label).toBe("H@H Region");
    expect(co.value).toBe("");
    expect(
      co.options.map((option) => [option.value, option.label, option.selected, option.disabled]),
    ).toEqual([
      ["", "Auto", true, false],
      ["EU", "Europe", false, false],
      ["US", "NA", false, true],
    ]);
  });

  test("reads standalone text controls and their table-cell labels", () => {
    expect(field("rx")).toMatchObject({
      kind: "text",
      value: "0",
      label: "Horizontal",
      prompt: "Max display size",
    });
    expect(field("ry")).toMatchObject({ kind: "text", value: "0", label: "Vertical" });
  });

  test("keeps hidden inputs and checkbox state", () => {
    expect(field("ct_doujinshi")).toMatchObject({ kind: "hidden", value: "0" });
    expect(field("ct_misc")).toMatchObject({ kind: "hidden", value: "1" });
    expect(field("ct_gamecg")).toMatchObject({ kind: "hidden", value: "1" });

    expect(field("xn_0")).toMatchObject({
      kind: "checkbox",
      prompt: "Historic UI elements.",
      label: "Thumbnail selector",
      value: "on",
    });
    expect(field("xn_1")).toMatchObject({ kind: "checkbox", value: "" });
  });

  test("resolves each hidden category switch from the site's category table", () => {
    expect(field("ct_doujinshi").category).toEqual({
      bit: 2,
      name: "Doujinshi",
      cls: "ct2",
      shown: true,
    });
    expect(field("ct_misc").category).toEqual({ bit: 1, name: "Misc", cls: "ct1", shown: false });
    expect(field("ct_gamecg").category).toEqual({
      bit: 16,
      name: "Game CG",
      cls: "ct5",
      shown: false,
    });
    expect(field("rx").category).toBeNull();
  });

  test("matches hyphenated category names and leaves unknown switches untyped", () => {
    const parsed = parseUconfig(
      parseDocument(`
        <form action="" method="post">
          <h2>Categories</h2>
          <div class="optouter">
            <input type="hidden" name="ct_non-h" value="0" />
            <input type="hidden" name="ct_unknown" value="0" />
          </div>
          <input type="submit" name="apply" value="Apply" />
        </form>
      `),
    ).flatMap((entry) => entry.fields);

    expect(parsed.map((entry) => entry.category)).toEqual([
      { bit: 256, name: "Non-H", cls: "ct9", shown: true },
      null,
    ]);
  });

  test("reads the textarea verbatim", () => {
    const xu = field("xu");

    expect(xu.kind).toBe("textarea");
    expect(xu.value).toBe("one two");
    expect(xu.prompt).toBe("Hide these uploaders.");
  });

  test("ignores select-all helpers and the profile form", () => {
    expect(fields.some((entry) => entry.name === "-")).toBe(false);
    expect(fields.some((entry) => entry.name === "profile_name")).toBe(false);
    expect(fields.filter((entry) => entry.kind === "checkbox").map((entry) => entry.name)).toEqual([
      "xn_0",
      "xn_1",
    ]);
  });

  test("derives a table checkbox label from its row and column headers", () => {
    const matrix = parseDocument(`
      <form action="" method="post">
        <a name="languages"></a>
        <h2>Excluded Languages</h2>
        <div class="optouter">
          <p>Hide galleries in certain languages.</p>
          <div id="xlasel"><table>
            <tr><th></th><th>Original</th><th>Translated</th><th>All</th></tr>
            <tr><td>Japanese</td>
              <td><label class="lc"><input type="checkbox" name="xl_1024" checked="checked" /><span></span></label></td>
              <td><label class="lc"><input type="checkbox" name="xl_2048" /><span></span></label></td>
              <td><label class="lc"><input type="checkbox" /><span></span></label></td>
            </tr>
          </table></div>
        </div>
        <input type="submit" name="apply" value="Apply" />
      </form>
    `);

    const parsed = parseUconfig(matrix).flatMap((entry) => entry.fields);
    expect(parsed.map((entry) => [entry.name, entry.label, entry.value])).toEqual([
      ["xl_1024", "Japanese · Original", "on"],
      ["xl_2048", "Japanese · Translated", ""],
    ]);
  });
});

describe("uconfigBody", () => {
  test("round-trips the captured fields in document order", () => {
    const body = uconfigBody(sections, new Map());

    expect([...body.keys()]).toEqual([
      "uh",
      "co",
      "rx",
      "ry",
      "oi",
      "ct_doujinshi",
      "ct_misc",
      "ct_gamecg",
      "xn_0",
      "xu",
      "fs",
      "apply",
    ]);
    expect(body.get("xn_0")).toBe("on");
    expect(body.has("xn_1")).toBe(false);
    expect(body.get("fs")).toBe("1");
    expect(body.get("apply")).toBe("Apply");
  });

  test("overrides a radio group with exactly one value", () => {
    const body = uconfigBody(sections, new Map([["uh", "1"]]));

    expect(body.getAll("uh")).toEqual(["1"]);
  });

  test("posts a checkbox only while it is checked", () => {
    const body = uconfigBody(
      sections,
      new Map([
        ["xn_0", ""],
        ["xn_1", "on"],
      ]),
    );

    expect(body.has("xn_0")).toBe(false);
    expect(body.getAll("xn_1")).toEqual(["on"]);
  });

  test("applies overrides to hidden inputs and select values", () => {
    const body = uconfigBody(
      sections,
      new Map([
        ["ct_misc", "0"],
        ["co", "NL"],
      ]),
    );

    expect(body.get("ct_misc")).toBe("0");
    expect(body.get("co")).toBe("NL");
  });

  test("posts the model's resolved value instead of re-deriving a selection", () => {
    // Each override disagrees with the fixture's selected/checked state: the model's value wins.
    const model: readonly UconfigSection[] = [
      {
        ...section("imgload"),
        fields: withValues([field("uh"), field("co"), field("xn_1")], {
          uh: "1",
          co: "EU",
          xn_1: "on",
        }),
      },
    ];

    const body = uconfigBody(model, new Map());
    expect(body.getAll("uh")).toEqual(["1"]);
    expect(body.get("co")).toBe("EU");
    expect(body.getAll("xn_1")).toEqual(["on"]);
  });
});
