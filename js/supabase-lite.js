/*
  A small Supabase client: just the parts Angelico needs (Auth with email and
  password, the REST API, Storage). It talks to the documented HTTP endpoints
  directly, so there is nothing to install or bundle.
*/
(() => {
  "use strict";

  class SupabaseError extends Error {
    constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; }
  }

  class Supabase {
    constructor({ url, anonKey, storageKey = "angelico.sb.session" }) {
      this.url = String(url || "").replace(/\/+$/, "");
      this.anonKey = anonKey;
      this.storageKey = storageKey;
      this.session = null;
      this.remember = true;
    }

    /* ----------------------------------------------------- session */
    restore() {
      for (const store of [localStorage, sessionStorage]) {
        try {
          const raw = store.getItem(this.storageKey);
          if (raw) { this.session = JSON.parse(raw); this.remember = store === localStorage; return this.session; }
        } catch (e) { /* storage unavailable or corrupt */ }
      }
      return null;
    }

    save() {
      for (const store of [localStorage, sessionStorage]) { try { store.removeItem(this.storageKey); } catch (e) { /* ignore */ } }
      if (!this.session) return;
      try { (this.remember ? localStorage : sessionStorage).setItem(this.storageKey, JSON.stringify(this.session)); } catch (e) { /* ignore */ }
    }

    setSession(data) {
      this.session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        user: { id: data.user?.id, email: data.user?.email }
      };
      this.save();
    }

    async signIn(email, password, remember = true) {
      this.remember = remember;
      const data = await this.raw("POST", "/auth/v1/token?grant_type=password", { email, password }, { auth: false });
      this.setSession(data);
      return this.session.user;
    }

    async signOut() {
      try { if (this.session) await this.raw("POST", "/auth/v1/logout", null, { auth: true, retry: false }); } catch (e) { /* already invalid */ }
      this.session = null; this.save();
    }

    // Supabase rotates refresh tokens, so parallel requests must share ONE refresh
    // or the second one is rejected and the user is signed out.
    refresh() {
      if (this._refreshing) return this._refreshing;
      if (!this.session?.refresh_token) return Promise.reject(new SupabaseError(401, "Please sign in again."));
      this._refreshing = (async () => {
        try {
          const data = await this.raw("POST", "/auth/v1/token?grant_type=refresh_token", { refresh_token: this.session.refresh_token }, { auth: false });
          this.setSession(data);
        } catch (e) {
          this.session = null; this.save();
          throw new SupabaseError(401, "Your session expired. Please sign in again.");
        } finally { this._refreshing = null; }
      })();
      return this._refreshing;
    }

    /* ------------------------------------------------------ requests */
    headers(auth, extra) {
      const token = auth && this.session ? this.session.access_token : this.anonKey;
      return { apikey: this.anonKey, Authorization: `Bearer ${token}`, ...extra };
    }

    // Low level call. body may be an object (sent as JSON) or bytes (with opts.contentType).
    async raw(method, path, body, opts = {}) {
      const { auth = true, retry = true, headers = {}, contentType, expect = "json" } = opts;
      if (auth && this.session && this.session.expires_at - 30 < Date.now() / 1000 && retry) await this.refresh();
      else if (auth && this._refreshing) await this._refreshing.catch(() => {});
      const isBytes = body instanceof Uint8Array || body instanceof Blob;
      let res;
      try {
        res = await fetch(`${this.url}${path}`, {
          method,
          headers: this.headers(auth, { ...(body != null ? { "Content-Type": contentType || "application/json" } : {}), ...headers }),
          body: body == null ? undefined : isBytes ? body : JSON.stringify(body),
          cache: "no-store"
        });
      } catch (e) {
        throw new SupabaseError(0, "Network error. Check your connection and try again.");
      }
      if (res.status === 401 && auth && retry && this.session) { await this.refresh(); return this.raw(method, path, body, { ...opts, retry: false }); }
      if (res.status === 204 || (res.ok && expect === "none")) return null;
      let data = null;
      try { data = await res.json(); } catch (e) { /* empty body */ }
      if (!res.ok) {
        const msg = data?.msg || data?.message || data?.error_description || data?.error || `Supabase returned ${res.status}`;
        const friendly = /invalid login credentials/i.test(msg) ? "Wrong email or password."
          : res.status === 403 || /row-level security|permission denied/i.test(msg) ? "You do not have permission to do that."
          : msg;
        throw new SupabaseError(res.status, friendly, data);
      }
      return data;
    }

    /* ----------------------------------------------------------- REST */
    select(table, query = "") { return this.raw("GET", `/rest/v1/${table}${query ? "?" + query : ""}`); }

    async insert(table, row, { upsertOn } = {}) {
      const prefer = ["return=minimal", ...(upsertOn ? ["resolution=merge-duplicates"] : [])].join(",");
      return this.raw("POST", `/rest/v1/${table}${upsertOn ? `?on_conflict=${upsertOn}` : ""}`, row, { headers: { Prefer: prefer }, expect: "none" });
    }

    update(table, match, patch) { return this.raw("PATCH", `/rest/v1/${table}?${match}`, patch, { headers: { Prefer: "return=minimal" }, expect: "none" }); }
    remove(table, match) { return this.raw("DELETE", `/rest/v1/${table}?${match}`, null, { headers: { Prefer: "return=minimal" }, expect: "none" }); }
    rpc(fn, args = {}) { return this.raw("POST", `/rest/v1/rpc/${fn}`, args); }

    /* -------------------------------------------------------- storage */
    publicUrl(bucket, path) { return `${this.url}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`; }

    upload(bucket, path, bytes, contentType) {
      return this.raw("POST", `/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, bytes, { contentType, headers: { "x-upsert": "false" } });
    }

    list(bucket, prefix = "", limit = 200) {
      return this.raw("POST", `/storage/v1/object/list/${bucket}`, { prefix, limit, offset: 0, sortBy: { column: "created_at", order: "desc" } });
    }

    removeObjects(bucket, paths) { return this.raw("DELETE", `/storage/v1/object/${bucket}`, { prefixes: paths }); }
  }

  const cfg = () => window.ANGELICO_SUPABASE || {};
  const configured = () => !!(cfg().url && cfg().anonKey && !/YOUR[-_ ]?PROJECT/i.test(cfg().url));

  window.AngelicoSupabase = { Supabase, SupabaseError, configured, cfg };
})();
