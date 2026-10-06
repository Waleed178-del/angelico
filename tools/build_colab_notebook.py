#!/usr/bin/env python3
"""
build_colab_notebook.py
Writes colab/angelico_render_colab.ipynb with the current render script and frame
converter embedded, so the notebook is the only file you need to upload to Colab.
Re-run after editing blender/luxury_suit_scroll.py or tools/convert_frames.py.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "colab" / "angelico_render_colab.ipynb"


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n").splitlines(True)}


def code(text, title=None):
    meta = {"cellView": "form"} if title else {}
    return {"cell_type": "code", "metadata": meta, "execution_count": None, "outputs": [],
            "source": text.strip("\n").splitlines(True)}


def embedded(path, target):
    return code(f"%%writefile {target}\n" + (ROOT / path).read_text())


INTRO = """
# Angelico: render the suit hero on Colab GPUs

Run the cells top to bottom (**Runtime > Run all**). Rendered frames go straight to your
Google Drive, so a dropped session loses at most the frame that was in progress.
Run the notebook again with the same settings and it continues where it stopped.

**Before you start:** pick a GPU runtime in **Runtime > Change runtime type**.
A T4 works, L4 is about 2x faster, A100 about 4x faster.

| Step | Cell |
| --- | --- |
| 1 | Settings |
| 2 | GPU check and Drive |
| 3 | Install Blender (cached on Drive after the first run) |
| 4 to 5 | Write the render script and the converter (embedded, nothing to upload) |
| 6 | Render |
| 7 | Inspect frame 1 and the last frame |
| 8 | Convert to WebP and zip for the website |
"""

SETTINGS = r'''
#@title 1. Settings
PREVIEW = True  #@param {type:"boolean"}
#@markdown Preview renders at 25 percent with 32 samples. Check it before a final run.
VARIANTS = "desktop mobile"  #@param ["desktop mobile", "desktop", "mobile"]
SAMPLES = 384  #@param {type:"integer"}
#@markdown Final sample cap. 384 with the denoiser is close to 1024 in quality at about half the time.
NOISE_THRESHOLD = 0.02  #@param {type:"number"}
FRAME_START = 1  #@param {type:"integer"}
FRAME_END = 180  #@param {type:"integer"}
#@markdown Split work across sessions or accounts, e.g. 1 to 90 here and 91 to 180 elsewhere.
USE_CLOTH = False  #@param {type:"boolean"}
DRIVE_DIR = "/content/drive/MyDrive/angelico"  #@param {type:"string"}
HDRI_PATH = ""  #@param {type:"string"}
#@markdown Optional studio HDRI uploaded to Drive, e.g. /content/drive/MyDrive/angelico/studio.hdr
BLENDER_SERIES = "4.2"  #@param ["4.2", "4.5"]

OUTPUT_DIR = f"{DRIVE_DIR}/render_preview" if PREVIEW else f"{DRIVE_DIR}/render"
print("frames will be written to", OUTPUT_DIR)
'''

GPU_DRIVE = r'''
#@title 2. GPU check and Google Drive
import subprocess, os
gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                     capture_output=True, text=True)
if gpu.returncode != 0:
    raise SystemExit("No GPU. Runtime > Change runtime type > select a GPU, then run again.")
print("GPU:", gpu.stdout.strip())

from google.colab import drive
drive.mount("/content/drive")
os.makedirs(OUTPUT_DIR, exist_ok=True)
'''

INSTALL = r'''
#@title 3. Install Blender (official build from download.blender.org)
import re, urllib.request, os, subprocess, shutil

subprocess.run("apt-get -qq update && apt-get -qq install -y libxi6 libxxf86vm1 libxfixes3 "
               "libxrender1 libgl1 libegl1 libxkbcommon0 libsm6 > /dev/null", shell=True, check=True)

index = urllib.request.urlopen(f"https://download.blender.org/release/Blender{BLENDER_SERIES}/").read().decode()
patches = sorted({int(p) for p in re.findall(rf"blender-{re.escape(BLENDER_SERIES)}\.(\d+)-linux-x64\.tar\.xz", index)})
if not patches:
    raise SystemExit(f"No Linux build found for Blender {BLENDER_SERIES}")
name = f"blender-{BLENDER_SERIES}.{patches[-1]}-linux-x64"

# The tarball is about 350 MB. Cache it on Drive so later sessions skip the download.
cache = f"{DRIVE_DIR}/_cache/{name}.tar.xz"
os.makedirs(os.path.dirname(cache), exist_ok=True)
if not os.path.exists(cache):
    print("downloading", name)
    tmp = f"/content/{name}.tar.xz"
    subprocess.run(["wget", "-q", "-O", tmp,
                    f"https://download.blender.org/release/Blender{BLENDER_SERIES}/{name}.tar.xz"], check=True)
    shutil.copy(tmp, cache)
else:
    print("using cached", cache)
if not os.path.exists(f"/content/{name}"):
    subprocess.run(["tar", "-xf", cache, "-C", "/content"], check=True)
BLENDER = f"/content/{name}/blender"
print(subprocess.run([BLENDER, "--version"], capture_output=True, text=True).stdout.splitlines()[0])
'''

RENDER = r'''
#@title 6. Render (safe to stop and re-run: finished frames are skipped)
import subprocess, glob, os, time

# A session that dies mid frame leaves an empty placeholder file. Remove those so they
# are rendered again instead of being skipped forever.
for v in VARIANTS.split():
    for f in glob.glob(f"{OUTPUT_DIR}/{v}/frame_*.png"):
        if os.path.getsize(f) == 0:
            os.remove(f)

cmd = [BLENDER, "-b", "--python", "/content/luxury_suit_scroll.py", "--",
       "--preview" if PREVIEW else "--final",
       "--output", OUTPUT_DIR,
       "--variants", *VARIANTS.split(),
       "--frames", str(FRAME_START), str(FRAME_END),
       "--samples", str(SAMPLES),
       "--noise-threshold", str(NOISE_THRESHOLD),
       "--resume"]
if USE_CLOTH:
    cmd.append("--cloth")
if HDRI_PATH:
    cmd += ["--hdri", HDRI_PATH]
print(" ".join(cmd), "\n")

# Stream only meaningful lines; Cycles prints thousands of progress updates per frame.
t0, last = time.time(), 0.0
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
for line in proc.stdout:
    keep = ("Saved:" in line or "luxury_suit_scroll" in line or "Error" in line
            or "Traceback" in line or line.startswith("  File"))
    if keep or ("Sample" in line and time.time() - last > 30):
        print(f"[{(time.time() - t0) / 60:6.1f} min] {line.rstrip()}", flush=True)
        last = time.time() if not keep else last
proc.wait()
for v in VARIANTS.split():
    done = len([f for f in glob.glob(f"{OUTPUT_DIR}/{v}/frame_*.png") if os.path.getsize(f) > 0])
    print(f"{v}: {done} frames on Drive")
if proc.returncode != 0:
    raise SystemExit(f"Blender exited with code {proc.returncode}. See the lines above.")
'''

INSPECT = r'''
#@title 7. Inspect frame 1 (hero) and the last frame (should be pure wool weave)
from IPython.display import Image, display
import glob
for v in VARIANTS.split():
    frames = sorted(glob.glob(f"{OUTPUT_DIR}/{v}/frame_*.png"))
    if frames:
        print(v, "first and last:", frames[0].split("/")[-1], frames[-1].split("/")[-1])
        display(Image(frames[0], width=480))
        display(Image(frames[-1], width=480))
'''

CONVERT = r'''
#@title 8. Convert to WebP (quality 80) and zip for web/frames
MAKE_AVIF = False  #@param {type:"boolean"}
import subprocess, shutil
subprocess.run("pip -q install 'pillow>=11.2'", shell=True, check=True)
args = ["python", "/content/convert_frames.py", "--src", OUTPUT_DIR, "--dst", "/content/web_frames"]
if MAKE_AVIF:
    args.append("--avif")
subprocess.run(args, check=True)
zip_path = shutil.make_archive(f"{DRIVE_DIR}/web_frames{'_preview' if PREVIEW else ''}", "zip", "/content/web_frames")
print("saved", zip_path, "\nUnzip it into web/frames/ next to index.html.")
'''


def main():
    cells = [
        md(INTRO),
        code(SETTINGS, title=True),
        code(GPU_DRIVE, title=True),
        code(INSTALL, title=True),
        md("### 4. Render script (embedded copy of `blender/luxury_suit_scroll.py`)"),
        embedded("blender/luxury_suit_scroll.py", "/content/luxury_suit_scroll.py"),
        md("### 5. Frame converter (embedded copy of `tools/convert_frames.py`)"),
        embedded("tools/convert_frames.py", "/content/convert_frames.py"),
        code(RENDER, title=True),
        code(INSPECT, title=True),
        code(CONVERT, title=True),
    ]
    nb = {
        "nbformat": 4, "nbformat_minor": 0,
        "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
                     "kernelspec": {"name": "python3", "display_name": "Python 3"},
                     "language_info": {"name": "python"}},
        "cells": cells,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(nb, indent=1) + "\n")
    print("wrote", OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
