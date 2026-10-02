# PoE2 Triangular Arbitrage Dashboard

A local, offline browser dashboard. No external servers, no APIs: everything runs in the
browser against files served from this folder.

```
node serve.mjs 8090                # static server on http://127.0.0.1:8090
node --test                        # math / parser / playbook / pipeline / training / storage / UI tests (50)
node scripts/fetch-vendor.mjs      # only if vendor/ is missing (needs network once)
```

`vendor/` is already populated (Tesseract worker, all WASM core builds, `eng.traineddata.gz`),
so the dashboard runs with no network at runtime.

Do **not** open `index.html` from `file://` — Web Workers are blocked there and `getDisplayMedia`
needs a secure context (`127.0.0.1` counts as secure).

## Layout

The page is a 2×2 grid sized to fit one viewport: capture is the tall left column (with the live
read under the region view), rates top-right, playbook bottom-right. The tuning options live in a
collapsed **Advanced** section, so the normal view is just: Start OCR, Place region, zoom, Snapshot,
coordinates. A collapsed **Shortcuts** section lists the keys. A collapsed
**Shortcuts** section lists the keys.

Only settings the app can actually change are persisted. `minScore`, `minArea`, `atlasSize`,
`tolerance` and the page-segmentation mode have no UI, so their defaults live in the pipeline
modules themselves rather than in stored state. `captured`, `history` and the runtime `atlas` were
removed: nothing reads them any more.

## The capture tab

One fixed region on the single market line, e.g. `1 : 690`. The only preview is that region itself.
The full frame appears only while placing the box.

1. **Start OCR** and pick the game window.
2. Press **Place region** (<kbd>P</kbd>) once, drag the box onto the market line, then turn it back
   off. You can also type the x/y coordinates directly. The position is stored as fractions of the
   frame it was placed on, so a window resize or a DPI change rebuilds it instead of landing
   somewhere wrong — the Advanced section shows the stored percentages. Tick **lock** (<kbd>L</kbd>)
   so it never moves or rescales again.
3. Zoom the view with the slider or <kbd>+</kbd> / <kbd>-</kbd> (1–8). Zoom changes only what you
   see; it never changes what is captured, so recognition is unaffected.
4. Click one of the three pair buttons (`Div / Ex`, `Omen / Ex`, `Div / Omen`) — or press
   <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> — to choose which pair the next snapshot fills.
5. Open that trade pair in game, press **Snapshot value** (<kbd>Space</kbd>) — the reading is stored
   for that pair and the tool moves to the next one.
6. The live read is one compact line: the pair, the raw text, the parsed value, `confidence xx%`, and
   the stable-read streak — capped at the number it needs, green when it hits it. Nothing enters the
   calculation until you snapshot (or a stable read is accepted).
7. Rates stay manually editable; paste (Ctrl+V) or drop a screenshot if window capture is unavailable.

A line is read as `first : second`, so `1 : 680` = 680 quote per 1 base. A lone number is taken as
the rate. Crops are padded 2 px and upscaled with nearest-neighbour.

Defaults are the values that actually work: threshold **auto (Otsu)**, capture scale 3, min stroke 2.
The region defaults to **100 × 30**, which is enough for `1 : 690` at the game's font size.

## Offsetting a rate

Each rate row has **−** and **+** buttons that move it by the offset step (default `1`, changeable in
the Rates panel). This is for undercutting or overcutting the market to get a faster trade.

The arithmetic stays exact, so decimal rates work: `4.5` is stored as `9/2`, `+ 1` gives `11/2`,
`− 1` gives `7/2`. A row touched by +/– is marked `adjusted` so you can see which numbers are yours
and which came from a snapshot.

What a +/– or a suggestion changed is shown in the **Change** column right after the rate, per row:

```
Div / Ex    49 / 1   [−][+]      48 → 49      adjusted
```

That indicator is session-only. It is not stored, and it is not written to the status line in the
capture panel any more.

