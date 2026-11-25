import { describe, expect, test } from "bun:test";

import type { UconfigField } from "../../src/parse/uconfig";
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

function section(anchor: string) {
  const found = sections.find((candidate) => candidate.anchor === anchor);
  if (!found) {
    throw new Error(`missing section: ${anchor}`);
  }
  return found;
}

describe("parseUconfig", () => {
  test("groups fields under heading anchors and drops the profile and select-all helpers", () => {
    expect(sections.map((entry) => [entry.anchor, entry.title])).toEqual([
      ["imgload", "Image Load Settings"],
      ["imgsize", "Image Size Settings"],
      ["frontpage", "Front Page / Search Settings"],
      ["uploaders", "Excluded Uploaders"],
    ]);

    // The `orgimg` anchor has no heading, so its block belongs to the previous section.
    expect(section("imgsize").fields.map((entry) => entry.name)).toEqual(["rx", "ry", "oi"]);
    expect(sections.some((entry) => entry.anchor === "orgimg")).toBe(false);
    expect(fields.some((entry) => entry.name === "-" || entry.name === "profile_name")).toBe(false);
  });

  test("models radio groups and selects with their prompts and option flags", () => {
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

  test("reads standalone text and textarea controls with their labels", () => {
    expect(field("rx")).toMatchObject({
      kind: "text",
      value: "0",
      label: "Horizontal",
      prompt: "Max display size",
    });
    expect(field("ry")).toMatchObject({ kind: "text", value: "0", label: "Vertical" });

    expect(field("xu")).toMatchObject({
      kind: "textarea",
      value: "one two",
      prompt: "Hide these uploaders.",
    });
  });

  test("keeps hidden inputs and resolves each category switch from the site's table", () => {
    expect(field("ct_doujinshi")).toMatchObject({
      kind: "hidden",
      value: "0",
      category: { bit: 2, name: "Doujinshi", cls: "ct2", shown: true },
    });
    expect(field("ct_misc")).toMatchObject({
      kind: "hidden",
      value: "1",
      category: { bit: 1, name: "Misc", cls: "ct1", shown: false },
    });
    expect(field("ct_gamecg")).toMatchObject({
      kind: "hidden",
      value: "1",
      category: { bit: 16, name: "Game CG", cls: "ct5", shown: false },
    });
    expect(field("rx").category).toBeNull();

    const custom = parseUconfig(
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

    expect(custom.map((entry) => entry.category)).toEqual([
      { bit: 256, name: "Non-H", cls: "ct9", shown: true },
      null,
    ]);
  });

  test("keeps checkbox state and derives a table checkbox label from its headers", () => {
    expect(field("xn_0")).toMatchObject({
      kind: "checkbox",
      prompt: "Historic UI elements.",
      label: "Thumbnail selector",
      value: "on",
    });
    expect(field("xn_1")).toMatchObject({ kind: "checkbox", value: "" });

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

  test("posts one radio value and applies checkbox, select and hidden overrides", () => {
    expect(uconfigBody(sections, new Map([["uh", "1"]])).getAll("uh")).toEqual(["1"]);

    const body = uconfigBody(
      sections,
      new Map([
        ["xn_0", ""],
        ["xn_1", "on"],
        ["ct_misc", "0"],
        ["co", "NL"],
      ]),
    );

    expect(body.has("xn_0")).toBe(false);
    expect(body.getAll("xn_1")).toEqual(["on"]);
    expect(body.get("ct_misc")).toBe("0");
    expect(body.get("co")).toBe("NL");
  });
});
