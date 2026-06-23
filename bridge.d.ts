// Type declarations for plate-stay. The runtime is plain JS (bridge.js); these
// mirror its public surface so TypeScript consumers get checking without a build step.

/**
 * Thrown when a Plate `<block>` wrapper (or a markstay-marked block) falls outside
 * the supported 1:1 subset, rather than silently corrupting it. The bridge fails
 * closed: heading / paragraph / single-paragraph blockquote / single-block closed
 * fence are mappable; lists, loose/multi-paragraph blocks, tables, thematic breaks,
 * raw HTML and unclosed fences are rejected.
 */
export class UnsupportedPlateBlock extends Error {
  name: "UnsupportedPlateBlock";
}

/**
 * Convert Plate `serialize({ withBlockId: true })` output into plain CommonMark
 * carrying each block's id as an invisible trailing `<!-- stay: -->` marker
 * (SPEC §3/§4/§6) plus a §8 body hash. Throws {@link UnsupportedPlateBlock} on any
 * wrapper outside the supported subset, on a duplicate id, or on stray content.
 *
 * @param md Plate serializer output (`withBlockId: true`).
 * @returns plain Markdown + markstay markers (LF line endings).
 */
export function fromPlate(md: string): string;

/**
 * Convert markstay-marked Markdown back into Plate `withBlockId` form, re-wrapping
 * each marked block as `<block id="…">…</block>` so a marked doc can round-trip
 * through markstay without the content damage Plate's own deserialize inflicts.
 * Throws {@link UnsupportedPlateBlock} on an orphan / marker-in-fence / multi-id block.
 *
 * @param md markstay-marked Markdown.
 * @returns Plate `withBlockId` Markdown (LF line endings).
 */
export function toPlate(md: string): string;
