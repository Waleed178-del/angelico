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
      return new Intl.NumberFormat(cur.locale || "en-US", { style: "currency", currency: cur.code || "USD", maximumFractionDigits: 0 });
    } catch (e) {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    }
  }

  function render(c, opts = {}) {
    const s = c.settings || {};

    /* theme */
    const t = s.theme || {};
    const root = document.documentElement.style;
    if (t.gold) root.setProperty("--gold", t.gold);
    if (t.goldLight) root.setProperty("--gold-2", t.goldLight);
    if (t.navy) root.setProperty("--navy", t.navy);
    if (t.navyDark) root.setProperty("--navy-900", t.navyDark);

    /* meta */
    if (s.siteTitle) document.title = s.siteTitle;
    const md = $('meta[name="description"]');
    if (md && s.description) md.setAttribute("content", s.description);

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
    $(".nav__links").innerHTML = nav.map((n) => `<a href="${esc(safeUrl(n.href))}" data-magnetic>${esc(n.label)}</a>`).join("");
    $(".menu ol").innerHTML = nav.map((n, i) => `<li><a href="${esc(safeUrl(n.href))}"><small>${String(i + 1).padStart(2, "0")}</small>${esc(n.label)}</a></li>`).join("");

    /* hero */
    const h = c.hero || {};
    setText(".hero__intro .eyebrow", h.eyebrow);
    $(".hero__title").innerHTML = `<span>${esc(h.line1)}</span><span>${h.accent ? `<em>${esc(h.accent)}</em> ` : ""}${esc(h.line2)}</span>`;
    $(".hero__scroll").innerHTML = `${esc(h.scrollHint)} <i></i>`;
    setText(".hero__giant", h.giantText);
    $(".stages").innerHTML = (h.stages || []).map((st, i) =>
      `<li class="stage" data-stage="${i + 1}"><small>${esc(st.num)}</small><h2>${esc(st.title)}</h2><p>${esc(st.text)}</p></li>`).join("");

    /* manifesto */
    const m = c.manifesto || {};
    setText(".manifesto .eyebrow", m.eyebrow);
    setText(".manifesto__text", m.text);
    $(".manifesto__sig").innerHTML = `${esc(m.signName)} <span>${esc(m.signRole)}</span>`;

    /* marquee */
    const words = (c.marquee?.words || []).filter(Boolean);
    if (words.length) {
      const reps = Math.max(1, Math.ceil(8 / words.length));
      const half = Array.from({ length: reps }, () => words.map((w) => `<span>${esc(w)}</span><i>&#9670;</i>`).join("")).join("");
      $(".marquee__track").innerHTML = half + half;
    } else {
      $(".marquee__track").innerHTML = "";
    }

    /* collections */
    const col = c.collections || {};
    setText(".collections__head .eyebrow", col.eyebrow);
    setText(".collections__head .display", col.title);
    $(".collections__track").innerHTML = (col.items || []).filter((i) => i.visible !== false).map((it, i) => `
      <article class="card" data-cursor>
        <div class="card__art"><img src="${esc(safeUrl(it.image))}" alt="${esc(it.alt || it.title)}" width="900" height="1125" loading="lazy" decoding="async" /></div>
        <div class="card__meta"><small>${String(i + 1).padStart(2, "0")}</small><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div>
      </article>`).join("");

    /* atelier */
    const a = c.atelier || {};
    setText(".atelier__head .eyebrow", a.eyebrow);
    setText(".atelier__head .display", a.title);
    $(".stats").innerHTML = (a.stats || []).map((st) =>
      `<div class="stat"><b data-count="${esc(Number(st.value) || 0)}">0</b><span>${esc(st.label)}</span></div>`).join("");
    $(".steps").innerHTML = (a.steps || []).map((st, i) =>
      `<article class="step"><span class="step__n">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(st.title)}</h3><p>${esc(st.text)}</p></div></article>`).join("");

    /* shop */
    const sh = c.shop || {};
    setText(".shop__head .eyebrow", sh.eyebrow);
    setText(".shop__head .display", sh.title);
    const products = (sh.products || []).filter((p) => p.visible !== false);
    const usedCats = new Set(products.map((p) => p.category));
    const cats = (sh.categories || []).filter((cat) => usedCats.has(cat.id));
    $(".filters").innerHTML = `<button class="is-active" data-filter="all">All</button>` +
      cats.map((cat) => `<button data-filter="${esc(cat.id)}">${esc(cat.label)}</button>`).join("");
    const fmt = formatter(s);
    $("#grid").innerHTML = products.map((p, i) => `
      <article class="product${p.soldOut ? " is-soldout" : ""}" data-cat="${esc(p.category)}" data-cursor>
        <div class="product__media">${p.tag ? `<span class="product__tag">${esc(p.tag)}</span>` : ""}<img src="${esc(safeUrl(p.image))}" alt="${esc(p.alt || p.name)}" width="900" height="1125" loading="lazy" decoding="async" />
          <button class="product__add" data-i="${i}"${p.soldOut ? " disabled" : ""}>${p.soldOut ? "Sold out" : esc(sh.addLabel || "Add to bag")}</button></div>
        <div class="product__info"><div><h3>${esc(p.name)}</h3><p>${esc(p.note)}</p></div><span class="product__price">${Number(p.price) > 0 ? esc(fmt.format(Number(p.price))) : "Price on request"}</span></div>
      </article>`).join("");

    /* quote */
    setText(".quote blockquote", `“${c.quote?.text ?? ""}”`);

    /* appointment */
    const ap = c.appointment || {};
    setText(".appointment .eyebrow", ap.eyebrow);
    setText(".appointment .display", ap.title);
    setText(".btn-gold span", ap.button);
    $(".form select").innerHTML = (ap.interests || []).map((i) => `<option>${esc(i)}</option>`).join("");

    /* footer */
    const f = c.footer || {};
    $(".footer__cols").innerHTML = (f.columns || []).map((colm) => `
      <div><h4>${esc(colm.title)}</h4><p>${(colm.links || []).map((l) =>
        l.url ? `<a href="${esc(safeUrl(l.url))}">${esc(l.label)}</a>` : esc(l.label)).join("<br />")}</p></div>`).join("");
    setText(".footer__legal", String(f.legal || "").replace("{year}", new Date().getFullYear()));

    if (opts.preview) {
      const r = document.createElement("div");
      r.className = "preview-ribbon";
      r.textContent = "Draft preview, not published";
      document.body.appendChild(r);
    }
  }

  window.AngelicoContent = { load, render, formatter, DRAFT_KEY };
})();
