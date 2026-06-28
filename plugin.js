// plate-stay/plugin , the editor-native half of the bridge: make a real Plate editor
// read, write, and drift-check markstay block identity, using Plate's own markdown
// extension points. The `.` entry (bridge.js) is a zero-dependency string converter; this
// `./plugin` entry adds the editor integration and so needs Plate present (declared as an
// OPTIONAL peer dependency , a string-bridge-only consumer pulls none of it).
//
// Plate's `serialize({ withBlockId: true })` writes a block id into the `.md` "to enable
// AI comment tracking", but stops there:
//   - No reader. Its `deserializeMd` has no handler for the `<block>` element, so the
//     wrapper hits a default fallback that flattens it to a paragraph of literal
//     `<block …>` text and recovers no id. The round-trip is lossy.
//   - No hash. The wrapper is an id and nothing else, so a comment anchored to a block
//     cannot tell that the block's content changed underneath it , which is the whole
//     point of "comment tracking".
//
// This supplies both halves at the editor's own markdown layer, no fork of Plate: Plate
// dispatches a custom MDX element to the markdown rule keyed by its tag name, and `block`
// is not a built-in plugin key, so `rules.block` claims the slot from plain user config.

import {
  MarkdownPlugin,
  remarkMdx,
  convertChildrenDeserialize,
} from "@platejs/markdown";
import { fromPlate, toPlate, UnsupportedPlateBlock } from "./bridge.js";
import { parseDocument, bodyHash } from "markstay";

export { UnsupportedPlateBlock };

/**
 * The reader Plate lacks. `rules.block` intercepts every `<block id="x">…</block>`; we
 * deserialize the wrapper's single child normally , its real type (heading, paragraph,
 * blockquote, fenced code) survives , then stamp Plate's id onto the produced node. With
 * no `block` rule (the Plate default) the same wrapper flattens to a paragraph of literal
 * text with no id.
 *
 * Fail-safe, matching the bridge's intent: stamp ONLY when the wrapper maps 1:1 to a
 * single block carrying a usable id. A missing id, or a body that converted to several
 * blocks, is left UNSTAMPED rather than mis-stamped , stamping one id onto several nodes
 * would mint duplicate editor ids. (Neither case arises on the bridge's own output, which
 * always wraps one block with one id; this is defence for raw `<block>` input.) Note Plate
 * swallows errors thrown inside a rule and falls back to its default handling, so a loud
 * refusal here is not possible; not minting a wrong id is the achievable guarantee.
 *
 * @param {object} mdastNode the `<block>` mdxJsxFlowElement
 * @param {object} deco      decoration state threaded by the deserializer
 * @param {object} options   carries the recursive child converter
 * @returns {object[]} the child block(s) as Slate nodes; the single block carries the id
 */
function readBlockId(mdastNode, deco, options) {
  const id = mdastNode.attributes?.find((a) => a.name === "id")?.value;
  const kids = convertChildrenDeserialize(mdastNode.children, deco, options);
  if (typeof id === "string" && id.length > 0 && kids.length === 1) {
    kids[0].id = id;
  }
  return kids;
}

/**
 * A MarkdownPlugin configured for markstay: remark-mdx enabled (so `<block>` round-trips
 * through remark at all) plus the block-id reader. Build your editor with this in place
 * of bare `MarkdownPlugin`; `serializeStay`/`deserializeStay` assume the editor carries
 * it (the reader fires from the editor's own deserialize).
 */
export const markstayMarkdown = MarkdownPlugin.configure({
  options: {
    remarkPlugins: [remarkMdx],
    rules: { block: { deserialize: readBlockId } },
  },
});

/**
 * Editor value -> CommonMark + invisible markstay markers. Serializes via Plate's own
 * `withBlockId`, then relocates each id from the visible `<block>` wrapper to a trailing
 * `<!-- stay:id hash=sha256:… -->` comment with a SPEC §8 body hash attached, via the
 * fail-closed bridge. Throws {@link UnsupportedPlateBlock} on anything outside the §5
 * baseline subset (lists, tables, loose/multi-paragraph blocks) rather than mis-map it.
 *
 * @param {object} editor a Slate/Plate editor built with {@link markstayMarkdown}
 * @param {object} [opts] extra options forwarded to `editor.api.markdown.serialize`
 * @returns {string} CommonMark carrying markstay markers (LF line endings)
 */
export function serializeStay(editor, opts = {}) {
  // withBlockId is the helper's invariant (the bridge reads `<block>` wrappers), so it
  // wins over opts rather than being overridable to false.
  const plateMd = editor.api.markdown.serialize({ ...opts, withBlockId: true });
  return fromPlate(plateMd);
}

/**
 * markstay-marked CommonMark -> editor value with `node.id` restored and block types
 * intact. Converts markers back to `<block>` (`toPlate`) then lets the editor's block-id
 * reader attach the ids. Each node also gets a non-persisted `_stayHash` (the stamped §8
 * hash) so {@link checkDrift} can answer "did this block change?" live, without a stored
 * baseline document.
 *
 * The editor MUST be built with {@link markstayMarkdown}, otherwise the reader never
 * fires and the ids are lost exactly as in native Plate.
 *
 * @param {object} editor a Slate/Plate editor built with {@link markstayMarkdown}
 * @param {string} stayMd markstay-marked CommonMark
 * @returns {object[]} the editor value (top-level nodes), ids + `_stayHash` attached
 */
export function deserializeStay(editor, stayMd) {
  // Fail closed on duplicate ids up front (SPEC §7), before the heavier deserialize:
  // `toPlate` does not guard cross-block id collisions, so two markers sharing an id
  // would otherwise produce two same-id editor nodes and a silently-wrong `_stayHash`.
  const hashById = new Map();
  for (const b of parseDocument(stayMd)) {
    for (const mk of b.markers) {
      if (mk.malformed || !mk.id) continue;
      if (hashById.has(mk.id)) {
        throw new UnsupportedPlateBlock(
          `duplicate stay id "${mk.id}"; markstay ids must be unique (SPEC §7)`
        );
      }
      hashById.set(mk.id, mk.hash ?? null);
    }
  }
  const nodes = editor.api.markdown.deserialize(toPlate(stayMd));
  for (const n of nodes) {
    const h = n.id ? hashById.get(n.id) : null;
    if (h) n._stayHash = h;
  }
  return nodes;
}

/**
 * Which identified blocks drifted since they were loaded (SPEC §8). Recomputes each
 * top-level node's body hash from the CURRENT editor value and compares it to the hash
 * the node was loaded with (`_stayHash`). Plate's `<block id>` wrapper carries no hash,
 * so the same question is structurally unanswerable on a Plate-native document , the
 * point of the markstay marker.
 *
 * `_stayHash` on the node is a prototype convenience; a production plugin would more
 * likely surface drift through Plate's comment / decoration layer (a comment bound to a
 * block id that knows, live, when its block changed , exactly Plate's "AI comment
 * tracking" goal).
 *
 * @param {object} editor a Slate/Plate editor whose value came from {@link deserializeStay}
 * @returns {{id: string, was: string, now: string}[]} one entry per drifted block
 */
export function checkDrift(editor) {
  const loadedHash = new Map();
  for (const n of editor.children) {
    if (n.id && n._stayHash) loadedHash.set(n.id, n._stayHash);
  }
  const drifted = [];
  for (const b of parseDocument(serializeStay(editor))) {
    for (const mk of b.markers) {
      const was = loadedHash.get(mk.id);
      if (!was) continue;
      const now = bodyHash(b.content, was.length);
      if (now !== was) drifted.push({ id: mk.id, was, now });
    }
  }
  return drifted;
}
