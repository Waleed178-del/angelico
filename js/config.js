/*
  Angelico site configuration.

  HERO SEQUENCE
  The hero ships with an animated illustrated figure. To replace it with
  the Kling AI video (a man putting on his suit), render the clip, run
  scripts/extract-frames.sh, then set enabled to true. The frame count
  is written to assets/sequence/manifest.json by that script.
*/
window.ANGELICO_CONFIG = {
  sequence: {
    enabled: true,
    manifest: "assets/sequence/manifest.json"
  },
  currency: { code: "USD", locale: "en-US" }
};
