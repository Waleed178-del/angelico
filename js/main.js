(() => {
  "use strict";

  const CFG = window.ANGELICO_CONFIG || {};
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";

  $("#year").textContent = new Date().getFullYear();

  /* ---------------- Products ---------------- */
  const fmt = new Intl.NumberFormat(CFG.currency?.locale || "en-US", {
    style: "currency", currency: CFG.currency?.code || "USD", maximumFractionDigits: 0
  });

  const art = {
    suit: (c, l) => `<svg viewBox="0 0 200 240"><path d="M100 22 L66 30 Q38 42 34 78 L24 226 L56 226 L62 110 L60 236 L140 236 L138 110 L144 226 L176 226 L166 78 Q162 42 134 30 Z" fill="${c}"/><path d="M84 26 L100 70 L116 26 Z" fill="#f3efe7"/><path d="M96 34 L104 34 L108 130 L100 140 L92 130 Z" fill="${l}"/><path d="M84 26 L72 76 L100 160 L82 76 Z M116 26 L128 76 L100 160 L118 76 Z" fill="rgba(0,0,0,.22)" stroke="${l}" stroke-opacity=".5"/><circle cx="100" cy="172" r="3" fill="${l}"/><circle cx="100" cy="190" r="3" fill="${l}"/><path d="M118 96 L126 86 L130 94 L136 86 L140 96 Z" fill="${l}"/></svg>`,
    tux: (c, l) => `<svg viewBox="0 0 200 240"><path d="M100 22 L66 30 Q38 42 34 78 L24 226 L56 226 L62 110 L60 236 L140 236 L138 110 L144 226 L176 226 L166 78 Q162 42 134 30 Z" fill="${c}"/><path d="M84 26 L100 90 L116 26 Z" fill="#f3efe7"/><path d="M88 36 L100 42 L112 36 L112 50 L100 44 L88 50 Z" fill="#0b1118"/><path d="M84 26 Q66 100 100 160 Q76 100 90 30 Z M116 26 Q134 100 100 160 Q124 100 110 30 Z" fill="#0b1118" stroke="${l}" stroke-opacity=".6"/><circle cx="100" cy="172" r="3" fill="${l}"/></svg>`,
    shirt: (c, l) => `<svg viewBox="0 0 200 240"><path d="M100 40 L72 44 Q46 54 42 84 L36 200 L60 200 L66 116 L68 230 L132 230 L134 116 L140 200 L164 200 L158 84 Q154 54 128 44 Z" fill="${c}"/><path d="M84 30 L100 54 L78 64 L74 40 Z M116 30 L100 54 L122 64 L126 40 Z" fill="${c}" stroke="rgba(0,0,0,.18)"/><path d="M100 54 L100 230" stroke="rgba(0,0,0,.15)"/><g fill="${l}"><circle cx="100" cy="90" r="2.4"/><circle cx="100" cy="124" r="2.4"/><circle cx="100" cy="158" r="2.4"/><circle cx="100" cy="192" r="2.4"/></g></svg>`,
    tie: (c, l) => `<svg viewBox="0 0 200 240"><path d="M88 20 L112 20 L116 44 L84 44 Z" fill="${c}"/><path d="M85 44 L115 44 L134 196 L100 230 L66 196 Z" fill="${c}"/><path d="M100 46 L100 226" stroke="${l}" stroke-opacity=".35"/><path d="M78 120 L122 100 M74 160 L128 136 M72 196 L130 172" stroke="${l}" stroke-opacity=".25"/></svg>`,
    cuff: (c, l) => `<svg viewBox="0 0 200 240"><circle cx="66" cy="120" r="34" fill="${c}"/><circle cx="66" cy="120" r="20" fill="none" stroke="${l}" stroke-width="2"/><circle cx="134" cy="120" r="34" fill="${c}"/><circle cx="134" cy="120" r="20" fill="none" stroke="${l}" stroke-width="2"/><path d="M58 112 L66 104 L74 112 L66 132 Z M126 112 L134 104 L142 112 L134 132 Z" fill="${l}"/></svg>`,
    coat: (c, l) => `<svg viewBox="0 0 200 240"><path d="M100 14 L64 22 Q36 34 32 72 L22 232 L54 232 L60 108 L58 240 L142 240 L140 108 L146 232 L178 232 L168 72 Q164 34 136 22 Z" fill="${c}"/><path d="M82 18 L68 66 L100 116 L132 66 L118 18 L100 60 Z" fill="rgba(0,0,0,.25)" stroke="${l}" stroke-opacity=".4"/><g fill="${l}"><circle cx="86" cy="136" r="3"/><circle cx="114" cy="136" r="3"/><circle cx="86" cy="176" r="3"/><circle cx="114" cy="176" r="3"/></g></svg>`
  };

  const products = [
    { name: "The Sousi Two Piece", note: "Super 150s wool, midnight", price: 3200, cat: "suits", art: art.suit("#2c405a", "#c8a96a"), tag: "Signature" },
    { name: "Peak Lapel Tuxedo", note: "Barathea with silk facing", price: 3900, cat: "suits", art: art.tux("#0e141d", "#c8a96a"), tag: "Evening" },
    { name: "Cashmere Overcoat", note: "Double breasted, camel", price: 4400, cat: "suits", art: art.coat("#8a6b45", "#e9d6a6"), tag: "New" },
    { name: "Ivory Poplin Shirt", note: "Sea island cotton", price: 420, cat: "shirts", art: art.shirt("#f3efe7", "#bfb6a5") },
    { name: "Pale Blue Oxford", note: "Hand set collar", price: 390, cat: "shirts", art: art.shirt("#c9d6e3", "#8ea2b6") },
    { name: "Seven Fold Silk Tie", note: "Gold jacquard", price: 260, cat: "acc", art: art.tie("#b18e4f", "#f3e3b8"), tag: "Atelier" },
    { name: "Navy Grenadine Tie", note: "Woven in Como", price: 240, cat: "acc", art: art.tie("#24324a", "#c8a96a") },
    { name: "Onyx Cufflinks", note: "18k gold vermeil", price: 680, cat: "acc", art: art.cuff("#0e141d", "#c8a96a") },
    { name: "Charcoal Flannel Suit", note: "Three piece, VBC", price: 3600, cat: "suits", art: art.suit("#3a3f47", "#d9c18a") }
  ];

  const grid = $("#grid");
  grid.innerHTML = products.map((p, i) => `
    <article class="product" data-cat="${p.cat}" data-cursor>
      <div class="product__media">${p.tag ? `<span class="product__tag">${p.tag}</span>` : ""}${p.art}
        <button class="product__add" data-i="${i}">Add to bag</button></div>
      <div class="product__info"><div><h3>${p.name}</h3><p>${p.note}</p></div><span class="product__price">${fmt.format(p.price)}</span></div>
    </article>`).join("");

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
    say(`${products[b.dataset.i].name} added`);
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
  $(".form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const msg = $(".form__msg", f);
    if (!f.name.value.trim() || !/^\S+@\S+\.\S+$/.test(f.email.value)) {
      msg.textContent = "Please share your name and a valid email.";
      return;
    }
    msg.textContent = `Thank you, ${f.name.value.trim()}. The atelier will contact you shortly.`;
    f.reset();
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

  /* ---------------- No animation path ---------------- */
  if (!hasGsap || reduced) {
    document.body.classList.remove("is-loading");
    $(".loader").remove();
    $$(".stat b").forEach((b) => (b.textContent = b.dataset.count));
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
    lenis = new Lenis({ duration: 1.25, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
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

  /* ---------------- Cursor + magnetic ---------------- */
  const cursor = $(".cursor");
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    const dx = gsap.quickTo(".cursor__dot", "x", { duration: 0.15 });
    const dy = gsap.quickTo(".cursor__dot", "y", { duration: 0.15 });
    const rx = gsap.quickTo(".cursor__ring", "x", { duration: 0.55, ease: "power3" });
    const ry = gsap.quickTo(".cursor__ring", "y", { duration: 0.55, ease: "power3" });
    window.addEventListener("pointermove", (e) => { dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY); });
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
  const hero = $("#hero");
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
    if (CFG.sequence?.enabled) {
      fetch(CFG.sequence.manifest).then((r) => r.json()).then((m) => {
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
      onUpdate: (self) => sequence.render(self.progress)
    }
  });

  gsap.set(".f-jacket-l", { x: -320, rotate: -10, opacity: 0, transformOrigin: "50% 0%" });
  gsap.set(".f-jacket-r", { x: 320, rotate: 10, opacity: 0, transformOrigin: "50% 0%" });
  gsap.set(".hero__final", { y: 30 });
  gsap.set([".f-finish .btn", ".f-finish .square", ".f-finish .cuff"], { scale: 0 });

  heroTl
    .to(".hero__intro", { y: -80, opacity: 0, duration: 1 }, 0)
    .to(".hero__giant", { xPercent: -8, duration: 10 }, 0)
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
    .to(".figure", { scale: 0.86, yPercent: 8, x: () => (window.innerWidth > 640 ? window.innerWidth * 0.14 : 0), duration: 1 }, 9)
    .to(".hero__glow", { scale: 1.6, opacity: 1, duration: 1 }, 9)
    .to(".hero__final", { opacity: 1, y: 0, duration: 0.8 }, 9.2)
    .set({}, {}, 10);

  const windows = [[1, 3], [3.2, 5], [5, 7.3], [7.4, 9]];
  stages.forEach((s, i) => {
    const [a, b] = windows[i];
    heroTl
      .fromTo(s, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: "power2.out" }, a)
      .to(s, { autoAlpha: 0, y: -40, duration: 0.4, ease: "power2.in" }, b - 0.4);
  });

  /* ---------------- Marquee ---------------- */
  const mq = gsap.to(".marquee__track", { xPercent: -50, duration: 28, ease: "none", repeat: -1 });
  ScrollTrigger.create({
    trigger: ".marquee", start: "top bottom", end: "bottom top",
    onUpdate: (self) => gsap.to(mq, { timeScale: 1 + Math.abs(self.getVelocity()) / 400 * (self.direction), duration: 0.3, overwrite: true, onComplete: () => gsap.to(mq, { timeScale: 1, duration: 1 }) })
  });

  /* ---------------- Collections horizontal ---------------- */
  const track = $(".collections__track");
  const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
  gsap.to(track, {
    x: () => -dist(), ease: "none",
    scrollTrigger: { trigger: ".collections", start: "top top", end: () => `+=${dist()}`, scrub: 1, pin: ".collections__pin", invalidateOnRefresh: true, anticipatePin: 1 }
  });
  $$(".card").forEach((c, i) => gsap.from(c, {
    y: 80 + i * 10, opacity: 0, duration: 1, ease: "power3.out",
    scrollTrigger: { trigger: ".collections", start: "top 70%" }
  }));

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
    const svg = $("svg", m);
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

  /* ---------------- Loader ---------------- */
  const count = { v: 0 };
  const intro = gsap.timeline({ paused: true })
    .from(".hero__title span", { yPercent: 100, opacity: 0, stagger: 0.12, duration: 1.3, ease: "power4.out" })
    .from(".hero__intro .eyebrow, .hero__scroll", { opacity: 0, y: 20, stagger: 0.1, duration: 1 }, "-=.9")
    .from(".figure", { opacity: 0, duration: 1.6, ease: "power2.out" }, 0)
    .from(".nav", { yPercent: -100, opacity: 0, duration: 1, ease: "power3.out" }, 0.2);

  const loadTl = gsap.timeline()
    .to(".loader__mark", { clipPath: "inset(0% 0 0 0)", duration: 1.2, ease: "power3.inOut" })
    .to(count, {
      v: 100, duration: 1.6, ease: "power2.inOut",
      onUpdate: () => { $(".loader__count").textContent = Math.round(count.v); gsap.set(".loader__bar span", { scaleX: count.v / 100 }); }
    }, 0.2);

  Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((r) => (document.readyState === "complete" ? r() : window.addEventListener("load", r))),
    new Promise((r) => loadTl.eventCallback("onComplete", r))
  ]).then(() => {
    gsap.timeline()
      .to(".loader__mark, .loader__bar, .loader__count", { y: -30, opacity: 0, stagger: 0.06, duration: 0.6, ease: "power2.in" })
      .to(".loader", { yPercent: -100, duration: 1.1, ease: "power4.inOut" }, "-=.1")
      .add(() => {
        document.body.classList.remove("is-loading");
        $(".loader").remove();
        if (lenis) lenis.start();
        ScrollTrigger.refresh();
        intro.play();
      }, "-=.5");
  });
})();
