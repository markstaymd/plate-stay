// Plate `withBlockId` <-> markstay bridge (worked example, not a published package).
//
// Plate's `@platejs/markdown` `serialize({ withBlockId: true })` wraps each block as
// an MDX-flow element `<block id="…">…</block>` with a 2-space-indented body, "to
// enable AI comment tracking". It is serialize-only: its own deserialize recovers no
// ids and corrupts content (heading/code/quote flatten to paragraphs, inline marks
// drop). markstay supplies the missing half: a stable id (SPEC §6), a body hash as
// drift evidence (SPEC §8), and §9 recovery, all carried in an invisible trailing
// comment instead of a visible wrapper.
//
// This bridge is a string-level, fail-closed converter, NOT a general MDX parser. It
// honours Plate's own block boundaries (it never re-segments) and rejects any wrapper
// it cannot map 1:1 rather than silently corrupting it (the opposite of Plate's
// deserialize). It introduces no new marker syntax: `<block id>` is foreign input it
// translates; output is plain CommonMark + standard `<!-- stay: -->` markers.
//
// Supported subset (v1): a wrapper maps cleanly only when its dedented body is a
// single blank-line block (SPEC §5 baseline) AND that block is one of the four kinds
// validated against real Plate in Phase 0: a heading, a paragraph, a (single-
// paragraph) blockquote, or a CLOSED fenced code block with no internal blank line.
// Everything else fails closed with a clear UnsupportedPlateBlock error, and the
// reasons are honest spec facts, not bugs:
//   - Lists: Plate wraps each list ITEM as its own `<block>`, but markstay defers
//     list-item identity (SPEC §5.1) and lists it as a non-goal (SPEC §14) , a marker
//     only ever identifies the whole list, so per-item ids have nowhere to attach.
//   - Loose / multi-paragraph blocks and fences with an internal blank line: under the
//     blank-line core (SPEC §5 baseline; CommonMark tree mode §5.2 is unimplemented)
//     these split into multiple blocks, so a single trailing marker would bind the
//     wrong chunk.
//   - Tables, thematic breaks, raw HTML blocks, unclosed fences: not validated against
//     Plate's wrapping in Phase 0, and an unclosed fence would swallow the trailing
//     marker. Rejected until a concrete consumer needs them.
//
// Reuses the published `markstay` npm package for hashing and marker serialization;
// adds no core primitives. (Consuming the package, not the umbrella's relative core,
// is the true consumer path and lets the public copy under tools/ run after `npm i`.)

import {
  bodyHash,
  asciiTrim,
  formatMarker,
  segmentBlankLine,
  parseDocument,
} from "markstay";

// Written-hash precision: match `stamp`'s DEFAULT_HASH_LENGTH so bridged output is
// byte-identical to a stamped document.
const HASH_LENGTH = 12;

// Strict Plate wrapper grammar (the captured serializer subset, pinned in Phase 0):
// one double-quoted id attribute, nothing else. A line that begins a `<block` tag but
// does not match this is a malformed / extra-attribute open and is rejected, not
// guessed. The `[\s/>]` boundary keeps `<blockquote>` from reading as a `<block` tag.
const OPEN_RE = /^<block id="([A-Za-z0-9_-]+)">$/;
const CLOSE_RE = /^<\/block>$/;
const BLOCK_TAG_RE = /<block[\s/>]/;
const BLOCK_CLOSE_TAG_RE = /<\/block>/;

// Single-block kind detection over a dedented, single-chunk body (SPEC §5).
const LIST_ITEM_RE = /^[ \t]*([*+-]|\d{1,9}[.)])([ \t]|$)/;
const HEADING_RE = /^#{1,6}([ \t]|$)/;
const THEMATIC_BREAK_RE = /^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/;
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

// A GFM table delimiter row: only pipes, dashes, colons and whitespace, with at least
// one pipe (distinguishes it from a thematic break) and one dash.
const isTableDelimiterLine = (l) =>
  /\|/.test(l) && /-/.test(l) && /^[ \t|:-]+$/.test(l);

// A markstay-shaped comment (HTML or MDX form).
const MARKER_LIKE = /<!--\s*stay:|\{\/\*\s*stay:/;

// SPEC §5 blank line: empty or only ASCII whitespace (space/tab/form-feed/vtab).
// Inlined (spec-pinned) so the bridge depends only on the markstay package's public
// surface, not a core internal.
const isAsciiBlankLine = (l) => /^[ \t\f\v]*$/.test(l);

/** A wrapper the bridge refuses to map (rather than corrupt). Carries the reason. */
export class UnsupportedPlateBlock extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedPlateBlock";
  }
}

