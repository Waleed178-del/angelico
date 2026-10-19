/*
  Angelico Admin.
  A no-server CMS: it edits content/site.json and uploads images by committing
  to the GitHub repository. Authentication is a GitHub token with write access
  to this repository, so only people GitHub lets write to the repo can publish.
*/
(() => {
  "use strict";

  const { GitHub, textToBase64, bytesToBase64 } = window.AngelicoGitHub;

  /* ------------------------------------------------------------ helpers */
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const get = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
  const set = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "") || "item";

  const KEYS = { draft: "angelico.draft", conn: "angelico.admin.conn", token: "angelico.admin.token" };
  const IMG_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
  const MEDIA_DIRS = ["assets/products", "assets/uploads", "assets/brand"];
  const CONTENT_PATH = "content/site.json";
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  const API = (isLocal && new URLSearchParams(location.search).get("api")) || "https://api.github.com";

  let toastT;
  function toast(msg, bad) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("is-bad", !!bad);
    t.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("is-on"), bad ? 5200 : 2800);
  }

  /* -------------------------------------------------------------- state */
  const S = {
    gh: null, user: "", content: null, published: null, baseSha: null,
    view: "dashboard", media: null, thumbs: {}, ui: { pq: "", pcat: "all" }, busy: false
  };
  const C = () => S.content;
  const pubStr = () => JSON.stringify(S.published);
  const isDirty = () => !!S.content && JSON.stringify(S.content) !== pubStr();

  let saveT;
  function touch() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try {
        if (isDirty()) localStorage.setItem(KEYS.draft, JSON.stringify(S.content));
        else localStorage.removeItem(KEYS.draft);
      } catch (e) { /* storage unavailable */ }
    }, 250);
    refreshBar();
  }

  /* -------------------------------------------------------------- login */
  function guessRepo() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    const seg = location.pathname.split("/")[1];
    if (!m) return { owner: "", repo: "" };
    return { owner: m[1], repo: seg && seg !== "admin" ? seg : `${m[1]}.github.io` };
  }

  function showLogin(error = "") {
    $("#app").hidden = true;
    const box = $("#login");
    box.hidden = false;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEYS.conn) || "{}"); } catch (e) { /* ignore */ }
    const g = guessRepo();
    const v = { owner: saved.owner || g.owner, repo: saved.repo || g.repo, branch: saved.branch || "gh-pages" };
    box.innerHTML = `
      <form class="login__card" id="loginForm" autocomplete="off">
        <img class="login__logo" src="../assets/brand/logo-mark.png" alt="" />
        <h1>Angelico Admin</h1>
        <p style="text-align:center">Sign in with a GitHub access token to edit the site. Every change you publish is saved as a commit in your repository.</p>
        <details>
          <summary>How do I get a token?</summary>
          <ol>
            <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub, Settings, Fine-grained tokens, Generate new token</a>.</li>
            <li>Repository access: choose <b>Only select repositories</b> and pick <code>${esc(v.repo || "angelico")}</code>.</li>
            <li>Permissions, Repository: set <b>Contents</b> to <b>Read and write</b>. Optionally set <b>Pages</b> to <b>Read-only</b> to see publish status.</li>
            <li>Generate the token, copy it and paste it below.</li>
          </ol>
        </details>
        <div class="grid3" style="margin-bottom:16px">
          <label class="field"><span>Owner</span><input type="text" name="owner" value="${esc(v.owner)}" required /></label>
          <label class="field"><span>Repository</span><input type="text" name="repo" value="${esc(v.repo)}" required /></label>
          <label class="field"><span>Branch</span><input type="text" name="branch" value="${esc(v.branch)}" required /></label>
        </div>
        <label class="field"><span>GitHub token</span><input type="password" name="token" placeholder="github_pat_..." required autocomplete="off" style="width:100%;padding:10px 12px;background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:8px;color:var(--ivory)" /></label>
        <p style="margin:14px 0 0"><label class="switch"><input type="checkbox" name="remember" /> Remember me on this device</label></p>
        <small>Leave unchecked on shared computers. The token is then forgotten when you close the tab.</small>
        <p class="err" id="loginErr">${esc(error)}</p>
        <button class="btn btn--gold" type="submit" style="width:100%;padding:12px">Connect</button>
      </form>`;
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const btn = $("button", f);
      btn.disabled = true; btn.textContent = "Connecting...";
      const conn = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() };
      const token = f.token.value.trim();
      try {
        await connect({ ...conn, token });
        try {
          localStorage.setItem(KEYS.conn, JSON.stringify(conn));
          sessionStorage.removeItem(KEYS.token); localStorage.removeItem(KEYS.token);
          (f.remember.checked ? localStorage : sessionStorage).setItem(KEYS.token, token);
        } catch (err) { /* storage unavailable */ }
      } catch (err) {
        $("#loginErr").textContent = err.message;
        btn.disabled = false; btn.textContent = "Connect";
      }
    });
  }

  async function connect({ owner, repo, branch, token }) {
    const gh = new GitHub({ owner, repo, branch, token, api: API });
    const info = await gh.repoInfo();
    if (info.permissions && !info.permissions.push) throw new Error("This token can read the repository but cannot write to it. Give it Contents: Read and write.");
    let file;
    try {
      file = await gh.getFile(CONTENT_PATH);
    } catch (e) {
      if (e.status === 404) throw new Error(`Could not find ${CONTENT_PATH} on branch "${branch}". Check the branch name, or deploy the site files to that branch first.`);
      throw e;
    }
    S.gh = gh;
    S.baseSha = file.sha;
    S.published = JSON.parse(file.text);
    S.content = clone(S.published);
    try {
      const draft = JSON.parse(localStorage.getItem(KEYS.draft) || "null");
      if (draft && JSON.stringify(draft) !== pubStr() && confirm("You have unpublished changes saved in this browser from an earlier session.\n\nOK restores them. Cancel loads the published version.")) S.content = draft;
      else if (draft && JSON.stringify(draft) !== pubStr()) localStorage.removeItem(KEYS.draft);
    } catch (e) { /* ignore broken draft */ }
    S.media = null;
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#liveLink").href = `https://${owner}.github.io/${repo}/`;
    if (isLocal) $("#liveLink").href = "../";
    route();
  }

  function disconnect() {
    if (isDirty() && !confirm("You have unpublished changes. They stay saved in this browser as a draft. Disconnect anyway?")) return;
    try { sessionStorage.removeItem(KEYS.token); localStorage.removeItem(KEYS.token); } catch (e) { /* ignore */ }
    S.gh = null;
    showLogin();
  }

  /* ---------------------------------------------------------- shell/nav */
  const NAV = [
    ["dashboard", "Dashboard"], ["products", "Products"], ["collections", "Collections"], ["hero", "Hero"],
    ["story", "Story and quote"], ["atelier", "Atelier"], ["appointment", "Appointment"],
    ["navfooter", "Navigation and footer"], ["media", "Media library"], ["settings", "Settings"]
  ];

  function renderNav() {
    const counts = { products: C().shop.products.length, collections: C().collections.items.length };
    $("#nav").innerHTML = NAV.map(([id, label]) =>
      `<a href="#/${id}" class="${S.view === id ? "is-active" : ""}">${label}${counts[id] != null ? `<span class="count">${counts[id]}</span>` : ""}</a>`).join("");
    $("#viewTitle").textContent = NAV.find((n) => n[0] === S.view)?.[1] || "Dashboard";
  }

  function refreshBar() {
    if (!S.content) return;
    const d = isDirty();
    const b = $("#statusBadge");
    b.textContent = d ? "Unpublished changes" : "Published";
    b.className = `badge ${d ? "badge--warn" : "badge--ok"}`;
    $("#publishBtn").disabled = !d || S.busy;
    $("#discardBtn").disabled = !d;
  }

  function route() {
    const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
    S.view = VIEWS[id] ? id : "dashboard";
    render();
  }
  window.addEventListener("hashchange", () => { if (S.gh) route(); });

  function render() {
    renderNav();
    refreshBar();
    $("#view").innerHTML = VIEWS[S.view]();
    window.scrollTo(0, 0);
    if (AFTER[S.view]) AFTER[S.view]();
  }
  function rerender() {
    const y = window.scrollY;
    renderNav(); refreshBar();
    $("#view").innerHTML = VIEWS[S.view]();
    window.scrollTo(0, y);
    if (AFTER[S.view]) AFTER[S.view]();
  }

  /* ------------------------------------------------------ field builders */
  function imgSrc(p) {
    if (!p) return "";
    if (S.thumbs[p]) return S.thumbs[p];
    if (/^(https?:|data:)/.test(p)) return p;
    return `../${p}`;
  }

  function fld({ label, path, type = "text", options, hint, rows = 3, ph = "", wide, keep }) {
    const v = get(C(), path);
    const cls = `field${wide ? " wide" : ""}`;
    const d = `data-path="${esc(path)}"`;
    if (type === "check") {
      return `<div class="${cls}"><label class="switch"><input type="checkbox" ${d} data-type="check" ${v ? "checked" : ""} /> ${esc(label)}</label>${hint ? `<small>${hint}</small>` : ""}</div>`;
    }
    let ctl;
    if (type === "textarea") ctl = `<textarea ${d} rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea>`;
    else if (type === "number") ctl = `<input type="number" step="any" ${d} data-type="number" value="${esc(v)}" placeholder="${esc(ph)}" />`;
    else if (type === "select") {
      ctl = `<select ${d}>${(options || []).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`; }).join("")}</select>`;
    } else if (type === "color") {
      ctl = `<div class="colorrow"><input type="color" ${d} data-type="color" value="${esc(v || "#000000")}" /><code>${esc(v)}</code></div>`;
    } else if (type === "image") {
      ctl = `<div class="imgfield">
        <div class="imgfield__thumb">${v ? `<img class="${keep ? "contain" : ""}" src="${esc(imgSrc(v))}" alt="" />` : "No image"}</div>
        <div class="imgfield__side">
          <input type="text" ${d} data-type="image" value="${esc(v)}" placeholder="assets/uploads/photo.webp" />
          <div class="row"><button type="button" class="btn btn--sm" data-act="pick" data-path="${esc(path)}" ${keep ? 'data-keep="1"' : ""}>Choose or upload</button>
          <button type="button" class="btn btn--sm" data-act="clear-img" data-path="${esc(path)}">Remove</button></div>
        </div></div>`;
    } else ctl = `<input type="${type === "email" ? "email" : "text"}" ${d} value="${esc(v)}" placeholder="${esc(ph)}" />`;
    return `<label class="${cls}"><span>${esc(label)}</span>${ctl}${hint ? `<small>${hint}</small>` : ""}</label>`;
  }

  const sectionToggle = (key) => `<label class="switch"><input type="checkbox" data-path="sections.${key}" data-type="check" ${C().sections[key] !== false ? "checked" : ""} /> Show on site</label>`;
  const card = (title, body, { sub = "", right = "" } = {}) =>
    `<section class="card"><div class="card__head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>${right}</div>${body}</section>`;

  /* One input changed: write it straight into the draft. */
  function commit(el) {
    const path = el.dataset.path;
    if (!path) return;
    let v = el.value;
    const t = el.dataset.type;
    if (t === "check") v = el.checked;
    else if (t === "number") v = v === "" ? "" : Number(v);
    set(C(), path, v);
    if (t === "color") { const code = el.parentElement.querySelector("code"); if (code) code.textContent = v; }
    if (t === "image") refreshThumb(el);
    touch();
  }
  function refreshThumb(input) {
    const wrap = input.closest(".imgfield");
    if (!wrap) return;
    const keep = !!wrap.querySelector("[data-keep]");
    const th = $(".imgfield__thumb", wrap);
    th.innerHTML = input.value ? `<img class="${keep ? "contain" : ""}" src="${esc(imgSrc(input.value))}" alt="" />` : "No image";
  }
  document.addEventListener("input", (e) => { const el = e.target.closest("[data-path]"); if (el && el.tagName !== "BUTTON") commit(el); });
  document.addEventListener("change", (e) => { const el = e.target.closest("[data-path]"); if (el && (el.type === "checkbox" || el.tagName === "SELECT")) { commit(el); if (/^sections\./.test(el.dataset.path)) refreshBar(); } });

  /* list helpers */
  const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false;[arr[i], arr[j]] = [arr[j], arr[i]]; return true; };

  function strList(path, { addLabel = "Add", ph = "" } = {}) {
    const arr = get(C(), path) || [];
    return `${arr.map((_, i) => `<div class="strrow"><input type="text" data-path="${esc(path)}.${i}" value="${esc(arr[i])}" placeholder="${esc(ph)}" />
      <button class="icon" data-act="move" data-path="${esc(path)}" data-i="${i}" data-d="-1" title="Move up" ${i === 0 ? "disabled" : ""}>&#8593;</button>
      <button class="icon" data-act="move" data-path="${esc(path)}" data-i="${i}" data-d="1" title="Move down" ${i === arr.length - 1 ? "disabled" : ""}>&#8595;</button>
      <button class="icon icon--danger" data-act="del" data-path="${esc(path)}" data-i="${i}" title="Remove">&#10005;</button></div>`).join("")}
      <button class="btn btn--sm" data-act="add" data-path="${esc(path)}" data-new="string">+ ${esc(addLabel)}</button>`;
  }

  function itemList(path, { newKey, titleKey, fields, addLabel, fixed, noun = "Item" }) {
    const arr = get(C(), path) || [];
    return `${arr.map((it, i) => `
      <details class="item">
        <summary><span class="idx">${String(i + 1).padStart(2, "0")}</span><span class="ttl">${esc(it[titleKey] || `${noun} ${i + 1}`)}</span>
          <button class="icon" data-act="move" data-path="${esc(path)}" data-i="${i}" data-d="-1" title="Move up" ${i === 0 ? "disabled" : ""}>&#8593;</button>
          <button class="icon" data-act="move" data-path="${esc(path)}" data-i="${i}" data-d="1" title="Move down" ${i === arr.length - 1 ? "disabled" : ""}>&#8595;</button>
          ${fixed ? "" : `<button class="icon icon--danger" data-act="del" data-path="${esc(path)}" data-i="${i}" title="Remove">&#10005;</button>`}</summary>
        <div class="item__body"><div class="grid2">${fields.map((f) => fld({ ...f, path: `${path}.${i}.${f.key}` })).join("")}</div></div>
      </details>`).join("")}
      ${fixed ? "" : `<button class="btn btn--sm" data-act="add" data-path="${esc(path)}" data-new="${newKey}">+ ${esc(addLabel)}</button>`}`;
  }

  const NEW = {
    string: () => "",
    product: () => ({ id: uid("p"), name: "New product", note: "", price: 0, category: C().shop.categories[0]?.id || "", tag: "", image: "", alt: "", visible: true, soldOut: false }),
    collection: () => ({ id: uid("c"), title: "New collection", text: "", image: "", alt: "", visible: true }),
    category: () => ({ id: uid("cat"), label: "New category" }),
    stat: () => ({ value: 0, label: "Label" }),
    step: () => ({ title: "New step", text: "" }),
    navlink: () => ({ label: "New link", href: "#" }),
    column: () => ({ title: "New column", links: [] }),
    link: () => ({ label: "Label", url: "" })
  };

  /* -------------------------------------------------------------- views */
  const fmtPrice = (n) => {
    const cur = C().settings.currency || {};
    try { return new Intl.NumberFormat(cur.locale || "en-US", { style: "currency", currency: cur.code || "USD", maximumFractionDigits: 0 }).format(Number(n) || 0); } catch (e) { return String(n); }
  };

  const VIEWS = {};
  const AFTER = {};

  /* Dashboard */
  VIEWS.dashboard = () => {
    const c = C();
    const prods = c.shop.products;
    const changed = changedSections();
    const warns = healthChecks();
    return `
      <p class="lead">Edit anything on the site from the menu. Changes stay as a draft in this browser until you press <b>Publish</b>, which saves them to GitHub and updates the live site within a minute or two.</p>
      <div class="stats">
        <div class="stat"><b>${prods.filter((p) => p.visible !== false).length}</b><span>Products live (${prods.length} total)</span></div>
        <div class="stat"><b>${c.collections.items.filter((p) => p.visible !== false).length}</b><span>Wardrobe collections</span></div>
        <div class="stat"><b>${prods.filter((p) => p.soldOut).length}</b><span>Sold out</span></div>
        <div class="stat"><b>${changed.length}</b><span>Sections changed</span></div>
      </div>
      <div class="grid2" style="align-items:start">
        ${card("Status", `<ul class="checks">
          <li><span class="dot ${changed.length ? "dot--warn" : ""}"></span><span>${changed.length ? `Unpublished changes in: <b>${changed.map(esc).join(", ")}</b>` : "Everything you see here is live."}</span></li>
          <li id="buildStatus"><span class="dot dot--warn"></span><span class="muted">Checking site deployment...</span></li>
          ${warns.map((w) => `<li><span class="dot dot--warn"></span><span>${w}</span></li>`).join("") || `<li><span class="dot"></span><span>No problems found.</span></li>`}
        </ul>`)}
        ${card("Quick actions", `<div class="row" style="gap:10px">
          <button class="btn" data-act="new-product">+ New product</button>
          <a class="btn" href="#/media">Upload images</a>
          <button class="btn" data-act="preview">Preview draft</button>
          <a class="btn" href="${esc($("#liveLink").href)}" target="_blank" rel="noopener">Open live site</a></div>`)}
      </div>
      ${card("Publish history", `<ul class="hist" id="history"><li class="muted">Loading history...</li></ul>`, { sub: `Every publish is a commit on <code>${esc(S.gh.branch)}</code>. Restore any earlier version as a draft.` })}`;
  };
  AFTER.dashboard = async () => {
    try {
      const list = await S.gh.commits(CONTENT_PATH, 8);
      const el = $("#history");
      if (!el) return;
      el.innerHTML = list.map((c) => `<li><span class="msg"><b>${esc((c.commit.message || "").split("\n")[0])}</b><br /><small>${esc(new Date(c.commit.author.date).toLocaleString())} by ${esc(c.commit.author.name)}</small></span>
        <button class="btn btn--sm" data-act="restore" data-sha="${esc(c.sha)}">Restore</button></li>`).join("") || `<li class="muted">No history yet.</li>`;
    } catch (e) { const el = $("#history"); if (el) el.innerHTML = `<li class="muted">Could not load history: ${esc(e.message)}</li>`; }
    try {
      const b = await S.gh.pagesBuild();
      const el = $("#buildStatus");
      if (!el) return;
      const ok = b.status === "built";
      el.innerHTML = `<span class="dot ${ok ? "" : "dot--warn"}"></span><span>Site deployment: <b>${esc(b.status)}</b>${b.updated_at ? `, ${esc(new Date(b.updated_at).toLocaleString())}` : ""}${b.error?.message ? `. ${esc(b.error.message)}` : ""}</span>`;
    } catch (e) {
      const el = $("#buildStatus");
      if (el) el.innerHTML = `<span class="dot dot--warn"></span><span class="muted">Deployment status unavailable (${e.status === 404 ? "GitHub Pages is not enabled for this repository, or the token cannot read it" : esc(e.message)}).</span>`;
    }
  };

  function healthChecks() {
    const c = C(); const w = [];
    const s = c.settings;
    if (c.sections.appointment !== false && !s.formEndpoint && !s.contactEmail) w.push(`The appointment form is not connected, so visitors cannot reach you. Add a contact email or form endpoint in <a href="#/settings">Settings</a>.`);
    const noImg = c.shop.products.filter((p) => p.visible !== false && !p.image).length;
    if (noImg) w.push(`${noImg} visible product${noImg > 1 ? "s have" : " has"} no image.`);
    const zero = c.shop.products.filter((p) => p.visible !== false && !(Number(p.price) > 0)).length;
    if (zero) w.push(`${zero} visible product${zero > 1 ? "s show" : " shows"} "Price on request" (price is 0).`);
    const noAlt = c.shop.products.filter((p) => p.image && !p.alt).length;
    if (noAlt) w.push(`${noAlt} product image${noAlt > 1 ? "s have" : " has"} no description for screen readers.`);
    return w;
  }

  function changedSections() {
    const out = [];
    const keys = new Set([...Object.keys(C()), ...Object.keys(S.published)]);
    keys.forEach((k) => { if (JSON.stringify(C()[k]) !== JSON.stringify(S.published[k])) out.push(k); });
    return out;
  }

  /* Products */
  VIEWS.products = () => {
    const sh = C().shop;
    const { pq, pcat } = S.ui;
    const q = pq.trim().toLowerCase();
    const rows = sh.products.map((p, i) => ({ p, i })).filter(({ p }) => (pcat === "all" || p.category === pcat) && (!q || `${p.name} ${p.note} ${p.tag}`.toLowerCase().includes(q)));
    const canMove = !q && pcat === "all";
    const catLabel = (id) => sh.categories.find((c) => c.id === id)?.label || `<span class="pill pill--bad">No category</span>`;
    return `
      <div class="tools">
        <input type="search" id="pq" placeholder="Search products" value="${esc(pq)}" />
        <div class="chips">
          <button class="chip ${pcat === "all" ? "is-on" : ""}" data-act="pcat" data-id="all">All</button>
          ${sh.categories.map((c) => `<button class="chip ${pcat === c.id ? "is-on" : ""}" data-act="pcat" data-id="${esc(c.id)}">${esc(c.label)}</button>`).join("")}
        </div>
        <button class="btn btn--gold" style="margin-left:auto" data-act="new-product">+ New product</button>
      </div>
      <section class="card" style="padding:8px 14px">
        ${rows.length ? `<table class="tbl"><thead><tr><th></th><th>Product</th><th class="hide-sm">Category</th><th>Price</th><th class="hide-sm">Status</th><th></th></tr></thead><tbody>
          ${rows.map(({ p, i }) => `<tr class="${p.visible === false ? "is-off" : ""}">
            <td style="width:64px"><img class="thumb" src="${esc(imgSrc(p.image))}" alt="" ${p.image ? "" : "hidden"} /></td>
            <td><div class="name">${esc(p.name)}</div><small>${esc(p.note)}</small></td>
            <td class="hide-sm">${catLabel(p.category)}</td>
            <td>${Number(p.price) > 0 ? esc(fmtPrice(p.price)) : `<span class="muted">On request</span>`}</td>
            <td class="hide-sm">${p.visible === false ? `<span class="pill">Hidden</span> ` : ""}${p.soldOut ? `<span class="pill pill--bad">Sold out</span> ` : ""}${p.tag ? `<span class="pill">${esc(p.tag)}</span>` : ""}</td>
            <td class="acts">
              <button class="icon" data-act="edit" data-kind="product" data-i="${i}" title="Edit">&#9998;</button>
              <button class="icon" data-act="toggle" data-path="shop.products" data-i="${i}" data-key="visible" title="${p.visible === false ? "Show on site" : "Hide from site"}">${p.visible === false ? "&#9711;" : "&#9673;"}</button>
              <button class="icon" data-act="move" data-path="shop.products" data-i="${i}" data-d="-1" title="Move up" ${canMove && i > 0 ? "" : "disabled"}>&#8593;</button>
              <button class="icon" data-act="move" data-path="shop.products" data-i="${i}" data-d="1" title="Move down" ${canMove && i < sh.products.length - 1 ? "" : "disabled"}>&#8595;</button>
              <button class="icon" data-act="dup" data-path="shop.products" data-i="${i}" title="Duplicate">&#10064;</button>
              <button class="icon icon--danger" data-act="del" data-path="shop.products" data-i="${i}" title="Delete">&#10005;</button>
            </td></tr>`).join("")}</tbody></table>` : `<div class="empty">${sh.products.length ? "No products match your filter." : "No products yet. Add your first one."}</div>`}
      </section>
      ${!canMove && sh.products.length > 1 ? `<p class="muted" style="margin:-8px 0 20px">Clear the search and category filter to reorder products.</p>` : ""}
      ${card("Shop section", `<div class="grid2">
          ${fld({ label: "Small heading", path: "shop.eyebrow" })}${fld({ label: "Title", path: "shop.title" })}
          ${fld({ label: "Add to bag button text", path: "shop.addLabel" })}</div>`, { right: sectionToggle("shop") })}
      ${card("Categories", `<p class="muted" style="margin-top:0">These become the filter buttons above the shop. A category only shows on the site when at least one visible product uses it.</p>
        ${itemList("shop.categories", { newKey: "category", titleKey: "label", addLabel: "Add category", noun: "Category", fields: [
          { key: "label", label: "Label shown on site" }, { key: "id", label: "Internal id", hint: "Lowercase letters. Products point to this id, so change it with care." }] })}`)}`;
  };

  /* Collections */
  VIEWS.collections = () => {
    const c = C().collections;
    return `
      ${card("Wardrobe section", `<div class="grid2">${fld({ label: "Small heading", path: "collections.eyebrow" })}${fld({ label: "Title", path: "collections.title" })}</div>`, { right: sectionToggle("collections"), sub: "The sideways scrolling gallery of collections." })}
      <div class="tools"><span class="muted">${c.items.length} collection${c.items.length === 1 ? "" : "s"}</span><button class="btn btn--gold" style="margin-left:auto" data-act="new-collection">+ New collection</button></div>
      <section class="card" style="padding:8px 14px">
        ${c.items.length ? `<table class="tbl"><thead><tr><th></th><th>Collection</th><th class="hide-sm">Status</th><th></th></tr></thead><tbody>
          ${c.items.map((p, i) => `<tr class="${p.visible === false ? "is-off" : ""}">
            <td style="width:64px"><img class="thumb" src="${esc(imgSrc(p.image))}" alt="" ${p.image ? "" : "hidden"} /></td>
            <td><div class="name">${esc(p.title)}</div><small>${esc(p.text)}</small></td>
            <td class="hide-sm">${p.visible === false ? `<span class="pill">Hidden</span>` : `<span class="pill">Visible</span>`}</td>
            <td class="acts">
              <button class="icon" data-act="edit" data-kind="collection" data-i="${i}" title="Edit">&#9998;</button>
              <button class="icon" data-act="toggle" data-path="collections.items" data-i="${i}" data-key="visible" title="Show or hide">${p.visible === false ? "&#9711;" : "&#9673;"}</button>
              <button class="icon" data-act="move" data-path="collections.items" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} title="Move up">&#8593;</button>
              <button class="icon" data-act="move" data-path="collections.items" data-i="${i}" data-d="1" ${i === c.items.length - 1 ? "disabled" : ""} title="Move down">&#8595;</button>
              <button class="icon" data-act="dup" data-path="collections.items" data-i="${i}" title="Duplicate">&#10064;</button>
              <button class="icon icon--danger" data-act="del" data-path="collections.items" data-i="${i}" title="Delete">&#10005;</button>
            </td></tr>`).join("")}</tbody></table>` : `<div class="empty">No collections yet.</div>`}
      </section>`;
  };

  /* Hero */
  VIEWS.hero = () => `
    ${card("Headline", `<div class="grid2">
      ${fld({ label: "Small heading", path: "hero.eyebrow" })}${fld({ label: "Scroll hint", path: "hero.scrollHint" })}
      ${fld({ label: "Headline line 1", path: "hero.line1" })}
      ${fld({ label: "Headline line 2 italic word", path: "hero.accent", hint: "Shown in gold italics before line 2. Leave empty for none." })}
      ${fld({ label: "Headline line 2", path: "hero.line2" })}
      ${fld({ label: "Large background word", path: "hero.giantText" })}</div>`, { sub: "The first screen. The man is dressed as visitors scroll." })}
    ${card("The four dressing steps", `<p class="muted" style="margin-top:0">These captions appear one by one as the suit goes on. There are always four, matching the animation.</p>
      ${itemList("hero.stages", { titleKey: "title", fixed: true, noun: "Step", fields: [
        { key: "num", label: "Numeral" }, { key: "title", label: "Title" }, { key: "text", label: "Text", type: "textarea", wide: true }] })}`)}
    ${card("Hero video", `<div class="grid2">
      ${fld({ label: "Use the video frames when available", path: "hero.video.enabled", type: "check", hint: "Turn off to always show the illustrated figure." })}
      ${fld({ label: "Frames manifest path", path: "hero.video.manifest", hint: "Created by scripts/extract-frames.sh. Leave as is." })}</div>`)}`;

  /* Story */
  VIEWS.story = () => `
    ${card("Manifesto", `<div class="grid2">
      ${fld({ label: "Small heading", path: "manifesto.eyebrow" })}${fld({ label: "Signature name", path: "manifesto.signName" })}
      ${fld({ label: "Statement", path: "manifesto.text", type: "textarea", rows: 5, wide: true })}
      ${fld({ label: "Signature role", path: "manifesto.signRole" })}</div>`, { right: sectionToggle("manifesto") })}
    ${card("Scrolling text band", strList("marquee.words", { addLabel: "Add word", ph: "Bespoke" }), { right: sectionToggle("marquee"), sub: "The words that glide across the page." })}
    ${card("Quote", fld({ label: "Quote text", path: "quote.text", type: "textarea", wide: true }), { right: sectionToggle("quote"), sub: "The large quote above the appointment form." })}`;

  /* Atelier */
  VIEWS.atelier = () => `
    ${card("Atelier section", `<div class="grid2">${fld({ label: "Small heading", path: "atelier.eyebrow" })}${fld({ label: "Title", path: "atelier.title" })}</div>`, { right: sectionToggle("atelier") })}
    ${card("Numbers", itemList("atelier.stats", { newKey: "stat", titleKey: "label", addLabel: "Add number", noun: "Number", fields: [
      { key: "value", label: "Number", type: "number" }, { key: "label", label: "Label" }] }), { sub: "Count up when visitors scroll to them." })}
    ${card("Process steps", itemList("atelier.steps", { newKey: "step", titleKey: "title", addLabel: "Add step", noun: "Step", fields: [
      { key: "title", label: "Title" }, { key: "text", label: "Text", type: "textarea", wide: true }] }), { sub: "The stacking cards." })}`;

  /* Appointment */
  VIEWS.appointment = () => `
    ${card("Appointment section", `<div class="grid2">
      ${fld({ label: "Small heading", path: "appointment.eyebrow" })}${fld({ label: "Title", path: "appointment.title" })}
      ${fld({ label: "Button text", path: "appointment.button" })}${fld({ label: "Message after sending", path: "appointment.success" })}</div>`, { right: sectionToggle("appointment") })}
    ${card("Interest options", strList("appointment.interests", { addLabel: "Add option", ph: "Wedding" }), { sub: "The dropdown visitors choose from." })}
    ${card("Where requests go", `<p style="margin-top:0">${C().settings.formEndpoint ? `Requests are sent to your form endpoint.` : C().settings.contactEmail ? `Requests open the visitor's email app addressed to <b>${esc(C().settings.contactEmail)}</b>.` : `<b>Not connected.</b> Visitors will see a notice that the form is not set up.`}</p><a class="btn" href="#/settings">Change in Settings</a>`)}`;

  /* Navigation and footer */
  VIEWS.navfooter = () => `
    ${card("Top navigation", itemList("nav", { newKey: "navlink", titleKey: "label", addLabel: "Add link", noun: "Link", fields: [
      { key: "label", label: "Label" }, { key: "href", label: "Link", hint: "Use #collections, #shop and so on to scroll to a section, or a full web address." }] }))}
    ${card("Footer columns", C().footer.columns.map((col, i) => `
      <details class="item"><summary><span class="idx">${String(i + 1).padStart(2, "0")}</span><span class="ttl">${esc(col.title || `Column ${i + 1}`)}</span>
        <button class="icon" data-act="move" data-path="footer.columns" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""}>&#8593;</button>
        <button class="icon" data-act="move" data-path="footer.columns" data-i="${i}" data-d="1" ${i === C().footer.columns.length - 1 ? "disabled" : ""}>&#8595;</button>
        <button class="icon icon--danger" data-act="del" data-path="footer.columns" data-i="${i}">&#10005;</button></summary>
        <div class="item__body">${fld({ label: "Column title", path: `footer.columns.${i}.title` })}
          ${itemList(`footer.columns.${i}.links`, { newKey: "link", titleKey: "label", addLabel: "Add link", noun: "Link", fields: [{ key: "label", label: "Text" }, { key: "url", label: "Link", hint: "Leave empty to show plain text." }] })}</div></details>`).join("") +
      `<button class="btn btn--sm" data-act="add" data-path="footer.columns" data-new="column">+ Add column</button>`)}
    ${card("Legal line", fld({ label: "Text", path: "footer.legal", hint: "Use {year} to insert the current year automatically." }))}`;

  /* Settings */
  VIEWS.settings = () => `
    ${card("Site", `<div class="grid2">
      ${fld({ label: "Browser tab title", path: "settings.siteTitle" })}
      ${fld({ label: "Search engine description", path: "settings.description", type: "textarea", rows: 2 })}</div>`)}
    ${card("Logos", `<div class="grid3">
      ${fld({ label: "Logo mark", path: "settings.logos.mark", type: "image", keep: true })}
      ${fld({ label: "Wordmark", path: "settings.logos.wordmark", type: "image", keep: true })}
      ${fld({ label: "Full lockup", path: "settings.logos.lockup", type: "image", keep: true })}</div>`, { sub: "Use PNG with a transparent background for the best result on the dark theme." })}
    ${card("Currency", `<div class="grid2">
      ${fld({ label: "Currency code", path: "settings.currency.code", hint: "USD, EUR, GBP, AED, SAR..." })}
      ${fld({ label: "Number format locale", path: "settings.currency.locale", hint: "en-US, en-GB, fr-FR, ar-AE..." })}</div>`)}
    ${card("Appointment requests", `<div class="grid2">
      ${fld({ label: "Contact email", path: "settings.contactEmail", type: "email", hint: "Opens the visitor's email app with the request filled in. Simple and free." })}
      ${fld({ label: "Form endpoint (optional)", path: "settings.formEndpoint", hint: "A Formspree or similar URL. When set, requests are sent there directly and the email option is ignored." })}</div>`)}
    ${card("Colors", `<div class="grid3">
      ${fld({ label: "Gold accent", path: "settings.theme.gold", type: "color" })}
      ${fld({ label: "Light gold", path: "settings.theme.goldLight", type: "color" })}
      ${fld({ label: "Navy", path: "settings.theme.navy", type: "color" })}
      ${fld({ label: "Deep navy background", path: "settings.theme.navyDark", type: "color" })}</div>`, { sub: "Use Preview draft to check the result before publishing." })}
    ${card("Backup", `<div class="row"><button class="btn" data-act="export">Download content backup</button>
      <label class="btn" style="cursor:pointer">Import backup<input type="file" accept="application/json" id="importFile" hidden /></label></div>
      <p class="muted" style="margin-bottom:0">Importing loads the file as a draft. Nothing changes on the live site until you publish.</p>`)}
    ${card("Connection", `<p style="margin-top:0">Connected to <code>${esc(S.gh.owner)}/${esc(S.gh.repo)}</code> on branch <code>${esc(S.gh.branch)}</code>.</p>
      <p class="muted">The live site reads from the branch GitHub Pages deploys. If your site is deployed from a different branch, disconnect and reconnect with that branch name.</p>
      <button class="btn btn--danger" data-act="disconnect">Disconnect</button>`)}`;

  /* Media */
  VIEWS.media = () => `
    <p class="lead">Upload photos once, then choose them for any product or collection. Photos are resized to 1600 pixels and compressed automatically.</p>
    <label class="drop" id="drop"><input type="file" id="mediaUpload" accept="image/*" multiple hidden />
      <b>Drop images here or click to upload</b><br /><small>JPG, PNG, WebP, GIF or SVG</small></label>
    <div id="mediaGrid" class="media"><p class="muted">Loading images...</p></div>`;
  AFTER.media = async () => {
    await ensureMedia();
    if (S.view !== "media") return;
    $("#mediaGrid").innerHTML = mediaTiles(false);
  };

  async function ensureMedia(force) {
    if (S.media && !force) return S.media;
    const all = [];
    for (const d of MEDIA_DIRS) {
      const files = await S.gh.listDir(d);
      files.filter((f) => IMG_EXT.test(f.name)).forEach((f) => all.push({ path: f.path, name: f.name, sha: f.sha, size: f.size, dir: d }));
    }
    S.media = all;
    return all;
  }

  function usageOf(path) {
    return JSON.stringify(C()).split(`"${path}"`).length - 1;
  }

  function mediaTiles(pick) {
    if (!S.media.length) return `<p class="muted">No images yet.</p>`;
    return S.media.map((m) => {
      const png = /\.(png|svg)$/i.test(m.name);
      const img = `<img class="${m.dir === "assets/brand" ? "contain" : ""}" loading="lazy" src="${esc(imgSrc(m.path))}" alt="" /><div class="tile__meta">${esc(m.name)}${usageOf(m.path) ? ` &middot; used ${usageOf(m.path)}x` : ""}</div>`;
      if (pick) return `<button type="button" class="tile" data-act="choose" data-path="${esc(m.path)}">${img}</button>`;
      return `<div class="tile">${img}<div class="tile__acts">
        <button class="icon" data-act="copy-path" data-path="${esc(m.path)}" title="Copy path">&#10064;</button>
        <button class="icon icon--danger" data-act="del-media" data-path="${esc(m.path)}" data-sha="${esc(m.sha)}" title="Delete">&#10005;</button></div></div>`;
    }).join("");
  }

  /* ------------------------------------------------------------- modals */
  function openModal(id, inner, { wide = false } = {}) {
    let m = document.getElementById(id);
    if (!m) { m = document.createElement("div"); m.id = id; m.className = "modal"; m.style.zIndex = id === "modal2" ? 120 : 100; document.body.appendChild(m); }
    m.hidden = false;
    m.innerHTML = `<div class="modal__box ${wide ? "modal__box--wide" : ""}" role="dialog" aria-modal="true">${inner}</div>`;
    return m;
  }
  function closeModal(id = "modal") {
    const m = document.getElementById(id);
    if (m) { m.hidden = true; m.innerHTML = ""; }
    if (id === "modal" && S.gh) rerender();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m2 = document.getElementById("modal2");
    if (m2 && !m2.hidden) closeModal("modal2"); else if (!$("#modal").hidden) closeModal("modal");
  });
  document.addEventListener("mousedown", (e) => { if (e.target.classList?.contains("modal")) closeModal(e.target.id); });

  const ITEM = {
    product: () => ({ title: "Product", list: "shop.products", fields: [
      { key: "name", label: "Name", wide: true }, { key: "note", label: "Short description", wide: true },
      { key: "price", label: "Price", type: "number", hint: "0 shows Price on request." },
      { key: "category", label: "Category", type: "select", options: C().shop.categories.map((c) => [c.id, c.label]) },
      { key: "tag", label: "Badge (optional)", hint: "A small word on the photo, such as New or Signature." },
      { key: "image", label: "Photo", type: "image", wide: true },
      { key: "alt", label: "Photo description", hint: "For screen readers and search engines.", wide: true },
      { key: "visible", label: "Show on site", type: "check" }, { key: "soldOut", label: "Mark as sold out", type: "check" }] }),
    collection: () => ({ title: "Collection", list: "collections.items", fields: [
      { key: "title", label: "Title", wide: true }, { key: "text", label: "Description", type: "textarea", wide: true },
      { key: "image", label: "Photo", type: "image", wide: true }, { key: "alt", label: "Photo description", wide: true },
      { key: "visible", label: "Show on site", type: "check" }] })
  };

  function openItem(kind, i) {
    const cfg = ITEM[kind]();
    const item = get(C(), cfg.list)[i];
    openModal("modal", `
      <div class="modal__head"><h2>Edit ${cfg.title.toLowerCase()}</h2><button class="icon" data-act="close" title="Close">&#10005;</button></div>
      <div class="grid2">${cfg.fields.map((f) => fld({ ...f, path: `${cfg.list}.${i}.${f.key}` })).join("")}</div>
      <div class="modal__foot"><small style="margin-right:auto;align-self:center">Changes are saved to your draft as you type.</small><button class="btn btn--gold" data-act="close">Done</button></div>`, { wide: true });
    void item;
  }

  function openPicker(path, keep) {
    openModal("modal2", `
      <div class="modal__head"><h2>Choose an image</h2><button class="icon" data-act="close2" title="Close">&#10005;</button></div>
      <label class="drop" id="pdrop"><input type="file" id="pickUpload" accept="image/*" hidden ${keep ? 'data-keep="1"' : ""} />
        <b>Upload a new image</b><br /><small>or choose one below</small></label>
      <div id="pickGrid" class="media"><p class="muted">Loading...</p></div>`, { wide: true });
    const grid = $("#pickGrid");
    grid.dataset.target = path;
    ensureMedia().then(() => { grid.innerHTML = mediaTiles(true); }).catch((e) => { grid.innerHTML = `<p class="muted">${esc(e.message)}</p>`; });
  }

  function setImagePath(path, value) {
    set(C(), path, value);
    $$(`[data-path="${CSS.escape(path)}"][data-type="image"]`).forEach((inp) => { inp.value = value; refreshThumb(inp); });
    touch();
  }

  /* ------------------------------------------------------------- images */
  async function processImage(file, keepPng) {
    if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) {
      return { bytes: new Uint8Array(await file.arrayBuffer()), ext: "svg", preview: URL.createObjectURL(file) };
    }
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error(`${file.name} is not an image this browser can read. Try JPG, PNG or WebP.`); }
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const png = keepPng || (file.type === "image/png" && file.size < 300 * 1024);
    const blob = await new Promise((r) => cv.toBlob(r, png ? "image/png" : "image/webp", 0.86));
    if (!blob) throw new Error(`Could not convert ${file.name}.`);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: png ? "png" : "webp", preview: URL.createObjectURL(blob) };
  }

  async function uploadFiles(files, { keepPng = false } = {}) {
    const done = [];
    for (const file of files) {
      try {
        toast(`Uploading ${file.name}...`);
        const img = await processImage(file, keepPng);
        const base = slug(file.name.replace(/\.[^.]+$/, ""));
        const path = `assets/uploads/${base}-${Date.now().toString(36)}.${img.ext}`;
        await S.gh.putFile(path, bytesToBase64(img.bytes), `Upload image ${base}`);
        S.thumbs[path] = img.preview;
        (S.media = S.media || []).push({ path, name: path.split("/").pop(), sha: "", size: img.bytes.length, dir: "assets/uploads" });
        done.push(path);
      } catch (e) { toast(e.message, true); }
    }
    if (done.length) toast(`Uploaded ${done.length} image${done.length > 1 ? "s" : ""}.`);
    return done;
  }

  /* ------------------------------------------------------------ publish */
  function validate() {
    const c = C(); const w = [];
    const ids = new Set(); const catIds = new Set(c.shop.categories.map((x) => x.id));
    c.shop.products.forEach((p) => {
      if (!String(p.name).trim()) w.push("A product has no name.");
      if (ids.has(p.id)) w.push(`Duplicate product id "${p.id}".`); ids.add(p.id);
      if (!catIds.has(p.category)) w.push(`"${p.name}" uses a category that does not exist.`);
    });
    if (c.hero.stages.length !== 4) w.push("The hero needs exactly four steps.");
    return w;
  }

  function openPublish() {
    const changed = changedSections();
    const warns = [...validate(), ...healthChecks().map((x) => x.replace(/<[^>]+>/g, ""))];
    openModal("modal", `
      <div class="modal__head"><h2>Publish changes</h2><button class="icon" data-act="close" title="Close">&#10005;</button></div>
      <p style="margin-top:0">This saves your changes to <code>${esc(S.gh.owner)}/${esc(S.gh.repo)}</code> on <code>${esc(S.gh.branch)}</code>. The live site updates in about a minute or two.</p>
      <p class="label">Changed sections</p><ul class="diff">${changed.map((k) => `<li>${esc(k)}</li>`).join("") || "<li>None</li>"}</ul>
      ${warns.length ? `<p class="label">Heads up</p><ul class="diff">${warns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <label class="field"><span>Note for the history</span><input type="text" id="commitMsg" value="Update site content" /></label>
      <div class="modal__foot"><button class="btn" data-act="close">Cancel</button><button class="btn btn--gold" data-act="do-publish">Publish now</button></div>`);
  }

  async function doPublish() {
    const msg = ($("#commitMsg")?.value || "Update site content").trim();
    S.busy = true; refreshBar();
    const btn = $('[data-act="do-publish"]'); if (btn) { btn.disabled = true; btn.textContent = "Publishing..."; }
    try {
      const remote = await S.gh.getFile(CONTENT_PATH);
      let sha = remote.sha;
      if (remote.sha !== S.baseSha && remote.text.trim() !== JSON.stringify(S.published, null, 2).trim()) {
        if (!confirm("The published content changed since you opened the admin (maybe from another device).\n\nOK overwrites it with your version. Cancel keeps your draft so you can review.")) throw new Error("Publish cancelled.");
      }
      const body = JSON.stringify(C(), null, 2) + "\n";
      const res = await S.gh.putFile(CONTENT_PATH, textToBase64(body), msg, sha);
      S.baseSha = res.content.sha;
      S.published = clone(C());
      try { localStorage.removeItem(KEYS.draft); } catch (e) { /* ignore */ }
      closeModal("modal");
      toast("Published. The live site updates in a minute or two.");
    } catch (e) {
      toast(e.message, true);
      if (btn) { btn.disabled = false; btn.textContent = "Publish now"; }
    } finally { S.busy = false; refreshBar(); }
  }

  /* ------------------------------------------------------------ actions */
  const ACTIONS = {
    close: () => closeModal("modal"),
    close2: () => closeModal("modal2"),
    disconnect,
    publish: openPublish,
    "do-publish": doPublish,
    preview: () => {
      try { localStorage.setItem(KEYS.draft, JSON.stringify(C())); } catch (e) { /* ignore */ }
      window.open("../?preview=1", "_blank");
    },
    discard: () => {
      if (!confirm("Discard all unpublished changes and go back to the live version?")) return;
      S.content = clone(S.published);
      try { localStorage.removeItem(KEYS.draft); } catch (e) { /* ignore */ }
      rerender(); toast("Draft discarded.");
    },
    add: (b) => {
      const arr = get(C(), b.dataset.path);
      arr.push(NEW[b.dataset.new]());
      touch(); rerender();
      const items = $$("details.item"); const last = items[items.length - 1];
      if (b.dataset.new !== "string" && last) last.open = true;
    },
    del: (b) => {
      const arr = get(C(), b.dataset.path); const i = +b.dataset.i; const it = arr[i];
      if (b.dataset.path === "shop.categories" && C().shop.products.some((p) => p.category === it.id)) { toast("That category is still used by products. Move them first.", true); return; }
      const name = it?.name || it?.title || it?.label || (typeof it === "string" ? it : "this item");
      if (!confirm(`Delete "${name}"?`)) return;
      arr.splice(i, 1); touch(); rerender();
    },
    move: (b) => { if (move(get(C(), b.dataset.path), +b.dataset.i, +b.dataset.d)) { touch(); rerender(); } },
    dup: (b) => {
      const arr = get(C(), b.dataset.path); const i = +b.dataset.i;
      const copy = clone(arr[i]); copy.id = uid(b.dataset.path.startsWith("shop") ? "p" : "c");
      if (copy.name) copy.name += " copy"; if (copy.title) copy.title += " copy";
      arr.splice(i + 1, 0, copy); touch(); rerender(); toast("Duplicated.");
    },
    toggle: (b) => { const it = get(C(), b.dataset.path)[+b.dataset.i]; it[b.dataset.key] = it[b.dataset.key] === false; touch(); rerender(); },
    edit: (b) => openItem(b.dataset.kind, +b.dataset.i),
    "new-product": () => {
      if (!C().shop.categories.length) { toast("Add a category first (Products page, Categories).", true); location.hash = "#/products"; return; }
      C().shop.products.unshift(NEW.product()); touch(); location.hash = "#/products"; S.view = "products"; rerender(); openItem("product", 0);
    },
    "new-collection": () => { C().collections.items.push(NEW.collection()); touch(); rerender(); openItem("collection", C().collections.items.length - 1); },
    pcat: (b) => { S.ui.pcat = b.dataset.id; rerender(); },
    pick: (b) => openPicker(b.dataset.path, !!b.dataset.keep),
    "clear-img": (b) => setImagePath(b.dataset.path, ""),
    choose: (b) => { setImagePath($("#pickGrid").dataset.target, b.dataset.path); closeModal("modal2"); },
    "copy-path": async (b) => { try { await navigator.clipboard.writeText(b.dataset.path); toast("Path copied."); } catch (e) { toast(b.dataset.path); } },
    "del-media": async (b) => {
      const path = b.dataset.path; const used = usageOf(path);
      if (!confirm(`${used ? `This image is used ${used} time${used > 1 ? "s" : ""} on the site. Deleting it will leave those spots empty.\n\n` : ""}Delete ${path.split("/").pop()} from the repository?`)) return;
      try {
        let sha = b.dataset.sha;
        if (!sha) sha = (await S.gh.listDir(path.split("/").slice(0, -1).join("/"))).find((f) => f.path === path)?.sha;
        await S.gh.deleteFile(path, sha, `Delete image ${path.split("/").pop()}`);
        S.media = S.media.filter((m) => m.path !== path);
        $("#mediaGrid").innerHTML = mediaTiles(false); toast("Image deleted.");
      } catch (e) { toast(e.message, true); }
    },
    restore: async (b) => {
      if (isDirty() && !confirm("Restoring replaces your current draft. Continue?")) return;
      try {
        const f = await S.gh.getFile(CONTENT_PATH, b.dataset.sha);
        S.content = JSON.parse(f.text); touch(); rerender(); toast("Version loaded as a draft. Review it, then publish.");
      } catch (e) { toast(e.message, true); }
    },
    export: () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(C(), null, 2)], { type: "application/json" }));
      a.download = `angelico-content-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    }
  };

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const fn = ACTIONS[b.dataset.act];
    if (fn) { e.preventDefault(); fn(b); }
  });

  document.addEventListener("input", (e) => { if (e.target.id === "pq") { S.ui.pq = e.target.value; const pos = e.target.selectionStart; rerender(); const n = $("#pq"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } });

  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.id === "mediaUpload") {
      const done = await uploadFiles([...t.files]); t.value = "";
      if (done.length && S.view === "media") $("#mediaGrid").innerHTML = mediaTiles(false);
    } else if (t.id === "pickUpload") {
      const done = await uploadFiles([...t.files], { keepPng: !!t.dataset.keep }); t.value = "";
      if (done.length) { setImagePath($("#pickGrid").dataset.target, done[0]); closeModal("modal2"); }
    } else if (t.id === "importFile") {
      try {
        const data = JSON.parse(await t.files[0].text());
        if (!data.shop || !data.hero || !data.settings) throw new Error("This file is not an Angelico content backup.");
        S.content = data; touch(); rerender(); toast("Backup loaded as a draft. Publish to apply it.");
      } catch (err) { toast(err.message, true); }
      t.value = "";
    }
  });

  ["dragover", "dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => {
    const z = e.target.closest?.("#drop, #pdrop");
    if (!z) return;
    e.preventDefault();
    z.classList.toggle("is-over", ev === "dragover");
    if (ev === "drop") {
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      uploadFiles(files).then((done) => {
        if (!done.length) return;
        if (z.id === "pdrop") { setImagePath($("#pickGrid").dataset.target, done[0]); closeModal("modal2"); }
        else $("#mediaGrid").innerHTML = mediaTiles(false);
      });
    }
  }));

  window.addEventListener("beforeunload", (e) => { if (S.gh && isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  /* --------------------------------------------------------------- init */
  (async function init() {
    let conn = {}; let token = "";
    try {
      conn = JSON.parse(localStorage.getItem(KEYS.conn) || "{}");
      token = sessionStorage.getItem(KEYS.token) || localStorage.getItem(KEYS.token) || "";
    } catch (e) { /* ignore */ }
    if (conn.owner && conn.repo && conn.branch && token) {
      try { await connect({ ...conn, token }); return; } catch (e) { showLogin(e.message); return; }
    }
    showLogin();
  })();
})();
