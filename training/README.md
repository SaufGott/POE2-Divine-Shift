# Training glyphs

Put one PNG per digit here and run:

```
node scripts/train.mjs
```

That writes `atlas.json`, which the dashboard loads at boot. Runtime learning adds samples on top
of it; **Reset clears the runtime samples but not this file**, so you never have to retrain.

## Folder layout

```
training/
  0.png
  1.png
  ...
  9.png
  3/
    2.png        <- extra samples for a digit go in its folder
```

The digit is taken from the first path segment, so `training/7/sample-1.png` trains `7`.

## How to crop

- **One digit per image.** Do not include the colon or the rest of the line.
- **Native resolution.** Do not resize, upscale or resample the screenshot — the pipeline does its
  own scaling, and resampling changes the stroke thickness.
- **Tight crop, but keep background.** At least 3 px of untouched game background around the glyph.
  The pipeline decides what "background" is by looking at the border of the image, so a crop that is
  all glyph cannot be classified.
- **Same font size as the live capture region.** Shapes are normalised to 16×16, so absolute size
  does not matter, but the ratio of stroke thickness to glyph height does.
- **No selection highlight, cursor, window border or watermark** inside the crop.
- PNG, 8-bit. Palette PNGs are fine — the reader handles colour types 0, 2, 3, 4 and 6.

The outline stays part of the shape on purpose. For a fixed game font the outline is part of the
glyph signature, and stripping it can eat a thin stroke.

## What the script reports

It prints one line per digit and lists every file that produced nothing, so you know exactly which
crop to redo. A digit with no readable glyph exits with status 1.
