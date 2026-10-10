# Angelico by Mhd Al Sousi

Luxury menswear storefront. Static site, no build step.

## Run

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

A server is needed (not `file://`) once the video frame sequence is enabled.

## Structure

```
index.html            page markup
css/style.css         design tokens (from the logo navy #2A3A4A) and layout
js/config.js          hero sequence switch, store currency
js/main.js            GSAP + ScrollTrigger + Lenis animations, shop logic
assets/brand/         logo extracted from the original artwork (transparent PNG)
assets/sequence/      Kling video frames (generated, see KLING.md)
scripts/extract-frames.sh   video to scroll frames
```

## Motion map

| Section | Effect |
|---|---|
| Loader | Logo mark wipe, counter, curtain lift |
| Hero (600vh pinned) | Man is dressed as you scroll: shirt, tie, jacket, finish, then logo reveal |
| Manifesto | Word by word scrubbed reveal |
| Marquee | Infinite, speeds up with scroll velocity |
| Collections | Pinned horizontal scroll gallery |
| Atelier | Counters, sticky stacking process cards |
| Shop | Filter transitions, 3D tilt, add to bag |
| Quote | Rotating parallax logo watermark |

Respects `prefers-reduced-motion`. Works without JavaScript CDNs (static fallback).

## Hero video

The hero ships with an animated illustration. Swap in a Kling AI video of a
man putting on his suit by following `KLING.md`.

## Placeholder content

Product names, prices (USD), atelier statistics and the appointment form
are placeholders. The form does not submit anywhere yet.
