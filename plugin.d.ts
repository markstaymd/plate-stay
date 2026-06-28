// Type declarations for `plate-stay/plugin`. The runtime is plain JS (plugin.js); these
// mirror its public surface so TypeScript consumers get checking without a build step.
// `@platejs/markdown` and `platejs` are OPTIONAL peer dependencies , present whenever this
// entry is used (the consumer is a Plate user), absent for string-bridge-only consumers.

export { UnsupportedPlateBlock } from "./bridge";

/**
 * The minimal structural view of the Slate/Plate editor these helpers drive. A real
 * `createSlateEditor` / `createPlateEditor` value satisfies it; typed loosely so this
 * entry does not force a hard dependency on Plate's editor types.
 */
export interface StayEditor {
  children: any[];
  api: {
    markdown: {
      serialize(options?: Record<string, unknown>): string;
      deserialize(markdown: string): any[];
    };
  };
}

/**
 * A MarkdownPlugin configured for markstay: remark-mdx enabled (so `<block>` round-trips)
 * plus a `rules.block` reader that restores `node.id` and the block's real type on the way
 * in. Add it to your editor's `plugins` array in place of bare `MarkdownPlugin`. Typed
 * loosely (the configured-plugin shape is Plate-internal); pass it straight into `plugins`.
 */
export const markstayMarkdown: any;

/**
 * Editor value -> CommonMark + invisible markstay markers (id carried verbatim, plus a
 * SPEC §8 body hash). Throws {@link UnsupportedPlateBlock} on anything outside the §5
 * baseline subset.
 */
export function serializeStay(editor: StayEditor, opts?: Record<string, unknown>): string;

/**
 * markstay-marked CommonMark -> editor value with `node.id` restored and block types
 * intact; each node also gets a non-persisted `_stayHash` for {@link checkDrift}. The
 * editor MUST be built with {@link markstayMarkdown}. Throws {@link UnsupportedPlateBlock}
 * on an orphan / marker-in-fence / multi-id block.
 */
export function deserializeStay(editor: StayEditor, stayMd: string): any[];

/**
 * Which identified blocks drifted since they were loaded (SPEC §8): recomputes each
 * block's body hash from the current editor value and compares it to the hash it was
 * loaded with. Plate's `<block id>` carries no hash, so this is unanswerable natively.
 */
export function checkDrift(
  editor: StayEditor
): Array<{ id: string; was: string; now: string }>;
