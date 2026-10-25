/*
  Minimal GitHub REST client used by the admin to read and write site content.
  Every save is a real git commit on the configured branch, so GitHub keeps
  the full history and any change can be restored.
*/
(() => {
  "use strict";

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function bytesToBase64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  const textToBase64 = (text) => bytesToBase64(enc.encode(text));
  const base64ToText = (b64) => dec.decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

  class GitHubError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  class GitHub {
    constructor({ owner, repo, branch, token, api }) {
      Object.assign(this, { owner, repo, branch, token, api: api || "https://api.github.com" });
    }

    async req(method, path, body) {
      let res;
      try {
        res = await fetch(`${this.api}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(body ? { "Content-Type": "application/json" } : {})
          },
          body: body ? JSON.stringify(body) : undefined,
          cache: "no-store"
        });
      } catch (e) {
        throw new GitHubError(0, "Network error. Check your connection and try again.");
      }
      if (res.status === 204) return null;
      let data = null;
      try { data = await res.json(); } catch (e) { /* empty body */ }
      if (!res.ok) {
        const msg = data?.message || `GitHub returned ${res.status}`;
        const hint = res.status === 401 ? "The token is invalid or expired." : res.status === 403 ? "The token lacks permission, or the rate limit was hit." : res.status === 404 ? "Not found. Check the repository, branch and token access." : "";
        throw new GitHubError(res.status, `${msg}${hint ? " " + hint : ""}`);
      }
      return data;
    }

    get base() { return `/repos/${this.owner}/${this.repo}`; }
    repoInfo() { return this.req("GET", this.base); }

    async getFile(path, ref) {
      const data = await this.req("GET", `${this.base}/contents/${path}?ref=${encodeURIComponent(ref || this.branch)}`);
      if (Array.isArray(data) || data.type !== "file") throw new GitHubError(400, `${path} is not a file.`);
      if (data.content == null || data.encoding !== "base64") throw new GitHubError(400, `${path} is too large to read through the API.`);
      return { sha: data.sha, text: base64ToText(data.content), size: data.size };
    }

    async listDir(path) {
      try {
        const data = await this.req("GET", `${this.base}/contents/${path}?ref=${encodeURIComponent(this.branch)}`);
        return Array.isArray(data) ? data.filter((f) => f.type === "file") : [];
      } catch (e) {
        if (e.status === 404) return [];
        throw e;
      }
    }

    putFile(path, base64, message, sha) {
      return this.req("PUT", `${this.base}/contents/${path}`, { message, content: base64, branch: this.branch, ...(sha ? { sha } : {}) });
    }

    deleteFile(path, sha, message) {
      return this.req("DELETE", `${this.base}/contents/${path}`, { message, sha, branch: this.branch });
    }

    commits(path, perPage = 8) {
      return this.req("GET", `${this.base}/commits?sha=${encodeURIComponent(this.branch)}&path=${encodeURIComponent(path)}&per_page=${perPage}`);
    }

    pagesBuild() { return this.req("GET", `${this.base}/pages/builds/latest`); }
  }

  window.AngelicoGitHub = { GitHub, GitHubError, textToBase64, bytesToBase64, base64ToText };
})();
