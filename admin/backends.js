/*
  Storage backends for the admin. Both expose the same small interface, so the
  rest of the admin does not care where content lives.

    connect()                      -> { content }   (null when nothing is published yet)
    publish(content, note, opts)   -> saves; throws ConflictError if someone else published meanwhile
    history()                      -> [{ id, note, date, author }]
    loadVersion(id)                -> content
    listMedia()                    -> [{ path, name, size, dir, ... }]
    upload({ name, bytes, ext, mime }) -> path or URL to store in the content
    deleteMedia(item)
    status()                       -> { ok, text }
    liveUrl                        -> where the public site lives
*/
(() => {
  "use strict";

  const { GitHub, textToBase64, bytesToBase64 } = window.AngelicoGitHub;
  const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
  const stamp = () => Date.now().toString(36);

  class ConflictError extends Error {}

  /* ------------------------------------------------------------- GitHub */
  const CONTENT_PATH = "content/site.json";
  const MEDIA_DIRS = ["assets/products", "assets/uploads", "assets/brand"];
  const IMG_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

  class GitHubBackend {
    constructor({ owner, repo, branch, token, api }) {
      this.kind = "github";
      this.gh = new GitHub({ owner, repo, branch, token, api });
      this.supportsRequests = false;
    }
    get where() { return `${this.gh.owner}/${this.gh.repo}`; }
    get branch() { return this.gh.branch; }
    get liveUrl() { return `https://${this.gh.owner}.github.io/${this.gh.repo}/`; }
    get publishNote() { return "The live site updates in about a minute or two."; }

    async connect() {
      const info = await this.gh.repoInfo();
      if (info.permissions && !info.permissions.push) throw new Error("This token can read the repository but cannot write to it. Give it Contents: Read and write.");
      let file;
      try { file = await this.gh.getFile(CONTENT_PATH); } catch (e) {
        if (e.status === 404) throw new Error(`Could not find ${CONTENT_PATH} on branch "${this.gh.branch}". Check the branch name, or deploy the site files to that branch first.`);
        throw e;
      }
      this.baseSha = file.sha;
      this.publishedText = file.text;
      return { content: JSON.parse(file.text) };
    }

    async publish(content, note, { force = false } = {}) {
      const remote = await this.gh.getFile(CONTENT_PATH);
      if (!force && remote.sha !== this.baseSha && remote.text.trim() !== this.publishedText.trim()) throw new ConflictError("The published content changed since you opened the admin.");
      const body = JSON.stringify(content, null, 2) + "\n";
      const res = await this.gh.putFile(CONTENT_PATH, textToBase64(body), note, remote.sha);
      this.baseSha = res.content.sha;
      this.publishedText = body;
    }

    async history() {
      const list = await this.gh.commits(CONTENT_PATH, 8);
      return list.map((c) => ({ id: c.sha, note: (c.commit.message || "").split("\n")[0], date: c.commit.author.date, author: c.commit.author.name }));
    }
    async loadVersion(id) { return JSON.parse((await this.gh.getFile(CONTENT_PATH, id)).text); }

    async listMedia() {
      const all = [];
      for (const d of MEDIA_DIRS) {
        const files = await this.gh.listDir(d);
        files.filter((f) => IMG_EXT.test(f.name)).forEach((f) => all.push({ path: f.path, name: f.name, sha: f.sha, size: f.size, dir: d }));
      }
      return all;
    }
    async upload({ name, bytes, ext }) {
      const path = `assets/uploads/${slug(name)}-${stamp()}.${ext}`;
      await this.gh.putFile(path, bytesToBase64(bytes), `Upload image ${slug(name)}`);
      return { path, item: { path, name: path.split("/").pop(), sha: "", size: bytes.length, dir: "assets/uploads" } };
    }
    async deleteMedia(item) {
      let sha = item.sha;
      if (!sha) sha = (await this.gh.listDir(item.path.split("/").slice(0, -1).join("/"))).find((f) => f.path === item.path)?.sha;
      await this.gh.deleteFile(item.path, sha, `Delete image ${item.name}`);
    }
    async status() {
      try {
        const b = await this.gh.pagesBuild();
        return { ok: b.status === "built", text: `Site deployment: ${b.status}${b.updated_at ? ", " + new Date(b.updated_at).toLocaleString() : ""}${b.error?.message ? ". " + b.error.message : ""}` };
      } catch (e) {
        return { ok: false, text: `Deployment status unavailable (${e.status === 404 ? "GitHub Pages is not enabled for this repository, or the token cannot read it" : e.message}).` };
      }
    }
    async signOut() { /* nothing to revoke */ }
  }

  /* ----------------------------------------------------------- Supabase */
  class SupabaseBackend {
    constructor(cfg) {
      this.kind = "supabase";
      const { Supabase } = window.AngelicoSupabase;
      this.sb = new Supabase({ url: cfg.url, anonKey: cfg.anonKey });
      this.sb.restore();
      this.supportsRequests = true;
    }
    get where() { return this.sb.url.replace(/^https?:\/\//, ""); }
    get user() { return this.sb.session?.user; }
    get hasSession() { return !!this.sb.session; }
    get liveUrl() { return "../"; }
    get publishNote() { return "The live site updates instantly."; }

    async login(email, password, remember) {
      await this.sb.signIn(email, password, remember);
      await this.assertAdmin();
    }
    async assertAdmin() {
      const ok = await this.sb.rpc("is_admin");
      if (ok !== true) {
        await this.sb.signOut();
        throw new Error("You are signed in, but this account is not an administrator. Add it to admin_users (see supabase/README).");
      }
    }

    async connect() {
      await this.assertAdmin();
      const rows = await this.sb.select("site_content", "key=eq.published&select=data,updated_at");
      this.baseUpdated = rows[0]?.updated_at ?? null;
      return { content: rows[0]?.data ?? null };
    }

    async publish(content, note, { force = false } = {}) {
      const cur = (await this.sb.select("site_content", "key=eq.published&select=updated_at"))[0]?.updated_at ?? null;
      if (!force && cur !== this.baseUpdated) throw new ConflictError("The published content changed since you opened the admin.");
      // History first, so a restorable copy exists even if the next step fails.
      await this.sb.insert("site_versions", { data: content, note, created_by_email: this.user?.email || null });
      await this.sb.insert("site_content", { key: "published", data: content, updated_at: new Date().toISOString() }, { upsertOn: "key" });
      this.baseUpdated = (await this.sb.select("site_content", "key=eq.published&select=updated_at"))[0]?.updated_at ?? null;
    }

    async history() {
      const rows = await this.sb.select("site_versions", "select=id,note,created_at,created_by_email&order=created_at.desc&limit=8");
      return rows.map((r) => ({ id: r.id, note: r.note || "Published", date: r.created_at, author: r.created_by_email || "" }));
    }
    async loadVersion(id) {
      const rows = await this.sb.select("site_versions", `id=eq.${encodeURIComponent(id)}&select=data`);
      if (!rows[0]) throw new Error("That version no longer exists.");
      return rows[0].data;
    }

    async listMedia() {
      const objs = await this.sb.list("media", "uploads");
      return (objs || []).filter((o) => o.id && IMG_EXT.test(o.name)).map((o) => ({
        path: this.sb.publicUrl("media", `uploads/${o.name}`), storagePath: `uploads/${o.name}`, name: o.name, size: o.metadata?.size || 0, dir: "uploads"
      }));
    }
    async upload({ name, bytes, ext, mime }) {
      const storagePath = `uploads/${slug(name)}-${stamp()}.${ext}`;
      await this.sb.upload("media", storagePath, bytes, mime);
      const path = this.sb.publicUrl("media", storagePath);
      return { path, item: { path, storagePath, name: storagePath.split("/").pop(), size: bytes.length, dir: "uploads" } };
    }
    async deleteMedia(item) { await this.sb.removeObjects("media", [item.storagePath]); }
    async status() { return { ok: true, text: "Content is served live from Supabase. Publishing is instant." }; }
    async signOut() { await this.sb.signOut(); }

    /* Appointment requests */
    listRequests() { return this.sb.select("appointments", "select=*&order=created_at.desc&limit=500"); }
    updateRequest(id, patch) { return this.sb.update("appointments", `id=eq.${encodeURIComponent(id)}`, patch); }
    deleteRequest(id) { return this.sb.remove("appointments", `id=eq.${encodeURIComponent(id)}`); }
    async countNewRequests() { return (await this.sb.select("appointments", "status=eq.new&select=id&limit=1000")).length; }
  }

  window.AngelicoBackends = { GitHubBackend, SupabaseBackend, ConflictError };
})();
