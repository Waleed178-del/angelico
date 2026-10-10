#!/usr/bin/env bash
# Convert the Kling hero video into a scroll-scrubbed frame sequence.
# Usage: scripts/extract-frames.sh path/to/kling-suit.mp4 [fps] [width]
set -euo pipefail

VIDEO="${1:?Usage: $0 video.mp4 [fps] [width]}"
FPS="${2:-24}"
WIDTH="${3:-1600}"
OUT="assets/sequence"

command -v ffmpeg >/dev/null || { echo "ffmpeg is required"; exit 1; }
mkdir -p "$OUT"
rm -f "$OUT"/frame_*.webp

ffmpeg -loglevel error -i "$VIDEO" \
  -vf "fps=${FPS},scale=${WIDTH}:-2:flags=lanczos" \
  -c:v libwebp -quality 78 -compression_level 6 \
  "$OUT/frame_%04d.webp"

COUNT=$(find "$OUT" -name 'frame_*.webp' | wc -l | tr -d ' ')
cat > "$OUT/manifest.json" <<JSON
{ "path": "${OUT}/frame_", "count": ${COUNT}, "pad": 4, "ext": "webp" }
JSON

echo "Wrote ${COUNT} frames to ${OUT}. Set sequence.enabled = true in js/config.js"
