#!/usr/bin/env python3
"""
convert_frames.py
Converts the Blender PNG sequences into web frames for the scroll hero.

    pip install "pillow>=11.2"
    python tools/convert_frames.py --src ~/angelico_render --dst web/frames
    python tools/convert_frames.py --src ~/angelico_render --dst web/frames --avif

Input : <src>/desktop/frame_0001.png ... and <src>/mobile/frame_0001.png ...
Output: <dst>/desktop/frame_0001.webp (+ .avif) ... and a manifest.json per variant.

AVIF uses Pillow's native encoder when present (Pillow 11.2+ built with libavif),
otherwise the `avifenc` CLI from libavif. Neither is faked: if both are missing the
script stops and says so.
"""

import argparse
import json
import shutil
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

try:
    from PIL import Image, features
except ImportError:
    sys.exit("Pillow is required: pip install 'pillow>=11.2'")

VARIANTS = ("desktop", "mobile")


def avif_backend():
    if features.check("avif"):
        return "pillow"
    if shutil.which("avifenc"):
        return "avifenc"
    return None


def convert_one(job):
    src, out_dir, webp_q, avif_q, avif, max_w = job
    src = Path(src)
    out_dir = Path(out_dir)
    stem = src.stem
    with Image.open(src) as im:
        im = im.convert("RGB")
        if max_w and im.width > max_w:
            h = round(im.height * max_w / im.width)
            im = im.resize((max_w, h), Image.Resampling.LANCZOS)
        # method=6 is the slowest, smallest encode. Done once, served millions of times.
        im.save(out_dir / f"{stem}.webp", "WEBP", quality=webp_q, method=6)
        if avif == "pillow":
            im.save(out_dir / f"{stem}.avif", "AVIF", quality=avif_q, speed=4)
        elif avif == "avifenc":
            tmp = out_dir / f".{stem}.png"
            im.save(tmp, "PNG")
            subprocess.run(["avifenc", "-q", str(avif_q), "-s", "4", "-j", "1",
                            str(tmp), str(out_dir / f"{stem}.avif")],
                           check=True, capture_output=True)
            tmp.unlink()
        return im.size


def average_rgb(path):
    """Mean color of the last frame. The page also measures this live; the manifest copy
    lets you hard code it in CSS so the next section never flashes a wrong color."""
    with Image.open(path) as im:
        r, g, b = im.convert("RGB").resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    return [r, g, b]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--src", required=True, help="Blender OUTPUT_DIR")
    ap.add_argument("--dst", default="web/frames")
    ap.add_argument("--quality", type=int, default=80, help="WebP quality")
    ap.add_argument("--avif", action="store_true", help="also write AVIF")
    ap.add_argument("--avif-quality", type=int, default=60)
    ap.add_argument("--max-width", type=int, default=0,
                    help="downscale wider frames (e.g. 1920) to cut decode memory")
    ap.add_argument("--jobs", type=int, default=None)
    args = ap.parse_args()

    avif = None
    if args.avif:
        avif = avif_backend()
        if avif is None:
            sys.exit("AVIF requested but no encoder found. Install Pillow 11.2+ with libavif "
                     "or the avifenc CLI.")

    for variant in VARIANTS:
        frames = sorted(Path(args.src, variant).glob("frame_*.png"))
        if not frames:
            print(f"[skip] no PNG frames in {Path(args.src, variant)}")
            continue
        out = Path(args.dst, variant)
        out.mkdir(parents=True, exist_ok=True)
        jobs = [(str(f), str(out), args.quality, args.avif_quality, avif, args.max_width)
                for f in frames]
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            sizes = list(pool.map(convert_one, jobs))
        manifest = {
            "count": len(frames),
            "width": sizes[0][0],
            "height": sizes[0][1],
            "formats": ["avif", "webp"] if avif else ["webp"],
            "lastFrameRGB": average_rgb(frames[-1]),
        }
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
        total = sum(p.stat().st_size for p in out.glob("frame_*.webp"))
        print(f"[{variant}] {len(frames)} frames -> {out}  webp total {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
