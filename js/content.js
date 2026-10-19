/*
  Angelico content layer.
  Loads content/site.json (or the admin's unpublished draft in preview mode)
  and renders every editable part of the page. Everything the admin edits
  flows through here, so the markup in index.html is only a skeleton.
*/
(() => {
  "use strict";

  const DRAFT_KEY = "angelico.draft";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const safeUrl = (u) => {
    const s = String(u ?? "").trim();
    return /^(javascript|data|vbscript):/i.test(s) ? "#" : s;
  };
  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text ?? ""; };

  const isPreview = () => new URLSearchParams(location.search).get("preview") === "1";

  /* ---- language ---- */
  const LANG_KEY = "angelico.lang";
  let LANG = "en";
  // A text field is either a plain string (English) or { en, ar }.
  const L = (v) => (v && typeof v === "object" ? (v[LANG] || v.en || "") : (v ?? ""));
  const ui = (c, key, vars) => {
    let s = L(c.ui?.[key]);
    Object.entries(vars || {}).forEach(([k, val]) => { s = s.replace(`{${k}}`, val); });
    return s;
  };
  function pickLang(c) {
    const s = c.settings || {};
    if (s.arabicEnabled === false) return "en";
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "ar" || q === "en") return q;
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "ar" || saved === "en") return saved;
    } catch (e) { /* ignore */ }
    if (s.defaultLang === "ar") return "ar";
    return /^ar\b/i.test(navigator.language || "") ? "ar" : "en";
  }
  function loadArabicFonts() {
    if (document.getElementById("ar-fonts")) return;
    const l = document.createElement("link");
    l.id = "ar-fonts"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Tajawal:wght@300;400;500&display=swap";
    document.head.appendChild(l);
  }

  async function load() {
    if (isPreview()) {
      try {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (draft) return { data: JSON.parse(draft), preview: true };
      } catch (e) { /* fall through to published content */ }
    }
    const res = await fetch(`content/site.json?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`content/site.json returned ${res.status}`);
    return { data: await res.json(), preview: false };
  }

  function formatter(settings) {
    const cur = settings?.currency || {};
    try {
      return new Intl.NumberFormat((LANG === "ar" ? cur.localeAr || "ar-u-nu-latn" : cur.locale) || "en-US", { style: "currency", currency: cur.code || "USD", maximumFractionDigits: 0 });
    } catch (e) {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    }
  }

  function render(c, opts = {}) {
    const s = c.settings || {};
    LANG = pickLang(c);
    const rtl = LANG === "ar";
    document.documentElement.lang = LANG;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    if (rtl) loadArabicFonts();

    /* theme */
    const t = s.theme || {};
    const root = document.documentElement.style;
    if (t.gold) root.setProperty("--gold", t.gold);
    if (t.goldLight) root.setProperty("--gold-2", t.goldLight);
    if (t.navy) root.setProperty("--navy", t.navy);
    if (t.navyDark) root.setProperty("--navy-900", t.navyDark);

    /* meta */
    if (L(s.siteTitle)) document.title = L(s.siteTitle);
    const md = $('meta[name="description"]');
    if (md && L(s.description)) md.setAttribute("content", L(s.description));

    /* logos */
    const logos = s.logos || {};
    $$("[data-logo]").forEach((img) => {
      const src = logos[img.dataset.logo];
      if (src) img.setAttribute("src", src);
    });
    const fav = $('link[rel="icon"]');
    if (fav && logos.mark) fav.setAttribute("href", logos.mark);

    /* section visibility */
    const sections = c.sections || {};
    $$("[data-section]").forEach((el) => { el.hidden = sections[el.dataset.section] === false; });

    /* navigation */
    const nav = c.nav || [];
    $(".nav__links").innerHTML = nav.map((n) => `<a href="${esc(safeUrl(n.href))}" data-magnetic>${esc(L(n.label))}</a>`).join("");
    $(".menu ol").innerHTML = nav.map((n, i) => `<li><a href="${esc(safeUrl(n.href))}"><small>${String(i + 1).padStart(2, "0")}</small>${esc(L(n.label))}</a></li>`).join("");
    const lang = $(".nav__lang");
    if (lang) { lang.hidden = s.arabicEnabled === false; lang.textContent = L(c.ui?.langSwitch) || (rtl ? "English" : "عربي"); lang.setAttribute("lang", rtl ? "en" : "ar"); }
    const bag = $(".nav__bag-label"); if (bag) bag.textContent = ui(c, "bag") || "Bag";

    /* hero */
    const h = c.hero || {};
    setText(".hero__intro .eyebrow", L(h.eyebrow));
    // The accent word is optional, so an empty Arabic value must not fall back to English.
    const accent = h.accent && typeof h.accent === "object" ? (h.accent[LANG] ?? "") : (LANG === "ar" ? "" : (h.accent || ""));
    $(".hero__title").innerHTML = `<span>${esc(L(h.line1))}</span><span>${accent ? `<em>${esc(accent)}</em> ` : ""}${esc(L(h.line2))}</span>`;
    $(".hero__scroll").innerHTML = `${esc(L(h.scrollHint))} <i></i>`;
    setText(".hero__giant", L(h.giantText));
    $(".stages").innerHTML = (h.stages || []).map((st, i) =>
      `<li class="stage" data-stage="${i + 1}"><small>${esc(L(st.num))}</small><h2>${esc(L(st.title))}</h2><p>${esc(L(st.text))}</p></li>`).join("");

    /* manifesto */
    const m = c.manifesto || {};
    setText(".manifesto .eyebrow", L(m.eyebrow));
    setText(".manifesto__text", L(m.text));
    $(".manifesto__sig").innerHTML = `${esc(L(m.signName))} <span>${esc(L(m.signRole))}</span>`;

    /* marquee */
    const words = (c.marquee?.words || []).map(L).filter(Boolean);
    if (words.length) {
      const reps = Math.max(1, Math.ceil(8 / words.length));
      const half = Array.from({ length: reps }, () => words.map((w) => `<span>${esc(w)}</span><i>&#9670;</i>`).join("")).join("");
      $(".marquee__track").innerHTML = half + half;
    } else {
      $(".marquee__track").innerHTML = "";
    }

    /* collections */
    const col = c.collections || {};
    setText(".collections__head .eyebrow", L(col.eyebrow));
    setText(".collections__head .display", L(col.title));
    const colItems = (col.items || []).filter((i) => i.visible !== false);
    // The track always scrolls left to right. In Arabic the first item sits at the right end.
    const colOrder = colItems.map((it, i) => ({ it, i }));
    if (rtl) colOrder.reverse();
    $(".collections__track").innerHTML = colOrder.map(({ it, i }) => `
      <article class="card" data-cursor>
        <div class="card__art"><img src="${esc(safeUrl(it.image))}" alt="${esc(L(it.alt) || L(it.title))}" width="900" height="1125" loading="lazy" decoding="async" /></div>
        <div class="card__meta"><small>${String(i + 1).padStart(2, "0")}</small><h3>${esc(L(it.title))}</h3><p>${esc(L(it.text))}</p></div>
      </article>`).join("");

    /* atelier */
    const a = c.atelier || {};
    setText(".atelier__head .eyebrow", L(a.eyebrow));
    setText(".atelier__head .display", L(a.title));
    $(".stats").innerHTML = (a.stats || []).map((st) =>
      `<div class="stat"><b data-count="${esc(Number(st.value) || 0)}">0</b><span>${esc(L(st.label))}</span></div>`).join("");
    $(".steps").innerHTML = (a.steps || []).map((st, i) =>
      `<article class="step"><span class="step__n">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(L(st.title))}</h3><p>${esc(L(st.text))}</p></div></article>`).join("");

    /* shop */
    const sh = c.shop || {};
    setText(".shop__head .eyebrow", L(sh.eyebrow));
    setText(".shop__head .display", L(sh.title));
    const products = (sh.products || []).filter((p) => p.visible !== false);
    const usedCats = new Set(products.map((p) => p.category));
    const cats = (sh.categories || []).filter((cat) => usedCats.has(cat.id));
    $(".filters").innerHTML = `<button class="is-active" data-filter="all">${esc(ui(c, "all") || "All")}</button>` +
      cats.map((cat) => `<button data-filter="${esc(cat.id)}">${esc(L(cat.label))}</button>`).join("");
    const fmt = formatter(s);
    $("#grid").innerHTML = products.map((p, i) => `
      <article class="product${p.soldOut ? " is-soldout" : ""}" data-cat="${esc(p.category)}" data-cursor>
        <div class="product__media">${L(p.tag) ? `<span class="product__tag">${esc(L(p.tag))}</span>` : ""}<img src="${esc(safeUrl(p.image))}" alt="${esc(L(p.alt) || L(p.name))}" width="900" height="1125" loading="lazy" decoding="async" />
          <button class="product__add" data-i="${i}"${p.soldOut ? " disabled" : ""}>${p.soldOut ? esc(ui(c, "soldOut") || "Sold out") : esc(L(sh.addLabel) || "Add to bag")}</button></div>
        <div class="product__info"><div><h3>${esc(L(p.name))}</h3><p>${esc(L(p.note))}</p></div><span class="product__price">${Number(p.price) > 0 ? esc(fmt.format(Number(p.price))) : esc(ui(c, "priceOnRequest") || "Price on request")}</span></div>
      </article>`).join("");

    /* quote */
    setText(".quote blockquote", `“${L(c.quote?.text)}”`);

    /* appointment */
    const ap = c.appointment || {};
    setText(".appointment .eyebrow", L(ap.eyebrow));
    setText(".appointment .display", L(ap.title));
    setText(".btn-gold span", L(ap.button));
    $(".form select").innerHTML = (ap.interests || []).map((i) => `<option>${esc(L(i))}</option>`).join("");
    const lab = { name: "formName", email: "formEmail", interest: "formInterest", date: "formDate" };
    Object.entries(lab).forEach(([field, key]) => { const sp = $(`.form [name="${field}"]`)?.closest("label")?.querySelector("span"); if (sp && ui(c, key)) sp.textContent = ui(c, key); });

    /* footer */
    const f = c.footer || {};
    $(".footer__cols").innerHTML = (f.columns || []).map((colm) => `
      <div><h4>${esc(L(colm.title))}</h4><p>${(colm.links || []).map((l) =>
        l.url ? `<a href="${esc(safeUrl(l.url))}">${esc(L(l.label))}</a>` : esc(L(l.label))).join("<br />")}</p></div>`).join("");
    setText(".footer__legal", String(L(f.legal)).replace("{year}", new Date().getFullYear()));

    if (opts.preview) {
      const r = document.createElement("div");
      r.className = "preview-ribbon";
      r.textContent = "Draft preview, not published";
      document.body.appendChild(r);
    }
  }

  function setLang(l) {
    try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* ignore */ }
    const u = new URL(location.href); u.searchParams.delete("lang"); location.href = u.toString();
  }

  window.AngelicoContent = { load, render, formatter, DRAFT_KEY, L, ui, setLang, get lang() { return LANG; } };
})();