## The rate is always per 1

The `1` in every pair is fixed and not editable — a rate is always quote per 1 reference item. The
value input shows what you typed (`4.5`), not the reduced fraction (`9/2`); the exact rational is
still what the playbook computes with, and the input's tooltip shows it.

## How recognition works

The image work is pure and testable (`src/pipeline/`), and the browser module only moves pixels
between the DOM and those functions:

1. `gray.js` — luma from RGBA.
2. `threshold.js` — Otsu (default), a fixed cutoff, or a local mean for panels with vignette.
3. `outline.js` — find which class is the background from the border, then measure how far each
   remaining pixel is from the nearest background pixel. A 1 px outline ring sits at distance 1 and
   is dropped; a real stroke is deeper and survives. `min stroke` is that threshold (default 2).
   A majority-neighbour rule cannot do this: a ring pixel touching the glyph has more glyph
   neighbours than background ones — that is why the earlier version did not help.
   `processFrame` returns **two** masks: `raw` (unstripped, used by the atlas — the training step
   never strips, so the live path must not either) and `mask` (stripped, used only for Tesseract).
   Matching a stripped live glyph against unstripped templates scored 0.61–0.77, below the 0.8
   threshold, which is why the atlas path failed before this was fixed.
4. `segment.js` — connected components, left-to-right. Blobs much shorter than the tallest one are
   separators (the colon), never classified as digits.
5. `atlas.js` — the **self-learning glyph atlas**. Each confirmed read stores what a digit looks
   like in your font (normalised 16×16, up to 5 samples per digit). Once a digit is learned it is
   matched locally, without Tesseract.
6. `recognize.js` — segment, classify, rebuild the line. `complete` means every glyph matched;
   otherwise the engine falls back to Tesseract.

The vendored Tesseract bundle is text-only — it exposes no confidence and no word boxes — so the
**confidence** number in the live read is the pipeline's own signal: the average match score over the
glyph shapes in the crop. It is not a Tesseract confidence.

**Training is offline.** The app loads `training/atlas.json` at boot and does not learn at runtime —
there is no Train button and no glyph panel. Add or replace PNGs in `training/`, run the script,
reload the page.

### Training from a folder of screenshots

Put one PNG per digit in `training/` and run `node scripts/train.mjs`:

```
training/0.png ... training/9.png
training/3/2.png        <- extra samples for a digit go in its folder
```

The script decodes each PNG with a dependency-free reader (`src/pipeline/png.js`, colour types
0/2/3/4/6), runs the same threshold + segmentation path, normalises the glyph to 16×16 and writes
`training/atlas.json`. The dashboard loads that file at boot as the **base** atlas; runtime learning
adds samples on top in localStorage. **Reset clears the runtime samples but not the base**, so you
never have to retrain. The script prints one line per digit and lists every file that produced
nothing, so you know which crop to redo.

Cropping rules: one digit per image, native resolution (no resizing), tight but with at least 3 px of
untouched game background around the glyph — the pipeline decides what "background" is by looking at
the image border — and the same font size as the live capture region. The outline stays part of the
shape on purpose; for a fixed font it is part of the glyph signature, and stripping it can eat a thin
stroke. Full rules in [training/README.md](training/README.md).

Matching uses a 1 px tolerance: a pixel counts as matching if it or a neighbour matches, averaged over
both directions. Exact matching fails on a one-pixel shift or on anti-aliasing differences between a
training crop and a live capture; tolerant matching does not.

**Stable read.** Off by default. When enabled, a value is accepted only after it has been read
identically N times (default 3), so animation or a half-painted frame cannot fill a wrong number.

**Cache.** An unchanged crop returns the text it produced before, not nothing — that was the
"recognises the number, then says no number" bug. A snapshot that reads nothing falls back to the
last value seen for that pair, shown as `(last seen)`. The live read throttles to one call per
400 ms.

## Budget

