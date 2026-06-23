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

import { fromPlate, toPlate, UnsupportedPlateBlock } from "./bridge.js";
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

test("toPlate: orphan marker fails closed", () => {
  assert.throws(
    () => toPlate("<!-- stay:orphan0001 hash=sha256:abcdef123456 -->\n"),
    UnsupportedPlateBlock
  );
});
