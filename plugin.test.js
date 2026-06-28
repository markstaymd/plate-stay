// plate-stay/plugin tests , the plugin driving a REAL headless Plate editor
// (`createSlateEditor` from platejs, `@platejs/markdown` 53.2.2). These pin the three
// claims the case study makes , the reader Plate lacks, the drift signal Plate lacks,
// and fail-closed refusal , against the live library, not a captured string.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlateEditor } from "platejs";
import { MarkdownPlugin, remarkMdx } from "@platejs/markdown";
import { lintDocument } from "markstay";
import { toPlate } from "./bridge.js";
import {
  markstayMarkdown,
  serializeStay,
  deserializeStay,
  checkDrift,
  UnsupportedPlateBlock,
} from "./plugin.js";

// The four block kinds the §5 baseline subset supports, each with a Plate id.
const VALUE = [
  { type: "h2", id: "aTitleId01", children: [{ text: "Setup" }] },
  { type: "p", id: "bPara00002", children: [{ text: "Install the thing." }] },
  { type: "blockquote", id: "cQuote0003", children: [{ text: "A note worth keeping." }] },
  {
    type: "code_block",
    id: "dCode00004",
    children: [
      { type: "code_line", children: [{ text: "const x = 1;" }] },
      { type: "code_line", children: [{ text: "return x;" }] },
    ],
  },
];

const newEditor = (value) =>
  createSlateEditor({ plugins: [markstayMarkdown], value: value ?? [] });

// A bare Plate markdown editor (remark-mdx on so `<block>` parses, but NO block reader):
// this is what a Plate user has today.
const nativeEditor = () =>
  createSlateEditor({
    plugins: [MarkdownPlugin.configure({ options: { remarkPlugins: [remarkMdx] } })],
  });

test("serializeStay emits invisible markstay markers with a §8 hash, no visible wrapper", () => {
  const md = serializeStay(newEditor(VALUE));
  assert.match(md, /^## Setup\n<!-- stay:aTitleId01 hash=sha256:[0-9a-f]{12} -->/);
  assert.ok(!md.includes("<block"), "must not leak Plate's visible <block> wrapper");
  for (const id of ["aTitleId01", "bPara00002", "cQuote0003", "dCode00004"]) {
    assert.ok(md.includes(`stay:${id} `), `marker for ${id} present`);
  }
});

test("round-trip restores id AND block type for every supported kind", () => {
  const md = serializeStay(newEditor(VALUE));
  const nodes = deserializeStay(newEditor(), md);
  assert.deepEqual(
    nodes.map((n) => [n.type, n.id]),
    [
      ["h2", "aTitleId01"],
      ["p", "bPara00002"],
      ["blockquote", "cQuote0003"],
      ["code_block", "dCode00004"],
    ]
  );
});

test("the reader restores ids that native Plate loses (the missing half)", () => {
  const md = serializeStay(newEditor(VALUE));
  const ours = deserializeStay(newEditor(), md);
  assert.ok(ours.every((n) => typeof n.id === "string" && n.id.length > 0));

  // native Plate on the SAME ids: flattens every <block> to a paragraph of literal text
  // and recovers no id. Reproduced live, this is the case-study claim, not a guess.
  // (`toPlate(md)` is the exact <block> form our reader consumes; the native editor has
  // no block rule, so it hits Plate's default fallback.)
  const native = nativeEditor().api.markdown.deserialize(toPlate(md));
  assert.ok(native.every((n) => n.id === undefined), "native Plate recovers no id");
  assert.ok(
    native.every((n) => n.type === "p"),
    "native Plate flattens every block to a paragraph"
  );
});

test("freshly serialized output is self-consistent (no HASH_DRIFT against itself)", () => {
  const md = serializeStay(newEditor(VALUE));
  const drift = lintDocument(md).findings.filter((f) => f.code === "HASH_DRIFT");
  assert.equal(drift.length, 0, "the written hash must match the body it was written for");
});

test("checkDrift flags exactly the edited block, with zero false positives", () => {
  const md = serializeStay(newEditor(VALUE));
  const nodes = deserializeStay(newEditor(), md);
  const editor = newEditor(nodes);

  assert.deepEqual(checkDrift(editor), []);

  editor.children[1].children[0].text = "Install the OTHER thing now.";
  const drift = checkDrift(editor);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].id, "bPara00002");
  assert.notEqual(drift[0].was, drift[0].now);
});

test("fail-closed: a list value is refused, not silently mis-mapped", () => {
  const listValue = [
    {
      type: "ul",
      id: "eList00005",
      children: [
        { type: "li", children: [{ type: "lic", children: [{ text: "first" }] }] },
        { type: "li", children: [{ type: "lic", children: [{ text: "second" }] }] },
      ],
    },
  ];
  assert.throws(() => serializeStay(newEditor(listValue)), UnsupportedPlateBlock);
});

test("fail-closed: an orphan marker is refused on the way in", () => {
  assert.throws(
    () => deserializeStay(newEditor(), "<!-- stay:zOrphan001 hash=sha256:deadbeef -->\n"),
    UnsupportedPlateBlock
  );
});

test("fail-closed: two blocks sharing an id are refused (SPEC §7 uniqueness)", () => {
  const dup =
    "# A\n<!-- stay:dupId00001 hash=sha256:aaaaaaaaaaaa -->\n\n" +
    "# B\n<!-- stay:dupId00001 hash=sha256:bbbbbbbbbbbb -->\n";
  assert.throws(() => deserializeStay(newEditor(), dup), UnsupportedPlateBlock);
});

test("fail-safe: malformed <block> input never mints a spurious or duplicate id", () => {
  // Plate swallows errors inside a rule and falls back to its default handling, so a
  // wrapper the reader cannot map 1:1 (no id, or a body that is not a single block) is
  // degraded to literal-text paragraphs , never stamped with a wrong/duplicate id. The
  // readBlockId guard (one id, one block) encodes the same intent at the rule level.
  const idless = newEditor().api.markdown.deserialize("<block>\n  plain text\n</block>\n");
  assert.ok(idless.every((n) => n.id === undefined), "id-less wrapper yields no id");

  const multi = newEditor().api.markdown.deserialize(
    '<block id="multiId001">\n  one\n\n  two\n</block>\n'
  );
  assert.ok(multi.every((n) => n.id === undefined), "multi-block body mints no id");
});
