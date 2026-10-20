/*
  Hero "camera tour". Instead of hundreds of video frames, a virtual camera moves
  over three high resolution photos as the visitor scrolls. It is drawn on a canvas
  every animation frame, so the motion is as smooth as the screen allows and only
  three images (about 0.5 MB) are downloaded.

  Each shot says where the camera looks at a point of the scroll:
    t      position in the hero scroll, 0 to 1
    img    which photo
    cx, cy the point of the photo at the centre of the screen (0 to 1)
    z      zoom on top of "cover" (1 = photo just fills the screen)
    end    the closing shot, which leaves room for the logo
*/
(() => {
  "use strict";

  const IMAGES = {
    suit: "assets/hero/suit.webp",
    detail: "assets/hero/detail.webp",
    shoes: "assets/hero/shoes.webp"
  };

  // Shots line up with the four captions (The Shirt, The Tie, The Jacket, The Finish).
  const SHOTS = [
    { t: 0.00, img: "suit", cx: 0.50, cy: 0.46, z: 1.00 },
    { t: 0.08, img: "suit", cx: 0.50, cy: 0.42, z: 1.08 },
    { t: 0.20, img: "suit", cx: 0.50, cy: 0.20, z: 2.30 },   // I   collar and knot
    { t: 0.29, img: "suit", cx: 0.50, cy: 0.25, z: 2.10 },
    { t: 0.34, img: "detail", cx: 0.50, cy: 0.17, z: 1.90 }, // II  the tie
    { t: 0.48, img: "detail", cx: 0.50, cy: 0.40, z: 1.70 },
    { t: 0.56, img: "detail", cx: 0.71, cy: 0.48, z: 2.30 }, // III pocket square
    { t: 0.70, img: "detail", cx: 0.66, cy: 0.44, z: 1.85 },
    { t: 0.78, img: "detail", cx: 0.30, cy: 0.79, z: 2.40 }, // IV  cufflink
    { t: 0.82, img: "detail", cx: 0.30, cy: 0.79, z: 2.55 },
    { t: 0.86, img: "shoes", cx: 0.52, cy: 0.66, z: 1.45 },  //     the brogues
    { t: 0.90, img: "shoes", cx: 0.52, cy: 0.70, z: 1.25 },
    { t: 0.95, img: "suit", cx: 0.40, cy: 0.48, z: 1.15, end: true },
    { t: 1.00, img: "suit", cx: 0.40, cy: 0.48, z: 1.15, end: true }
  ];

  /* ---- preload, started as soon as this file runs ---- */
  const listeners = new Set();
  let loaded = 0;
  const total = Object.keys(IMAGES).length;
  const images = {};
  const ready = Promise.all(Object.entries(IMAGES).map(([key, src]) => new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    const done = (ok) => { loaded += 1; if (ok) images[key] = img; listeners.forEach((fn) => fn(loaded, total)); resolve(); };
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => done(true));
    img.onerror = () => done(false);
    img.src = src;
  }))).then(() => images);

  const onProgress = (fn) => { listeners.add(fn); fn(loaded, total); return () => listeners.delete(fn); };

  /* ---- maths ---- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (u) => u * u * u * (u * (u * 6 - 15) + 10); // smootherstep
  const lerp = (a, b, u) => a + (b - a) * u;
  const lerpZoom = (a, b, u) => Math.exp(lerp(Math.log(a), Math.log(b), u)); // even feeling zoom

  function create(canvas, { rtl = false } = {}) {
    const ctx = canvas.getContext("2d", { alpha: false });
    let target = 0;
    let queued = false;

    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      draw();
    }

    // Phones show a narrow slice of a landscape photo, so they need less zoom and a centred ending.
    function pose(shot) {
      const portrait = canvas.width < canvas.height;
      let { cx, cy, z } = shot;
      if (portrait) { z = 1 + (z - 1) * 0.6; if (shot.end) cx = 0.5; }
      else if (rtl && shot.end) cx = 1 - cx; // the logo sits on the other side in Arabic
      return { cx, cy, z };
    }

    function paint(img, { cx, cy, z }, alpha) {
      if (!img) return;
      const cw = canvas.width, ch = canvas.height;
      const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight) * z;
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const x = clamp(cw / 2 - cx * dw, cw - dw, 0);
      const y = clamp(ch / 2 - cy * dh, ch - dh, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, x, y, dw, dh);
    }

    function draw() {
      queued = false;
      if (!images.suit) return;
      const p = clamp(target, 0, 1);
      let i = 0;
      while (i < SHOTS.length - 2 && p > SHOTS[i + 1].t) i += 1;
      const a = SHOTS[i], b = SHOTS[i + 1];
      const u = ease(clamp((p - a.t) / (b.t - a.t || 1), 0, 1));
      const pa = pose(a), pb = pose(b);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#121a24";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (a.img === b.img) {
        paint(images[a.img], { cx: lerp(pa.cx, pb.cx, u), cy: lerp(pa.cy, pb.cy, u), z: lerpZoom(pa.z, pb.z, u) }, 1);
      } else {
        // A cut: the outgoing shot keeps pushing in while the next one settles into place.
        paint(images[a.img] || images.suit, { ...pa, z: pa.z * (1 + 0.08 * u) }, 1);
        paint(images[b.img] || images.suit, { ...pb, z: pb.z * (1.08 - 0.08 * u) }, u);
      }
      ctx.globalAlpha = 1;
    }

    function render(progress) {
      target = progress;
      if (!queued) { queued = true; requestAnimationFrame(draw); }
    }

    window.addEventListener("resize", size);
    size();
    return { render, size };
  }

  window.AngelicoHeroTour = { IMAGES, SHOTS, ready, onProgress, create, get loaded() { return { ...images }; } };
})();