/** True if a fenced block (first line a fence opener) has a matching closing fence. */
function fenceClosed(lines) {
  const open = FENCE_OPEN_RE.exec(lines[0]);
  if (!open) return false;
  const ch = open[1][0];
  const len = open[1].length;
  for (let i = 1; i < lines.length; i += 1) {
    const close = FENCE_CLOSE_RE.exec(lines[i]);
    if (close && close[1][0] === ch && close[1].length >= len) return true;
  }
  return false;
}

// Why each non-accepted kind is rejected, for the fail-closed error message.
const REJECT_REASON = {
  list:
    "wraps a list item; markstay has no list-item identity (SPEC §5.1 defers it, " +
    "§14 makes it a non-goal , a marker identifies the whole list, not an item)",
  "unclosed-fence":
    "wraps an unclosed code fence; the trailing marker would land inside the fence",
  "thematic-break": "wraps a thematic break, not a v1-supported block kind",
  table:
    "wraps a table; Plate's table wrapping was not validated in Phase 0, rejected in v1",
  html: "wraps a raw HTML block, not a v1-supported block kind",
};

/**
 * Classify a dedented, single blank-line chunk into a supported kind or a rejection
 * reason. Accepted: "heading" | "paragraph" | "blockquote" | "fence". Anything else
 * is a key into REJECT_REASON.
 */
function classifyBlock(content) {
  const lines = content.split("\n");
  const first = lines[0];
  if (LIST_ITEM_RE.test(first)) return "list";
  if (HEADING_RE.test(first)) return "heading";
  if (first.startsWith(">")) return "blockquote";
  if (FENCE_OPEN_RE.test(first)) return fenceClosed(lines) ? "fence" : "unclosed-fence";
  if (THEMATIC_BREAK_RE.test(first)) return "thematic-break";
  if (lines.some(isTableDelimiterLine)) return "table";
  if (/^[ \t]*</.test(first)) return "html";
  return "paragraph";
}

const ACCEPTED = new Set(["heading", "paragraph", "blockquote", "fence"]);

/**
 * Convert Plate `withBlockId` Markdown into plain Markdown carrying markstay markers.
 *
 * For each `<block id="x">BODY</block>` wrapper whose dedented BODY is a single
 * supported block, emits the unwrapped body followed by a trailing
 * `<!-- stay:x hash=sha256:… -->` marker, carrying Plate's id `x` over VERBATIM (no
 * mint; Plate's default `nanoid(10)` is §6-valid). Throws UnsupportedPlateBlock on any
 * wrapper outside the supported subset, on a duplicate id, or on stray content.
 *
 * @param {string} md Plate serializer output (`withBlockId: true`).
 * @returns {string} plain Markdown + markstay markers (LF line endings).
 */
export function fromPlate(md) {
  const lines = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rendered = [];
  const seenIds = new Set();
  let i = 0;

  while (i < lines.length) {
    const ln = lines[i];
    if (isAsciiBlankLine(ln)) {
      i += 1;
      continue;
    }

    const open = OPEN_RE.exec(ln);
    if (!open) {
      if (/^<block[\s/>]/.test(ln)) {
        throw new UnsupportedPlateBlock(
          `malformed or extra-attribute <block> open: ${JSON.stringify(ln)}`
        );
      }
      throw new UnsupportedPlateBlock(
        `content outside a <block> wrapper: ${JSON.stringify(ln)}`
      );
    }
    const id = open[1];
    if (seenIds.has(id)) {
      throw new UnsupportedPlateBlock(
        `duplicate Plate id "${id}" across wrappers; markstay ids must be unique (SPEC §7)`
      );
    }
    seenIds.add(id);

    // Collect body lines up to the closing `</block>`. Each non-blank body line must
    // be 2-space indented; a nested `<block` or an embedded `</block>` is rejected.
    const body = [];
    i += 1;
    let closed = false;
    for (; i < lines.length; i += 1) {
      const bl = lines[i];
      if (CLOSE_RE.test(bl)) {
        closed = true;
        i += 1;
        break;
      }
      if (BLOCK_TAG_RE.test(bl)) {
        throw new UnsupportedPlateBlock(`nested <block> in wrapper id="${id}"`);
      }
      if (BLOCK_CLOSE_TAG_RE.test(bl)) {
        throw new UnsupportedPlateBlock(`embedded </block> in wrapper id="${id}"`);
      }
      if (!isAsciiBlankLine(bl) && !bl.startsWith("  ")) {
        throw new UnsupportedPlateBlock(
          `body line not 2-space indented in wrapper id="${id}": ${JSON.stringify(bl)}`
        );
      }
      body.push(bl);
    }
    if (!closed) {
      throw new UnsupportedPlateBlock(`unterminated <block> wrapper id="${id}"`);
    }

    // Dedent (drop the 2-space indent; blank lines stay blank) and require the body to
    // be a single blank-line block of a supported kind.
    const dedented = body
      .map((l) => (isAsciiBlankLine(l) ? "" : l.slice(2)))
      .join("\n");
    const chunks = segmentBlankLine(dedented);
    if (chunks.length === 0) {
      throw new UnsupportedPlateBlock(`empty <block> wrapper id="${id}"`);
    }
    if (chunks.length > 1) {
      throw new UnsupportedPlateBlock(
        `wrapper id="${id}" body is not a single block (loose/multi-paragraph, ` +
          `or a fenced block with an internal blank line , SPEC §5.2 tree mode territory)`
      );
    }
    const content = chunks[0][1];

    const kind = classifyBlock(content);
    if (!ACCEPTED.has(kind)) {
      throw new UnsupportedPlateBlock(
        `wrapper id="${id}" ${REJECT_REASON[kind] ?? "is not a v1-supported block kind"}`
      );
    }
    if (MARKER_LIKE.test(content)) {
      throw new UnsupportedPlateBlock(
        `wrapper id="${id}" body already contains a markstay-style marker`
      );
    }

    const hex = bodyHash(asciiTrim(content), HASH_LENGTH);
    rendered.push(content + "\n" + formatMarker({ id, hash: hex, syntax: "html" }));
  }

  return rendered.length ? rendered.join("\n\n") + "\n" : "";
}

