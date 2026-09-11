/* ==========================================================================
   OpenOS · github.js — publish OpenSharp apps straight into a GitHub repo
   Uses the REST contents API with a fine-grained personal access token that
   the user pastes into App Store → Yayınla. The token never leaves the
   browser except as an Authorization header to api.github.com.
   ========================================================================== */

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(msg, status, body) {
    super(msg);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

/* base64 that survives UTF-8 (Turkish app names, emoji in sources) */
export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHub {
  constructor({ token, repo, branch = 'main' } = {}) {
    this.token = token;
    this.repo = repo;              /* "owner/name" */
    this.branch = branch;
  }

  get configured() { return !!(this.token && this.repo && /^[\w.-]+\/[\w.-]+$/.test(this.repo)); }

  async req(path, { method = 'GET', body, raw = false } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      throw new GitHubError(data?.message || `GitHub ${res.status}`, res.status, data);
    }
    return data;
  }

  /* ---------------- identity ---------------- */
  async whoami() {
    const u = await this.req('/user');
    if (!u) throw new GitHubError('Token geçersiz', 401);
    return { login: u.login, name: u.name, avatar: u.avatar_url, url: u.html_url };
  }

  async repoInfo() {
    const r = await this.req(`/repos/${this.repo}`);
    if (!r) throw new GitHubError(`Depo bulunamadı: ${this.repo}`, 404);
    return {
      full: r.full_name, private: r.private, defaultBranch: r.default_branch,
      canPush: !!r.permissions?.push, url: r.html_url, stars: r.stargazers_count,
    };
  }

  /* ---------------- files ---------------- */
  async getFile(path) {
    const r = await this.req(`/repos/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (!r || Array.isArray(r)) return null;
    return { sha: r.sha, content: r.content ? b64decode(r.content) : '', path: r.path, url: r.html_url };
  }

  async putFile(path, content, message) {
    const existing = await this.getFile(path);
    const r = await this.req(`/repos/${this.repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: {
        message,
        content: b64encode(content),
        branch: this.branch,
        ...(existing ? { sha: existing.sha } : {}),
      },
    });
    return { path, url: r?.content?.html_url, commit: r?.commit?.sha, updated: !!existing };
  }

  async deleteFile(path, message) {
    const existing = await this.getFile(path);
    if (!existing) return false;
    await this.req(`/repos/${this.repo}/contents/${encodePath(path)}`, {
      method: 'DELETE',
      body: { message, sha: existing.sha, branch: this.branch },
    });
    return true;
  }

  async listDir(path) {
    const r = await this.req(`/repos/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`);
    return Array.isArray(r) ? r.map(f => ({ name: f.name, path: f.path, type: f.type, size: f.size })) : [];
  }

  /* ---------------- the store protocol ----------------
     apps/<id>/app.osh     the program
     apps/<id>/app.json    its manifest
     catalog.json          the index every client reads
  --------------------------------------------------------- */
  async publishApp({ id, name, source, manifest, message }) {
    if (!this.configured) throw new GitHubError('GitHub yapılandırılmadı', 0);
    const dir = `apps/${id}`;
    const now = new Date().toISOString();

    const meta = {
      id, name, ...manifest,
      updated: now,
      size: source.length,
      files: { source: `${dir}/app.osh`, manifest: `${dir}/app.json` },
    };

    await this.putFile(`${dir}/app.osh`, source, message || `store: ${name} yayınlandı`);
    await this.putFile(`${dir}/app.json`, JSON.stringify(meta, null, 2), `store: ${name} manifesti`);

    /* merge into the catalogue, keeping every other entry byte-identical */
    const cat = await this.getCatalog();
    const list = Array.isArray(cat?.apps) ? cat.apps : [];
    const i = list.findIndex(a => a.id === id);
    const entry = {
      id, name, summary: manifest.summary || '', author: manifest.author || '',
      icon: manifest.icon || 'sparkles', tint: manifest.tint || ['#5e5ce6', '#bf5af2'],
      category: manifest.category || 'Araç', version: manifest.version || '1.0.0',
      updated: now, size: source.length, source: `${dir}/app.osh`,
    };
    if (i >= 0) { entry.created = list[i].created || now; list[i] = entry; }
    else { entry.created = now; list.push(entry); }

    const catalog = {
      schema: 1,
      name: cat?.name || 'OpenOS Cloud App Store',
      updated: now,
      apps: list.sort((a, b) => a.name.localeCompare(b.name)),
    };
    await this.putFile('catalog.json', JSON.stringify(catalog, null, 2),
      `store: katalog güncellendi (${name})`);

    return { ...entry, catalogCount: list.length };
  }

  async getCatalog() {
    const f = await this.getFile('catalog.json');
    if (!f) return null;
    try { return JSON.parse(f.content); } catch { return null; }
  }

  async unpublishApp(id, name = id) {
    await this.deleteFile(`apps/${id}/app.osh`, `store: ${name} kaldırıldı`).catch(() => {});
    await this.deleteFile(`apps/${id}/app.json`, `store: ${name} manifesti kaldırıldı`).catch(() => {});
    const cat = await this.getCatalog();
    if (cat?.apps) {
      cat.apps = cat.apps.filter(a => a.id !== id);
      cat.updated = new Date().toISOString();
      await this.putFile('catalog.json', JSON.stringify(cat, null, 2), `store: katalog güncellendi (${name} kaldırıldı)`);
    }
    return true;
  }

  /** Bootstrap an empty repo into a valid store. */
  async initStore({ title = 'OpenOS Cloud', owner = '' } = {}) {
    const existing = await this.getCatalog();
    if (existing) return { created: false, apps: existing.apps?.length || 0 };
    await this.putFile('catalog.json', JSON.stringify({
      schema: 1, name: title, owner, updated: new Date().toISOString(), apps: [],
    }, null, 2), 'store: katalog oluşturuldu');
    await this.putFile('README.md', STORE_README(title, this.repo), 'store: README');
    return { created: true, apps: 0 };
  }
}

const encodePath = p => String(p).split('/').map(encodeURIComponent).join('/');

const STORE_README = (title, repo) => `# ${title}

OpenOS App Store deposu. Bu depo, [OpenOS](https://github.com/${repo.split('/')[0]}) içindeki
App Store uygulamasının okuduğu katalogdur.

## Yapı

\`\`\`
catalog.json          her istemcinin okuduğu dizin
apps/<id>/app.osh     uygulamanın OpenSharp kaynağı
apps/<id>/app.json    uygulamanın manifesti
\`\`\`

## Uygulama yayınlamak

OpenOS içinde **App Store → Yayınla** adımlarını izleyin. İnce ayrıntılı bir
GitHub erişim belirteci (yalnızca bu depo için \`Contents: Read and write\`)
yeterlidir; belirteç tarayıcınızdan çıkmaz.

Elle eklemek isterseniz \`apps/<id>/\` altına dosyaları koyup \`catalog.json\`
içine girdiyi ekleyin — şema \`catalog.json\` içindeki \`schema: 1\`.

## Lisans

Katalogdaki her uygulama kendi lisansına tabidir; deponun kendisi
OpenOS ile aynı lisansı (AGPL-3.0-or-later) taşır.
`;

export default GitHub;
