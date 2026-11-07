// Phase 1 regression vectors for the Plate <-> markstay bridge.
//
// Supported corpus (fixtures/supported.*) exercises the positive path: a Plate
// `withBlockId` doc of heading / paragraph / single-paragraph blockquote / single-
// block fence converts to clean, lint-passing markstay markers carrying Plate's ids
// verbatim, and round-trips back. Negative cases (the real list-bearing capture plus
// synthetic edge constants) assert the bridge FAILS CLOSED with UnsupportedPlateBlock
// rather than silently corrupting input. Run from this directory: `npm i && node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSlateEditor } from "platejs";

import { fromPlate, toPlate, UnsupportedPlateBlock } from "./bridge.js";
import { markstayMarkdown, deserializeStay } from "./plugin.js";
import {
  findMarkers,
  stripMarkers,
  lintDocument,
  stamp,
} from "markstay";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(HERE, "fixtures", name), "utf8");

// Compare modulo documented whitespace: normalize line endings, strip per-line
// trailing whitespace, collapse blank-line runs (stripMarkers leaves an empty line
// where each marker was), and trim leading/trailing blank lines.
function normWs(s) {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

const SUPPORTED_IDS = ["aTitleId01", "paraId00002", "bqId00000005", "cbId00000006"];

// Native Plate 53.3.18 and 53.5.3 re-save of supported.withblockid.md, as
// captured. Inline so the source-owned mirror test needs no new fixture allowlist.
const RESAVED = `<block id="aTitleId01">

## Setup

</block>

<block id="paraId00002">

Install the **package** first.

</block>

<block id="bqId00000005">

> a quote line

</block>

<block id="cbId00000006">

\`\`\`
const x = 1;
\`\`\`

</block>
`;

const reader = () => createSlateEditor({ plugins: [markstayMarkdown] });

test("fromPlate: plain Plate re-save preserves every id, type and content", () => {
  const direct = reader().api.markdown.deserialize(RESAVED);
  assert.deepEqual(direct.map((n) => [n.type, n.id]), [
    ["h2", SUPPORTED_IDS[0]], ["p", SUPPORTED_IDS[1]],
    ["blockquote", SUPPORTED_IDS[2]], ["code_block", SUPPORTED_IDS[3]],
  ]);
  const out = fromPlate(RESAVED);
  const restored = deserializeStay(reader(), out);
  // deserializeStay additionally records the hash for drift checking.
  assert.deepEqual(restored.map(({ _stayHash, ...node }) => node), direct);
  assert.deepEqual(findMarkers(out).map((m) => m.id), SUPPORTED_IDS);
  assert.equal(out, fromPlate(fixture("supported.withblockid.md")));
  assert.deepEqual(lintDocument(out).findings, []);
});

test("fromPlate: re-saved CRLF and whitespace-only wrapper padding are accepted", () => {
  const padded = RESAVED.replace(/\n\n/g, "\n \t\n\n").replace(/\n/g, "\r\n");
  assert.equal(fromPlate(padded), fromPlate(RESAVED));
});

test("fromPlate: indentation style is selected per wrapper", () => {
  const mixed = '<block id="legacy0001">\n  # Original\n</block>\n\n' + RESAVED;
  assert.deepEqual(findMarkers(fromPlate(mixed)).map((m) => m.id),
    ["legacy0001", ...SUPPORTED_IDS]);
});

const RESAVED_BODIES = {
  heading: "###### Heading",
  paragraph: "A **paragraph** with `code`.\n  A continuation.",
  blockquote: "> First line.\n> Second line.\nLazy continuation.",
  fence: "```js\nfunction f() {\n  return 1;\n}\n```",
  "tilde fence": "~~~~js\n  two spaces\n\tand a tab\n~~~~~",
  "inline code": "Use `<x>` and ``{a ` b}`` here.",
  "escaped punctuation": "A \\{ literal brace and \\<tag>.",
  "comparison text": "x < y",
  "heading with inline code": "## Use `<x>` and `{y}`",
  "quote with inline code": "> Use `<x>` and `{y}`",
};
for (const [label, body] of Object.entries(RESAVED_BODIES)) {
  test(`fromPlate: re-saved ${label} agrees with the plugin reader`, () => {
    const md = `<block id="resaved001">\n\n${body}\n\n</block>\n`;
    const direct = reader().api.markdown.deserialize(md);
    assert.equal(direct.length, 1);
    assert.equal(direct[0].id, "resaved001");
    const out = fromPlate(md);
    const restored = deserializeStay(reader(), out);
    assert.deepEqual(restored.map(({ _stayHash, ...node }) => node), direct);
    assert.equal(stripMarkers(out).trimEnd(), body);
    assert.deepEqual(lintDocument(out).findings, []);
  });
}

test("fromPlate: unpadded re-saves of all supported kinds agree with the plugin reader", () => {
  for (const body of [RESAVED_BODIES.heading, RESAVED_BODIES.paragraph,
    RESAVED_BODIES.blockquote, RESAVED_BODIES.fence]) {
    const md = `<block id="unpadded01">\n${body}\n</block>\n`;
    const direct = reader().api.markdown.deserialize(md);
    assert.equal(direct.length, 1);
    assert.equal(direct[0].id, "unpadded01");
    const restored = deserializeStay(reader(), fromPlate(md));
    assert.deepEqual(restored.map(({ _stayHash, ...node }) => node), direct);
  }
});

test("fromPlate: supported corpus is lint-clean", () => {
  const out = fromPlate(fixture("supported.withblockid.md"));
  const { findings } = lintDocument(out);
  assert.equal(
    findings.length,
    0,
    `expected no findings, got: ${JSON.stringify(findings)}`
  );
});

test("fromPlate: carries every Plate id exactly once, none minted", () => {
  const out = fromPlate(fixture("supported.withblockid.md"));
  const ids = findMarkers(out)
    .filter((mk) => mk.id && !mk.malformed)
    .map((mk) => mk.id)
    .sort();
  assert.deepEqual(ids, [...SUPPORTED_IDS].sort());
});

test("fromPlate: each carried marker has a body hash", () => {
  const out = fromPlate(fixture("supported.withblockid.md"));
  for (const mk of findMarkers(out)) {
    assert.ok(mk.hash, `marker ${mk.id} should carry a hash`);
  }
});

test("content preserved: stripMarkers(fromPlate(x)) == plain (modulo whitespace)", () => {
  const out = fromPlate(fixture("supported.withblockid.md"));
  assert.equal(normWs(stripMarkers(out)), normWs(fixture("supported.plain.md")));
});

test("round-trip: toPlate(fromPlate(x)) == x (modulo whitespace)", () => {
  const src = fixture("supported.withblockid.md");
  assert.equal(normWs(toPlate(fromPlate(src))), normWs(src));
});

test("fromPlate output is byte-identical to stamp(plain) with the same ids", () => {
  // Carrying Plate's ids verbatim and hashing the same body the core hashes means a
  // bridged doc is indistinguishable from one the `stamp` write path would produce.
  const ids = [...SUPPORTED_IDS];
  let k = 0;
  const stamped = stamp(fixture("supported.plain.md"), { newId: () => ids[k++] }).text;
  const bridged = fromPlate(fixture("supported.withblockid.md"));
  assert.equal(bridged.trimEnd(), stamped.trimEnd());
});

test("fromPlate: an escaped bullet is a paragraph, not a list (no false reject)", () => {
  // `\*` starts with a backslash, so it is prose, not a list item; it must convert.
  const out = fromPlate(`<block id="escId00001">\n  \\* not a list\n</block>\n`);
  assert.equal(lintDocument(out).findings.length, 0);
  assert.deepEqual(
    findMarkers(out).map((mk) => mk.id),
    ["escId00001"]
  );
});

test("fromPlate: real Plate capture with lists fails closed", () => {
  // sample.withblockid.md is the unfiltered Phase-0 capture; it contains per-item
  // list wrappers, which markstay cannot represent.
  assert.throws(() => fromPlate(fixture("sample.withblockid.md")), UnsupportedPlateBlock);
});

// Synthetic negatives: each is a Plate-shaped wrapper the bridge must reject.
const NEGATIVE = {
  "list item": `<block id="liItem0001">\n  * first item\n</block>\n`,
  "ordered list item": `<block id="olItem0001">\n  1. first item\n</block>\n`,
  "blank-line fence (multi-block body)": `<block id="cbBlank001">\n  \`\`\`\n  a\n\n  b\n  \`\`\`\n</block>\n`,
  "multi-paragraph body": `<block id="multiPara01">\n  first para\n\n  second para\n</block>\n`,
  "nested block": `<block id="outer00001">\n  <block id="inner00001">\n    hi\n  </block>\n</block>\n`,
  "extra attribute": `<block id="extraAttr1" data-x="y">\n  ## Setup\n</block>\n`,
  "single-quoted id (off grammar)": `<block id='singleQ001'>\n  ## Setup\n</block>\n`,
  "embedded </block> in body": `<block id="embed00001">\n  text </block> more\n</block>\n`,
  "marker in body": `<block id="markerBody">\n  text <!-- stay:sneaky -->\n</block>\n`,
  "content outside a wrapper": `not wrapped at all\n`,
  "unterminated wrapper": `<block id="noClose0001">\n  ## Setup\n`,
  "duplicate id across wrappers":
    `<block id="dupId00001">\n  First.\n</block>\n\n<block id="dupId00001">\n  Second.\n</block>\n`,
  table: `<block id="tableId001">\n  | A |\n  | - |\n  | B |\n</block>\n`,
  "thematic break": `<block id="hrId000001">\n  ---\n</block>\n`,
  "unclosed fence": `<block id="openFence1">\n  \`\`\`\n  const x = 1;\n</block>\n`,
  "raw HTML block": `<block id="htmlId0001">\n  <div>hi</div>\n</block>\n`,
};

for (const [label, md] of Object.entries(NEGATIVE)) {
  test(`fromPlate fails closed: ${label}`, () => {
    assert.throws(() => fromPlate(md), UnsupportedPlateBlock);
  });
  test(`fromPlate fails closed after re-save: ${label}`, () => {
    assert.throws(() => fromPlate(md.replace(/^  /gm, "")), UnsupportedPlateBlock);
  });
}

const AMBIGUOUS_RESAVES = {
  "two headings without a blank line": "# One\n## Two",
  "heading then paragraph": "# One\nProse",
  "paragraph then heading": "Prose\n# Two",
  "paragraph then list": "Prose\n- item",
  "paragraph then quote": "Prose\n> quote",
  "setext heading": "Prose\n===",
  "fence then paragraph": "```\ncode\n```\nProse",
  "two fences": "```\ncode\n```\n```\nmore\n```",
  "backtick in fence info": "```bad`info\ncode\n```",
  "over-indented closing fence": "```\ncode\n    ```",
  "tab-indented closing fence": "```\ncode\n\t```",
  "quote with two paragraphs": "> One\n>\n> Two",
  "quote with nested heading": "> # Heading",
  "nested quote": "> > Nested",
  "MDX expression": "{1 + 2}",
  "MDX import": "import A from 'x'",
  "MDX export": "export const x = 1",
  "reference definition": "[link]: https://example.com",
  "reference definition with escaped bracket": "[a\\]]: /url",
  "reference definition with multiline label": "[a\nb]: /url",
  "quote containing only a reference definition": "> [a\\]]: /url",
  "unclosed inline code with MDX": "Use `<x> here.",
  "multiline inline code": "Use `<x>\nand {y}` here.",
  "multiline inline code without MDX": "Use `code\nspan` here.",
  "unequal backtick runs with MDX": "Use ``{x}` here.",
  "longer closing backtick run with MDX": "Use `{x}`` here.",
  "escaped backtick with MDX": "Use \\`{x}` here.",
  "escaped backslash with MDX": "Use \\\\{x} here.",
  "one-space indent": " # Heading",
  "mixed serializer indentation": "  # Heading\nProse",
  "empty wrapper": "",
};
for (const [label, body] of Object.entries(AMBIGUOUS_RESAVES)) {
  test(`fromPlate refuses an ambiguous re-save: ${label}`, () => {
    assert.throws(() => fromPlate(`<block id="ambig00001">\n\n${body}\n\n</block>\n`),
      UnsupportedPlateBlock);
  });
}

test("toPlate: marker inside a code fence fails closed", () => {
  const md =
    "```\n<!-- stay:notAMarker -->\nconst x = 1;\n```\n<!-- stay:realId0001 hash=sha256:abcdef123456 -->\n";
  assert.throws(() => toPlate(md), UnsupportedPlateBlock);
});

test("toPlate: marker on the fence opener (info string) fails closed", () => {
  // The opener line is fence metadata; the raw marker scan would misread it as a real
  // marker and stripMarkers would mangle the fence. Must reject, not silently convert.
  const md = "``` <!-- stay:trap hash=sha256:abcdef123456 -->\nconst x = 1;\n```\n";
  assert.throws(() => toPlate(md), UnsupportedPlateBlock);
});

test("toPlate: block with no stay id fails closed", () => {
  assert.throws(() => toPlate("just a paragraph, no marker\n"), UnsupportedPlateBlock);
});

// §16 binds every reader: a marker carrying `subhash` is child identity (§5.5 list
// items, §5.6 table rows) and must never be reported as the stay of the block that
// contains it. Plate has one id per block, so the only conforming answer that also
// keeps the child's evidence is to decline the document. Without this the bridge
// wrapped the whole list in `<block id="kid">` and dropped the marker.
test("toPlate: a child (subhash) marker fails closed rather than claiming its container", () => {
  const child = "- alpha <!-- stay:kid subhash=sha256:0123456789ab -->\n- beta\n";
  assert.throws(() => toPlate(child), UnsupportedPlateBlock);
  // Also when the container carries a legitimate stay of its own: the child's id must
  // not be silently discarded just because another id is available.
  assert.throws(
    () => toPlate(child + "<!-- stay:parent0001 hash=sha256:abcdef123456 -->\n"),
    UnsupportedPlateBlock
  );
  // And for a row carrier, which sits mid-line inside the table's last cell.
  const row =
    "| a | b |\n|---|---|\n| 1 | 2<!-- stay:row1 subhash=sha256:0123456789ab --> |\n" +
    "<!-- stay:table0001 hash=sha256:abcdef123456 -->\n";
  assert.throws(() => toPlate(row), UnsupportedPlateBlock);
});

test("toPlate: an x- namespaced lookalike key stays ordinary block metadata", () => {
  // §4 reserves `subhash` exactly; `x-subhash` is an extension key a tool must
  // preserve and must not interpret, so this block converts normally.
  const md = "Text. <!-- stay:extension1 x-subhash=sha256:0123456789ab -->\n";
  assert.match(toPlate(md), /<block id="extension1">/);
});

test("toPlate: orphan marker fails closed", () => {
  assert.throws(
    () => toPlate("<!-- stay:orphan0001 hash=sha256:abcdef123456 -->\n"),
    UnsupportedPlateBlock
  );
});

// SPEC.md §5.3 (v1.11) write refusal: a writer inserts no marker into a leading
// `---` span that recognition rejected only for a blank line in a YAML-ish payload.
// fromPlate is exempt by construction, not by a check: its output's line 1 is the
// first wrapper's first body line, and a line that opens such a span (`---`,
// optionally with trailing spaces or tabs) is a thematic break to classifyBlock,
// which fails closed. These pin that, in the two-space withBlockId form and in the
// column-zero, blank-padded form a plain Plate save writes at 53.3.18+.
test("fromPlate: a first wrapper that opens a frontmatter-shaped span fails closed", () => {
  const bodies = [
    // The whole span in one wrapper: rejected as more than one block.
    ["---", "name: demo", "", "description: two", "---"],
    // The opener alone, then the payload: rejected as a thematic break.
    ["---"],
    ["--- \t"],
  ];
  for (const body of bodies) {
    const twoSpace = `<block id="fm1">\n${body.map((l) => (l ? `  ${l}` : "")).join("\n")}\n</block>\n` +
      `\n<block id="fm2">\n  name: demo\n</block>\n`;
    const padded = `<block id="fm1">\n\n${body.join("\n")}\n\n</block>\n` +
      `\n<block id="fm2">\n\nname: demo\n\n</block>\n`;
    for (const md of [twoSpace, padded]) {
      assert.throws(() => fromPlate(md), UnsupportedPlateBlock, JSON.stringify(md));
    }
  }
});