The budget input sits in the **Executable playbook** tab, because the batch the playbook prints is
the part of the budget the engine can actually use. It is the most units of C1 you can commit; the
engine takes the largest multiple of the minimal exact batch that fits inside it (`0` = no cap, just
the minimal batch).

```
rates 48 / 4.5 / 10  ->  minimal exact batch 15 Div, budget 100 -> batch 90 (6x), net +6 Div
```

If the budget is below one exact batch you get a warning; **allow leftovers is on by default**, so
each step trades the largest whole multiple that fits and the remainder is shown — a batch of 1 unit
stays usable when the rates are already integers:

```
1 Div = 680 Ex, 1 Omen = 450 Ex, 1 Div = 1 Omen
exact batch = 45 Div (45 -> 30600 Ex -> 68 Omen -> 68 Div, net +23)
budget 1 + leftovers = 1 Div -> 680 Ex -> 1 Omen (leftover 230 Ex) -> 1 Div
```

### Decimal rates and the nearest fitting ratio

Decimal rates are exact rationals, so `4.5` is `9/2` and the playbook quantizes it to `2 Omen = 9 Ex`.
A rate like `4.67` is `467/100`, which pushes the minimal exact batch up to 467 — you would have to
trade 467 units of C1 before every step is a whole number.

When the budget cannot cover that, the Rates panel warns you and puts a button on that row with the
closest ratio that does fit. Press it and the entered value is replaced.

```
4.67  -> exact batch 467, budget 100
nearest that fits: 4.68 (117/25, batch 39)   [-> 4.68]
```

It searches denominators from 1 upward, takes the nearest numerator for each, and keeps the candidates
whose batch fits the budget. It returns the closest one, not the simplest: `4.5` would also fit at
batch 15, but `4.68` is nearer to what you typed. Nothing changes until you press the button.

## What it computes

- **3-step loop** `C1 -> C2 -> Item -> C1` with exact rational arithmetic, both directions,
  profitable one highlighted.
- **Strict integer quantization** — smallest batch where all three steps are whole numbers
  (LCM-style), e.g. `1 item = 4.5 Ex` becomes `2 items = 9 Ex`.
- **Executable playbook** — one line per step, formatted as
  `Step 2: Buy 382 Omen for 3438 Ex @ 9 (leftover 2 Ex)`, plus the net line. No copy buttons.

Order splitting, the P&L panel, the cross-rate check text, the Settings panel, the Export button, the
Snapshot values panel (it repeated the rates table), the Learned glyphs panel and the in-app Train
button were removed on request — the net line at the bottom of the playbook covers the profit/ROI, and
Reset now lives in the playbook tab.

## Look

The palette, font stack, spacing, shadows and animation speeds are taken from the official PoE2
trade CSS reference in `Assets/`: `--color-night-*` backgrounds, `--color-sand-*` for headings and
accents, `--color-danger` / `--color-sunset` for warnings, the `--space-*` scale, and
`--animation-speed-quick/normal`. Panel frames reproduce the game's `border-image-slice: 17` with an
inline SVG (gold corners, sand edge) so nothing is fetched.

Fonts are the ones you provided: `Assets/fontin-regular-webfont.woff` and
`Assets/fontin-smallcaps-webfont.woff`, with the reference's fallback stack. Numbers stay in a
monospace fallback so the live read does not jitter. Animations respect `prefers-reduced-motion`.

## Files

