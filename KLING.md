# Hero video: Kling AI production brief

The hero is a pinned scroll section (600vh). Scroll position scrubs a frame
sequence, so the video must read well **frame by frame, played forward and
backward**. Static locked camera, slow continuous action, no cuts.

## Shot plan

One continuous 10 second clip, 16:9, 1080p. If your Kling plan caps clips at
5 seconds, generate two clips and chain them: use the last frame of clip A as
the start frame of clip B.

| Scroll % | Action | Caption on screen |
|---|---|---|
| 0 to 20 | Man stands in white undershirt, facing camera, cropped chin to hips | Intro |
| 20 to 45 | He buttons a crisp white dress shirt, collar up | I. The Shirt |
| 45 to 65 | He knots a gold silk tie, lowers the collar | II. The Tie |
| 65 to 85 | He swings on a midnight navy jacket, settles the shoulders | III. The Jacket |
| 85 to 100 | He fastens the button, adjusts cuffs, gold pocket square visible | IV. The Finish |

Keep his face out of frame or in soft shadow so the brand stays the hero and
no likeness rights issues arise.

## Step 1: start frame (Kling image generation)

```
Editorial luxury menswear photograph, a well built man standing perfectly
still facing the camera, framed from the chin to the hips, wearing a fitted
white undershirt and tailored midnight navy trousers. Deep navy studio
backdrop color #2A3A4A, soft warm gold rim light from both sides, subtle
haze, symmetrical composition, centered, shallow depth of field, 85mm lens,
ultra detailed fabric texture, cinematic, quiet, expensive.
Aspect 16:9.
```

## Step 2: end frame (Kling image generation, use step 1 as reference)

```
Same man, same pose, same framing, same lighting and backdrop. Now fully
dressed in a bespoke midnight navy two piece suit with sharp peak lapels,
crisp white dress shirt, gold silk tie, gold pocket square, two gold
buttons fastened. Immaculate tailoring, editorial luxury menswear.
```

## Step 3: video (Kling image to video, start + end frame)

```
Static locked off camera, no camera movement. The man calmly dresses in
one continuous motion: he puts on and buttons a white dress shirt, knots a
gold silk tie, then slips on a midnight navy suit jacket, settles the
shoulders, fastens the button and adjusts his cuffs. Slow, deliberate,
elegant movement. Consistent lighting, navy backdrop, warm gold rim light,
luxury fashion film, 24fps.
Negative: camera shake, zoom, cuts, extra people, text, logos, warped hands,
fabric morphing.
```

Settings: professional / high quality mode, 10s, 16:9, start frame = step 1,
end frame = step 2, creativity low (around 0.3) to keep the figure stable.

## Step 4: wire it into the site

```bash
scripts/extract-frames.sh ~/Downloads/angelico-suit.mp4 24 1600
```

Then in `js/config.js` set `sequence.enabled: true`. The illustrated SVG figure
is replaced by the video frames. Captions, progress bar and the final logo
reveal keep running on the same timeline.

Budget: 10s at 24fps is 240 WebP frames, about 60 to 90 KB each at 1600px,
so roughly 15 to 20 MB. For mobile, run a second pass at width 900 and
fps 18 if load time matters.
