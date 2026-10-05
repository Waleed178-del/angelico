# Angelico: scroll driven suit hero

Scrolling drives a 180 frame Cycles render of a mannequin in a navy two piece suit:
a 180 degree orbit, then a push in until the worsted weave fills the frame. That final
frame becomes the texture and color of the next section.

| Path | Role |
| --- | --- |
| `blender/luxury_suit_scroll.py` | Builds, animates and renders the scene (Blender 4.2+) |
| `tools/convert_frames.py` | PNG to WebP q80 (optional AVIF) plus `manifest.json` |
| `web/index.html` | Single file page: pinned canvas, GSAP ScrollTrigger from cdnjs |

## Scene plan

1. Clear the scene but keep text blocks, then build materials.
2. Import `MANNEQUIN_PATH` and `SUIT_PATH`, or build `PH_*` placeholders from ring lofts with UVs in meters.
3. Optional cloth: drape the jacket for 40 frames, then freeze the result into the mesh.
4. Room: 18 x 18 m travertine floor, walnut panels with brass inlays, shelving with folded garments, brass lamps.
5. Light: soft key, two warm rims (the orbit sees both sides), a bounce fill, and an HDRI that only glossy rays see.
6. Cameras: `CAM_desktop` (16:9) and `CAM_mobile` (9:16) on the same path, keyed on every frame with linear interpolation.
7. Render: Cycles with GPU detection, adaptive sampling, OIDN using albedo and normal passes, a fixed seed, AgX, and no motion blur.

## Run

1. Render a preview headless: `blender -b --python blender/luxury_suit_scroll.py -- --preview --output ~/angelico_render`
2. Check `~/angelico_render/desktop` and `mobile`. Frame 1 is the hero, frame 180 should be pure weave.
3. Render the final frames: the same command with `--final` (add `--cloth` to drape the jacket).
4. Convert the frames: `pip install "pillow>=11.2"` then `python tools/convert_frames.py --src ~/angelico_render --dst web/frames` (add `--avif` for AVIF).
5. Serve over HTTP: `cd web && python -m http.server 8000`. Opening the page as `file://` blocks the color sampling.
6. If you exported AVIF, set `formats: ['avif', 'webp']` in the page's `CONFIG`.

To review the scene interactively, open the script in Blender's Scripting workspace and run it.
In the UI it builds the scene without rendering.

## External dependencies (not faked)

* **Studio HDRI:** set `HDRI_PATH`. Without it, glossy rays see flat neutral grey.
* **Mannequin and suit:** the placeholders are stand ins. Real creasing and drape need a real garment asset.
  For an imported suit, set `LAPEL_POINT` and `LAPEL_NORMAL` from that asset and set `WEAVE_UV_SCALE` to its UV density.
* **GSAP 3.12.5:** loaded from cdnjs. If it fails to load, the page falls back to the static hero.