| Path | Purpose |
| --- | --- |
| [index.html](index.html) | Panels: capture (with live read, snapshot values, learned glyphs), rates, playbook |
| [styles.css](styles.css) | PoE2 palette, Fontin, panel frame, toasts, animations |
| [src/math.js](src/math.js) | Rational arithmetic, cycle factor, minimal batch, budget plan |
| [src/parser.js](src/parser.js) | OCR line -> exact ratio, digit-confusion normalisation |
| [src/playbook.js](src/playbook.js) | Numbered step lines + net |
| [src/pipeline/gray.js](src/pipeline/gray.js) | Luma, frame hash |
| [src/pipeline/threshold.js](src/pipeline/threshold.js) | Otsu, fixed cutoff, local mean |
| [src/pipeline/outline.js](src/pipeline/outline.js) | Outline removal by distance to background |
| [src/pipeline/segment.js](src/pipeline/segment.js) | Connected components, glyph vs separator |
| [src/pipeline/atlas.js](src/pipeline/atlas.js) | Learn and match glyph shapes (exact + tolerant) |
| [src/pipeline/recognize.js](src/pipeline/recognize.js) | Segment -> classify -> rebuild the line |
| [src/pipeline/stability.js](src/pipeline/stability.js) | Stable-read streak logic |
| [src/pipeline/cache.js](src/pipeline/cache.js) | Unchanged crop returns the cached text |
| [src/pipeline/png.js](src/pipeline/png.js) | Dependency-free PNG reader for the training step |
| [src/pipeline/train.js](src/pipeline/train.js) | Cropped glyph image -> atlas bitmap |
| [src/ocr.js](src/ocr.js) | Tesseract worker (local paths), DOM crop, capture |
| [src/ui.js](src/ui.js) | Rendering: pair buttons, live read, region view, rates, playbook, toasts |
| [src/suggest.js](src/suggest.js) | Nearest ratio to an entered rate that fits the budget |
| [src/main.js](src/main.js) | State, event wiring, live OCR loop, snapshot flow, shortcuts |
| [src/storage.js](src/storage.js) | localStorage persistence, region as fractions of the frame |
| [serve.mjs](serve.mjs) | Dependency-free static server |
| [scripts/fetch-vendor.mjs](scripts/fetch-vendor.mjs) | One-time asset download into `vendor/` |
| [scripts/train.mjs](scripts/train.mjs) | Train the atlas from `training/*.png` |
| [training/README.md](training/README.md) | Cropping rules for the training folder |
| [tests/math.test.mjs](tests/math.test.mjs) | Math / parser / playbook tests |
| [tests/pipeline.test.mjs](tests/pipeline.test.mjs) | Threshold, outline, segmentation, atlas, stable read, cache |
| [tests/train.test.mjs](tests/train.test.mjs) | PNG reader, glyph extraction, tolerant matching |
| [tests/suggest.test.mjs](tests/suggest.test.mjs) | Nearest fitting ratio, decimal formatting |
| [tests/storage.test.mjs](tests/storage.test.mjs) | Stored keys, region fractions, rebuild on a new frame size |
| [tests/ui.test.mjs](tests/ui.test.mjs) | Live read, offset buttons, change column, suggestion button, column order |
| [tests/dom-stub.mjs](tests/dom-stub.mjs) | Minimal DOM stub so `src/ui.js` is testable in Node |

## Assumptions

- Trade ratios are exact; decimals like `4.5` are treated as exact rationals, never floats.
- **No gold cap and no gold-fee modeling** — removed on request. PoE2 per-transaction gold fees are
  not publicly documented anyway, so any number would be a guess.
- `C1`, `C2`, `Item` are editable labels.
- One Tesseract worker, `eng` only, PSM single line, no whitelist. The glyph atlas is preferred;
  Tesseract is the fallback while the atlas is incomplete.

## Troubleshooting

- The storage key is now `poe2-arb-dashboard-v5`, so the region, rates and the atlas reset to
  defaults — re-place the capture box once, then lock it.
- `vendor/ assets missing` banner → run `node scripts/fetch-vendor.mjs` once, then reload.
- A row shows empty text → the crop preview tells you whether the box is on the digits; make the
  row taller, try `local mean` thresholding, or type the value manually.
- Recognition keeps failing on your font → add a crop for that digit to `training/`, run
  `node scripts/train.mjs`, reload.
- Capture permission denied → paste a screenshot (Ctrl+V) or drop an image file.
