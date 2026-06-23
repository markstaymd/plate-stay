# plate-stay

[![npm](https://img.shields.io/npm/v/plate-stay)](https://www.npmjs.com/package/plate-stay)
[![bundle size](https://img.shields.io/bundlephobia/minzip/plate-stay)](https://bundlephobia.com/package/plate-stay)
[![tests](https://img.shields.io/github/actions/workflow/status/markstaymd/plate-stay/test.yml?label=tests)](https://github.com/markstaymd/plate-stay/actions/workflows/test.yml)
[![types](https://img.shields.io/badge/types-included-blue)](https://www.typescriptlang.org/)
[![spec](https://img.shields.io/badge/spec-v1.1-blue)](https://markstay.org)
[![License](https://img.shields.io/npm/l/plate-stay)](./LICENSE)

A fail-closed bridge between [Plate](https://platejs.org)'s `withBlockId` Markdown
serializer and [markstay](https://markstay.org)'s stable block ids.

## The problem

Plate's `@platejs/markdown` `serialize({ withBlockId: true })` wraps each block as
an MDX flow element, `<block id="…">…</block>` with a 2-space-indented body, "to
enable AI comment tracking". It is **serialize-only**: Plate's own deserialize
recovers no ids and corrupts content (headings, code, and quotes flatten to
paragraphs; inline marks drop). So the ids exist on the way out but there is no
sound way back in, and the visible wrapper leaks into the Markdown.

markstay supplies the missing half: a stable id ([SPEC §6](https://markstay.org)),
a body hash as drift evidence (§8), and §9 recovery, all carried in an invisible
trailing comment (`<!-- stay:… -->`) instead of a visible wrapper. `plate-stay`
maps between the two.

## Install

```sh
npm install plate-stay
```

Pulls in the [`markstay`](https://www.npmjs.com/package/markstay) core. Requires
Node >= 22.

## Usage

```js
import { fromPlate, toPlate, UnsupportedPlateBlock } from "plate-stay";

// Plate withBlockId output  ->  plain CommonMark + invisible markstay markers
const md = fromPlate(`<block id="aQ7bX1k9Lp">
  # Title
</block>`);
// => "# Title\n<!-- stay:aQ7bX1k9Lp hash=sha256:… -->\n"

// markstay-marked Markdown  ->  Plate withBlockId form (lossless round-trip)
const back = toPlate(md);

// Anything outside the supported 1:1 subset fails closed, it never silently corrupts.
try {
  fromPlate(listBearingPlateDoc);
} catch (e) {
  if (e instanceof UnsupportedPlateBlock) { /* handle / fall back */ }
}
```

The bridge is a string-level converter, **not** a general MDX parser. It honours
Plate's own block boundaries (it never re-segments) and introduces no new marker
syntax: `<block id>` is foreign input it translates; output is plain CommonMark
plus standard `<!-- stay: -->` markers, byte-identical to what `markstay`'s own
`stamp()` would produce.

## Supported subset (v1)

A wrapper maps cleanly only when its dedented body is a single blank-line block
(SPEC §5 baseline) **and** that block is one of the four kinds validated against
real Plate output: a heading, a paragraph, a single-paragraph blockquote, or a
**closed** fenced code block with no internal blank line.

Everything else throws `UnsupportedPlateBlock`. The rejections are honest spec
facts, not gaps to paper over:

- **Lists.** Plate wraps each list *item* as its own `<block>`, but markstay defers
  list-item identity (SPEC §5.1, §14): a marker only ever identifies the whole
  list, so per-item ids have nowhere to attach.
- **Loose / multi-paragraph blocks, and fences with an internal blank line.** Under
  the blank-line core these split into multiple blocks, so a single trailing marker
  would bind the wrong chunk.
- **Tables, thematic breaks, raw HTML blocks, unclosed fences.** Not validated
  against Plate's wrapping, and an unclosed fence would swallow the trailing marker.

Failing closed is the point: it is the opposite of Plate's deserialize, which
flattens what it cannot represent.

## Tests

```sh
npm install
npm test          # node --test
```

The suite round-trips the supported corpus, asserts ids carry 1:1 and the output
lint-passes, and asserts every unsupported shape fails closed.

## License

MIT