// Code-fence-aware guard: a markstay marker INSIDE a code fence (or on a fence
// delimiter line, e.g. an info string) is content, not a real marker, but the raw-
// text marker scan (markers.js) would treat it as one and stripMarkers would corrupt
// the fence. Reject that case rather than mangle it.
function assertNoMarkerInFence(norm) {
  let fence = null; // { char, len } while a fence is open
  for (const ln of norm.split("\n")) {
    if (fence) {
      const close = FENCE_CLOSE_RE.exec(ln);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
        fence = null;
        continue;
      }
      if (MARKER_LIKE.test(ln)) {
        throw new UnsupportedPlateBlock(
          `markstay marker inside a code fence: ${JSON.stringify(ln)} ` +
            `(cannot be re-wrapped as a Plate <block>)`
        );
      }
    } else {
      const open = FENCE_OPEN_RE.exec(ln);
      if (open) {
        // The opener line itself can carry marker-shaped text (an info string); that
        // is fence metadata the marker scan would misread, so reject it too.
        if (MARKER_LIKE.test(ln)) {
          throw new UnsupportedPlateBlock(
            `markstay marker on a code-fence line: ${JSON.stringify(ln)} ` +
              `(cannot be re-wrapped as a Plate <block>)`
          );
        }
        fence = { char: open[1][0], len: open[1].length };
      }
    }
  }
}

/**
 * Convert markstay-marked Markdown back into Plate `withBlockId` form: re-wrap each
 * block that carries exactly one stay id as `<block id="x">…</block>` with a 2-space
 * indented body, dropping the marker (id-only round-trip; markstay's hash is its own
 * value-add, not Plate's to carry). Proves the mapping is lossless and lets a Plate
 * user round-trip through markstay without the content damage Plate's own deserialize
 * inflicts. Throws UnsupportedPlateBlock on an orphan/marker-in-fence/multi-id block.
 *
 * @param {string} md markstay-marked Markdown.
 * @returns {string} Plate `withBlockId` Markdown (LF line endings).
 */
export function toPlate(md) {
  const norm = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  assertNoMarkerInFence(norm);

  const wrapped = [];
  for (const b of parseDocument(norm)) {
    if (b.index < 0) {
      throw new UnsupportedPlateBlock(
        `orphan marker(s) with no preceding block to wrap (line ${b.line})`
      );
    }
    if (b.markers.some((mk) => mk.malformed)) {
      throw new UnsupportedPlateBlock(`malformed marker on block at line ${b.line}`);
    }
    const ids = b.markers.filter((mk) => mk.id).map((mk) => mk.id);
    if (ids.length === 0) {
      throw new UnsupportedPlateBlock(
        `block at line ${b.line} carries no stay id; cannot map to <block id>`
      );
    }
    if (ids.length > 1) {
      throw new UnsupportedPlateBlock(
        `block at line ${b.line} carries ${ids.length} stay ids; a <block> holds one`
      );
    }
    const indented = b.content
      .split("\n")
      .map((l) => (l === "" ? "" : "  " + l))
      .join("\n");
    wrapped.push(`<block id="${ids[0]}">\n${indented}\n</block>`);
  }

  return wrapped.length ? wrapped.join("\n\n") + "\n" : "";
}
