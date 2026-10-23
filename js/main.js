(async () => {
  "use strict";

  const CFG = window.ANGELICO_CONFIG || {};
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";

  /* ---------------- Loader ----------------
     It is only on screen while real work happens: fetching the content and the
     hero photos. The bar shows that progress, nothing is faked. */
  const tour = window.AngelicoHeroTour;
  const loaderBar = $(".loader__bar span");
  const loaderShownAt = performance.now();
  let contentDone = 0, imgDone = 0, imgTotal = 0;
  const setBar = () => { if (loaderBar) loaderBar.style.transform = `scaleX(${(contentDone + imgDone) / (1 + imgTotal)})`; };
  if (hasGsap && !reduced) gsap.to(".loader__mark", { clipPath: "inset(0% 0 0 0)", duration: 0.8, ease: "power3.inOut" });

  /* ---------------- Content (edited from /admin) ---------------- */
  let loaded;
  try {
    loaded = await window.AngelicoContent.load();
  } catch (err) {
    console.error("Angelico: could not load content", err);
    const l = document.createElement("p");
    l.className = "loader__msg";
    l.textContent = "Could not load the page. Please refresh.";
    $(".loader")?.appendChild(l);
    return;
  }
  contentDone = 1; setBar();
  const content = loaded.data;
  window.AngelicoContent.render(content, { preview: loaded.preview });
  const AC = window.AngelicoContent;
  const rtl = AC.lang === "ar";
  const t = AC.L;
  const ui = (key, vars) => AC.ui(content, key, vars);
  const products = (content.shop?.products || []).filter((p) => p.visible !== false);
  $(".nav__lang")?.addEventListener("click", () => AC.setLang(rtl ? "en" : "ar"));
  const grid = $("#grid");

  /* ---------------- Bag + toast ---------------- */
  let bag = 0;
  const toast = $(".toast");
  let toastT;
  const say = (msg) => {
    toast.textContent = msg;
    toast.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove("is-on"), 2400);
  };
  grid.addEventListener("click", (e) => {
    const b = e.target.closest(".product__add");
    if (!b) return;
    bag += 1;
    $(".nav__count").textContent = bag;
    say(ui("addedToBag", { name: t(products[b.dataset.i].name) }) || "Added");
    if (hasGsap) gsap.fromTo(".nav__count", { scale: 1.8 }, { scale: 1, duration: 0.7, ease: "elastic.out(1, .4)" });
  });

  /* ---------------- Filters ---------------- */
  $$(".filters button").forEach((btn) => btn.addEventListener("click", () => {
    $$(".filters button").forEach((b) => b.classList.toggle("is-active", b === btn));
    const f = btn.dataset.filter;
    const items = $$(".product");
    const apply = () => items.forEach((it) => it.classList.toggle("is-hidden", f !== "all" && it.dataset.cat !== f));
    if (!hasGsap || reduced) { apply(); return; }
    gsap.to(items, { opacity: 0, y: 20, duration: 0.25, stagger: 0.02, onComplete: () => {
      apply();
      gsap.fromTo(items.filter((it) => !it.classList.contains("is-hidden")), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.06, ease: "power3.out" });
      ScrollTrigger.refresh();
    } });
  }));

  /* ---------------- Form ---------------- */
  $(".form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const msg = $(".form__msg", f);
    const settings = content.settings || {};
    if (!f.name.value.trim() || !/^\S+@\S+\.\S+$/.test(f.email.value)) {
      msg.textContent = ui("formInvalid") || "Please share your name and a valid email.";
      return;
    }
    const payload = { name: f.name.value.trim(), email: f.email.value.trim(), interest: f.interest.value, date: f.date.value };
    const done = t(content.appointment?.success) || "Thank you. The atelier will contact you shortly.";
    if (f.website && f.website.value) { msg.textContent = done; f.reset(); return; } // hidden field only bots fill in
    if (AC.hasBackend()) {
      msg.textContent = ui("formSending") || "Sending...";
      try {
        await AC.submitAppointment({ name: payload.name, email: payload.email, interest: payload.interest || null, preferred_date: payload.date || null, lang: AC.lang });
        msg.textContent = done;
        f.reset();
      } catch (err) {
        msg.textContent = ui("formFailed") || "We could not send your request. Please try again shortly.";
      }
    } else if (settings.formEndpoint) {
      msg.textContent = ui("formSending") || "Sending...";
      try {
        const res = await fetch(settings.formEndpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(String(res.status));
        msg.textContent = done;
        f.reset();
      } catch (err) {
        msg.textContent = ui("formFailed") || "We could not send your request. Please try again shortly.";
      }
    } else if (settings.contactEmail) {
      const body = `Name: ${payload.name}%0D%0AEmail: ${payload.email}%0D%0AInterest: ${payload.interest}%0D%0APreferred date: ${payload.date || "any"}`;
      window.location.href = `mailto:${settings.contactEmail}?subject=${encodeURIComponent(ui("emailSubject") || "Appointment request")}&body=${body}`;
      msg.textContent = done;
      f.reset();
    } else {
      msg.textContent = ui("formNotConnected") || "This form is not connected yet. Please contact the atelier directly.";
    }
  });

  /* ---------------- Menu ---------------- */
  const burger = $(".nav__burger");
  const menu = $(".menu");
  const toggleMenu = (open) => {
    burger.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("is-open", open);
    menu.setAttribute("aria-hidden", String(!open));
  };
  burger.addEventListener("click", () => toggleMenu(burger.getAttribute("aria-expanded") !== "true"));

  /* ---------------- Hero style ----------------
     video (default): the Kling frame sequence, a man putting on his suit
     camera: virtual camera over the suit photos, see js/hero-tour.js      illustration: the drawn figure */
  const hero = $("#hero");
  const heroMode = content.hero?.mode || "video";
  let camera = null;
  if (heroMode === "camera" && tour) {
    tour.onProgress((n, total) => { imgDone = n; imgTotal = total; setBar(); });
    tour.start();
    hero.classList.add("has-camera");
    camera = tour.create($(".hero__canvas"), { rtl });
    tour.ready.then((imgs) => {
      if (!imgs.suit) { hero.classList.remove("has-camera"); camera = null; return; } // photos failed: show the illustration
      camera.size();
    });
  }

  /* ---------------- Wardrobe: a horizontal scroller the visitor controls ---------------- */
  const track = $(".collections__track");
  const arrows = $$(".collections__nav button");
  const syncArrows = () => {
    const max = track.scrollWidth - track.clientWidth - 2;
    const pos = Math.abs(track.scrollLeft); // negative in right to left pages
    arrows.forEach((b) => { b.disabled = b.dataset.dir === "-1" ? pos <= 2 : pos >= max; });
  };
  arrows.forEach((b) => b.addEventListener("click", () => {
    const card = $(".card", track);
    const stepBy = card ? card.offsetWidth + parseFloat(getComputedStyle(track).columnGap || 24) : track.clientWidth * 0.8;
    track.scrollBy({ left: Number(b.dataset.dir) * stepBy * (rtl ? -1 : 1), behavior: reduced ? "auto" : "smooth" });
  }));
  track.addEventListener("scroll", syncArrows, { passive: true });
  window.addEventListener("resize", syncArrows);
  syncArrows();

  /* ---------------- No animation path ---------------- */
  if (!hasGsap || reduced) {
    document.body.classList.remove("is-loading");
    $(".loader").remove();
    $$(".stat b").forEach((b) => (b.textContent = b.dataset.count));
    if (camera) tour.ready.then(() => camera.render(0));
    $$("a[href^='#']").forEach((a) => a.addEventListener("click", () => toggleMenu(false)));
    if (hasGsap) {
      gsap.set(".clip-shirt", { attr: { height: 660 } });
      gsap.set(".clip-tie", { attr: { height: 400 } });
      gsap.set(".f-trace", { opacity: 0 });
    } else {
      $(".clip-shirt").setAttribute("height", 660);
      $(".clip-tie").setAttribute("height", 400);
    }
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ---------------- Smooth scroll ---------------- */
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({
      duration: 1.25, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      // Sideways trackpad swipes over the Wardrobe row scroll the row, not the page.
      virtualScroll: ({ deltaX, deltaY, event }) => !(Math.abs(deltaX) > Math.abs(deltaY) && event.target.closest?.(".collections__track"))
    });
    lenis.stop();
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  $$("a[href^='#']").forEach((a) => a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    const target = id === "#top" ? 0 : $(id);
    if (target === null) return;
    e.preventDefault();
    toggleMenu(false);
    lenis ? lenis.scrollTo(target, { duration: 1.8 }) : window.scrollTo({ top: target ? target.offsetTop : 0, behavior: "smooth" });
  }));

  /* ---------------- Cursor + magnetic ----------------
     Only for a real mouse. It appears on the first mouse movement (so it never sits
     stranded in a corner) and disappears as soon as a finger or pen is used. */
  const cursor = $(".cursor");
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    const root = document.documentElement;
    const dx = gsap.quickTo(".cursor__dot", "x", { duration: 0.15 });
    const dy = gsap.quickTo(".cursor__dot", "y", { duration: 0.15 });
    const rx = gsap.quickTo(".cursor__ring", "x", { duration: 0.55, ease: "power3" });
    const ry = gsap.quickTo(".cursor__ring", "y", { duration: 0.55, ease: "power3" });
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") { root.classList.remove("has-cursor"); return; }
      if (!root.classList.contains("has-cursor")) { gsap.set([".cursor__dot", ".cursor__ring"], { x: e.clientX, y: e.clientY }); root.classList.add("has-cursor"); }
      dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY);
    });
    window.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") root.classList.remove("has-cursor"); });
    document.addEventListener("mouseleave", () => root.classList.remove("has-cursor"));
    document.addEventListener("pointerover", (e) => {
      cursor.classList.toggle("is-view", !!e.target.closest("[data-cursor]") && !e.target.closest("button"));
      cursor.classList.toggle("is-hover", !!e.target.closest("a, button, input, select"));
    });
    $$("[data-magnetic]").forEach((el) => {
      const mx = gsap.quickTo(el, "x", { duration: 0.6, ease: "elastic.out(1, .4)" });
      const my = gsap.quickTo(el, "y", { duration: 0.6, ease: "elastic.out(1, .4)" });
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.35);
        my((e.clientY - r.top - r.height / 2) * 0.35);
      });
      el.addEventListener("pointerleave", () => { mx(0); my(0); });
    });
  }

  /* ---------------- Nav state ---------------- */
  const nav = $(".nav");
  ScrollTrigger.create({
    start: 80,
    end: "max",
    onUpdate: (self) => {
      nav.classList.toggle("is-scrolled", self.scroll() > 80);
      nav.classList.toggle("is-hidden", self.direction === 1 && self.scroll() > window.innerHeight * 6.5 && !menu.classList.contains("is-open"));
    }
  });

  /* ---------------- Split text ---------------- */
  $$("[data-split]").forEach((el) => {
    el.innerHTML = el.textContent.trim().split(/\s+/).map((w) => `<span class="w"><span>${w}</span></span>`).join(" ");
    gsap.from($$(".w > span", el), {
      yPercent: 110, rotate: 4, opacity: 0, stagger: 0.035, ease: "power3.out", duration: 1,
      scrollTrigger: { trigger: el, start: "top 82%", end: "bottom 60%", scrub: el.classList.contains("manifesto__text") ? 1 : false }
    });
  });

  /* ---------------- Hero ---------------- */
  const heroProgress = () => (heroTl && heroTl.scrollTrigger ? heroTl.scrollTrigger.progress : 0);
  let heroTl = null;

  /* ---------------- Optional Kling frame sequence ---------------- */
  const sequence = (() => {
    const canvas = $(".hero__canvas");
    const ctx = canvas.getContext("2d");
    const frames = [];
    let ready = false;
    let last = -1;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      last = -1;
    };
    const draw = (img) => {
      const cw = canvas.width, ch = canvas.height;
      const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    };
    const render = (p) => {
      if (!ready) return;
      const i = Math.min(frames.length - 1, Math.floor(p * frames.length));
      if (i === last) return;
      const img = frames[i];
      if (img.complete && img.naturalWidth) { draw(img); last = i; }
    };
    const video = content.hero?.video || CFG.sequence || {};
    if (heroMode === "video" && video.enabled) {
      fetch(video.manifest).then((r) => r.json()).then((m) => {
        for (let i = 1; i <= m.count; i++) {
          const img = new Image();
          img.src = `${m.path}${String(i).padStart(m.pad || 4, "0")}.${m.ext || "webp"}`;
          frames.push(img);
        }
        frames[0].onload = () => {
          hero.classList.add("has-sequence");
          ready = true;
          size();
          render(heroProgress());
        };
        window.addEventListener("resize", () => { size(); render(heroProgress()); });
      }).catch(() => console.warn("Angelico: sequence manifest not found, using illustrated hero."));
    }
    return { render };
  })();

  const stages = $$(".stage");
  heroTl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: hero, start: "top top", end: "bottom bottom", scrub: 1,
      pin: ".hero__pin", pinSpacing: false, anticipatePin: 1, invalidateOnRefresh: true,
      onUpdate: (self) => { if (camera) camera.render(self.progress); else sequence.render(self.progress); }
    }
  });
  if (camera) tour.ready.then(() => camera.render(heroProgress()));

  gsap.set(".f-jacket-l", { x: -320, rotate: -10, opacity: 0, transformOrigin: "50% 0%" });
  gsap.set(".f-jacket-r", { x: 320, rotate: 10, opacity: 0, transformOrigin: "50% 0%" });
  // Centre explicitly with GSAP. The CSS translate was being dropped once GSAP took over the transform.
  gsap.set(".figure", { xPercent: -50 });
  const narrow = window.innerWidth <= 640;
  gsap.set(".hero__final", narrow ? { xPercent: rtl ? 50 : -50, yPercent: 0, y: 30 } : { xPercent: 0, yPercent: -50, y: 30 });
  gsap.set([".f-finish .btn", ".f-finish .square", ".f-finish .cuff"], { scale: 0 });

  heroTl
    .to(".hero__intro", { y: -80, opacity: 0, duration: 1 }, 0)
    .to(".hero__giant", { xPercent: rtl ? 8 : -8, duration: 10 }, 0)
    .fromTo(".figure", { scale: 1.12, yPercent: 6 }, { scale: 1, yPercent: 0, duration: 1.2 }, 0)
    .to(".hero__progress span", { scaleY: 1, duration: 10 }, 0)
    // I. shirt
    .to(".clip-shirt", { attr: { height: 660 }, duration: 2, ease: "power1.inOut" }, 1)
    // II. tie
    .to(".clip-tie", { attr: { height: 400 }, duration: 1.6, ease: "power1.inOut" }, 3.2)
    // III. jacket
    .to(".f-jacket-l", { x: 0, rotate: 0, opacity: 1, duration: 1.4, ease: "power2.out" }, 5)
    .to(".f-jacket-r", { x: 0, rotate: 0, opacity: 1, duration: 1.4, ease: "power2.out" }, 5.5)
    // IV. finish
    .to(".f-finish .btn", { scale: 1, stagger: 0.25, duration: 0.5, ease: "back.out(3)" }, 7.4)
    .to(".f-finish .square", { scale: 1, duration: 0.5, ease: "back.out(3)" }, 7.8)
    .to(".f-finish .cuff", { scale: 1, duration: 0.5, ease: "back.out(3)" }, 8)
    .to(".f-trace", { strokeDashoffset: 0, duration: 1.2 }, 7.6)
    .to(".f-trace", { opacity: 0, duration: 0.5 }, 9)
    // finale
    .to(".figure", { scale: 0.86, yPercent: 8, x: () => (window.innerWidth > 640 ? window.innerWidth * (rtl ? -0.33 : 0.33) : 0), duration: 1 }, 9)
    .to(".hero__glow", { scale: 1.6, opacity: 1, duration: 1 }, 9)
    .to(".hero__shade", { opacity: 1, duration: 0.8 }, 9)
    .to(".hero__final", { opacity: 1, y: 0, duration: 0.8 }, 9.2)
    .set({}, {}, 10);

  const windows = [[1, 3], [3.2, 5], [5, 7.3], [7.4, 9]];
  stages.forEach((s, i) => {
    if (!windows[i]) return;
    const [a, b] = windows[i];
    heroTl
      .fromTo(s, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: "power2.out" }, a)
      .to(s, { autoAlpha: 0, y: -40, duration: 0.4, ease: "power2.in" }, b - 0.4);
  });

  /* ---------------- Marquee ---------------- */
  const mq = gsap.to(".marquee__track", { xPercent: -50, duration: 28, ease: "none", repeat: -1 });
  if (!$(".marquee").hidden) ScrollTrigger.create({
    trigger: ".marquee", start: "top bottom", end: "bottom top",
    onUpdate: (self) => gsap.to(mq, { timeScale: 1 + Math.abs(self.getVelocity()) / 400 * (self.direction), duration: 0.3, overwrite: true, onComplete: () => gsap.to(mq, { timeScale: 1, duration: 1 }) })
  });

  /* ---------------- Collections: entrance only, the visitor scrolls the row ---------------- */
  if (!$(".collections").hidden) {
    gsap.from(".card", {
      y: 60, opacity: 0, duration: 1, stagger: 0.08, ease: "power3.out",
      scrollTrigger: { trigger: ".collections", start: "top 75%", once: true }
    });
  }

  /* ---------------- Stats ---------------- */
  $$(".stat b").forEach((b) => {
    const o = { v: 0 };
    gsap.to(o, {
      v: +b.dataset.count, duration: 2, ease: "power2.out",
      scrollTrigger: { trigger: b, start: "top 88%", once: true },
      onUpdate: () => (b.textContent = Math.round(o.v))
    });
  });

  /* ---------------- Stacking steps ---------------- */
  const steps = $$(".step");
  steps.forEach((s, i) => {
    if (i === steps.length - 1) return;
    gsap.to(s, {
      scale: 0.92, opacity: 0.35, filter: "blur(2px)", ease: "none",
      scrollTrigger: { trigger: steps[i + 1], start: "top bottom", end: "top 14%", scrub: true }
    });
  });

  /* ---------------- Products reveal ---------------- */
  ScrollTrigger.batch(".product", {
    start: "top 90%",
    onEnter: (els) => gsap.from(els, { y: 60, opacity: 0, duration: 1.1, stagger: 0.1, ease: "power3.out" }),
    once: true
  });
  $$(".product__media").forEach((m) => {
    const svg = $("img", m);
    m.addEventListener("pointermove", (e) => {
      const r = m.getBoundingClientRect();
      gsap.to(svg, { rotateY: ((e.clientX - r.left) / r.width - 0.5) * 14, rotateX: -((e.clientY - r.top) / r.height - 0.5) * 14, duration: 0.6, transformPerspective: 800 });
    });
    m.addEventListener("pointerleave", () => gsap.to(svg, { rotateX: 0, rotateY: 0, duration: 0.8 }));
  });

  /* ---------------- Quote parallax ---------------- */
  gsap.fromTo(".quote__mark", { rotate: -8, scale: 0.8 }, {
    rotate: 8, scale: 1.15, ease: "none",
    scrollTrigger: { trigger: ".quote", start: "top bottom", end: "bottom top", scrub: true }
  });

  /* ---------------- Appointment / footer ---------------- */
  gsap.from(".form label, .btn-gold", {
    y: 40, opacity: 0, stagger: 0.08, duration: 1, ease: "power3.out",
    scrollTrigger: { trigger: ".form", start: "top 85%" }
  });
  gsap.from(".footer__logo", {
    y: 60, opacity: 0, scale: 0.94, duration: 1.4, ease: "power3.out",
    scrollTrigger: { trigger: ".footer", start: "top 85%" }
  });

  /* ---------------- Loader exit ----------------
     Leave as soon as the content, fonts and hero photos are ready (never longer than
     8 seconds on a slow connection), with a short floor so the logo does not flash. */
  const intro = gsap.timeline({ paused: true })
    .from(".hero__title span", { yPercent: 100, opacity: 0, stagger: 0.12, duration: 1.3, ease: "power4.out" })
    .from(".hero__intro .eyebrow, .hero__scroll", { opacity: 0, y: 20, stagger: 0.1, duration: 1 }, "-=.9")
    .from(camera ? ".hero__canvas" : ".figure", { opacity: 0, scale: camera ? 1.04 : 1, duration: 1.6, ease: "power2.out" }, 0)
    .from(".nav", { yPercent: -100, opacity: 0, duration: 1, ease: "power3.out" }, 0.2);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await Promise.race([
    Promise.all([document.fonts ? document.fonts.ready : null, camera ? tour.ready : null]),
    wait(8000)
  ]);
  await wait(Math.max(0, 700 - (performance.now() - loaderShownAt)));

  gsap.timeline()
    .to(".loader__mark, .loader__bar", { y: -24, opacity: 0, stagger: 0.06, duration: 0.45, ease: "power2.in" })
    .to(".loader", { yPercent: -100, duration: 0.9, ease: "power4.inOut" }, "-=.1")
    .add(() => {
      document.body.classList.remove("is-loading");
      $(".loader").remove();
      if (lenis) lenis.start();
      ScrollTrigger.refresh();
      intro.play();
    }, "-=.45");
})();
