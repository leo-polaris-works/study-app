// テスト用の道具：偽の GitHub（メモリ上）と、端末1台ぶんの実行環境（偽 localStorage・偽 fetch）。
// 実際の通信はしない。テストにサンプルの鍵・記録を使うが、個人情報は入れない。

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_DIR = path.join(__dirname, '..');
const OWNER = 'leo-polaris-works';
const REPO = 'study-records';

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function jsonResponse(status, body, headers) {
  const h = Object.assign({}, headers || {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (h[k.toLowerCase()] !== undefined ? h[k.toLowerCase()] : null) },
    json: async () => body,
  };
}

// GitHub の Contents API の一部を真似る
class FakeGitHub {
  constructor() {
    this.files = new Map(); // path -> { text, sha }
    this.tokens = new Map(); // token -> 'write' | 'read'
    this.log = []; // { method, url, headers, body }
    this.failNext = []; // [{ method, status, message, headers }]（先頭から1回ずつ使う）
    this.dropResponseOnce = false; // 次の PUT を実行するが、返事は通信エラーにする
    this.hidePermissions = false; // リポジトリ情報に permissions を含めない
    this.repoName = REPO;
  }

  addToken(token, perm) {
    this.tokens.set(token, perm);
  }

  revokeToken(token) {
    this.tokens.delete(token);
  }

  putFile(filePath, text) {
    this.files.set(filePath, { text, sha: sha1(text) });
  }

  requests(method) {
    return this.log.filter((r) => !method || r.method === method);
  }

  async handle(url, init) {
    const method = (init && init.method) || 'GET';
    const headers = (init && init.headers) || {};
    const body = init && init.body ? JSON.parse(init.body) : null;
    this.log.push({ method, url, headers, body });

    const auth = String(headers.Authorization || '');
    const token = auth.replace(/^Bearer /, '');
    const perm = this.tokens.get(token);

    const fail = this.failNext.findIndex((f) => !f.method || f.method === method);
    if (fail >= 0) {
      const f = this.failNext.splice(fail, 1)[0];
      return jsonResponse(f.status, { message: f.message || 'error' }, f.headers);
    }
    if (!perm) return jsonResponse(401, { message: 'Bad credentials' });

    const u = new URL(url);
    const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.*))?$/.exec(u.pathname);
    if (!m || m[1] !== OWNER || m[2] !== this.repoName) return jsonResponse(404, { message: 'Not Found' });
    const filePath = m[3] ? m[3].split('/').map(decodeURIComponent).join('/') : null;

    if (filePath === null) {
      const data = { name: this.repoName, private: true };
      if (!this.hidePermissions) data.permissions = { push: perm === 'write', pull: true };
      return jsonResponse(200, data);
    }

    if (method === 'GET') {
      const file = this.files.get(filePath);
      if (file) {
        const b64 = Buffer.from(file.text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
        return jsonResponse(200, { type: 'file', path: filePath, sha: file.sha, content: b64, encoding: 'base64' });
      }
      const prefix = filePath + '/';
      const entries = [...this.files.entries()]
        .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(([p, f]) => ({ type: 'file', name: p.slice(prefix.length), path: p, sha: f.sha }));
      return entries.length ? jsonResponse(200, entries) : jsonResponse(404, { message: 'Not Found' });
    }

    if (method === 'PUT') {
      if (perm !== 'write') return jsonResponse(403, { message: 'Resource not accessible by personal access token' });
      const existing = this.files.get(filePath);
      if (existing && !body.sha) return jsonResponse(422, { message: 'Invalid request. "sha" wasn\'t supplied.' });
      if (existing && body.sha !== existing.sha) return jsonResponse(409, { message: `${filePath} does not match ${body.sha}` });
      if (!existing && body.sha) return jsonResponse(409, { message: 'sha does not match' });
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      this.putFile(filePath, text);
      if (this.dropResponseOnce) {
        this.dropResponseOnce = false;
        throw new TypeError('Failed to fetch');
      }
      return jsonResponse(existing ? 200 : 201, { content: { path: filePath, sha: sha1(text) }, commit: { message: body.message } });
    }
    return jsonResponse(405, { message: 'Method not allowed' });
  }
}

const SCRIPT_ORDER = ['config.js', 'master.js', 'data.js', 'plan.js', 'github.js', 'sync.js'];

// 端末1台ぶん。ctx.run(コード) で、スクリプト直下の const・let も読める
// initialStore：スクリプトを読む前から端末に入っている保存データ（前の版で使っていた端末の再現）
function makeDevice(server, kind, initialStore) {
  const store = new Map(Object.entries(initialStore || {}));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const dev = { offline: false, store };
  const fetchFn = async (url, init) => {
    if (dev.offline) throw new TypeError('Failed to fetch');
    return server.handle(url, init);
  };
  const ctx = vm.createContext({
    localStorage,
    fetch: fetchFn,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    URL,
    console,
    setTimeout,
    clearTimeout,
    navigator: { userAgent: kind === 'iPad' ? 'iPad' : 'Android', maxTouchPoints: 5 },
  });
  SCRIPT_ORDER.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(APP_DIR, f), 'utf8'), ctx, { filename: f });
  });
  ctx.run = (code) => vm.runInContext(code, ctx);
  ctx.run('syncSleep = () => Promise.resolve()');
  dev.ctx = ctx;
  return dev;
}

// 記録の見本（02 の形）
function sampleRecord(o) {
  const at = o.updatedAt || o.createdAt || o.date + 'T19:30:45+09:00';
  return {
    schemaVersion: 1,
    id: o.id,
    date: o.date,
    timeBand: { id: 'tb-night', label: '夜' },
    totalMinutes: o.totalMinutes || 50,
    subject: o.subject || '英語',
    activity: { id: 'a-hw', label: '宿題・提出物' },
    fields: [{ id: 'f-en-word', label: '単語・熟語', minutes: o.totalMinutes || 50 }],
    materials: [{ id: 'm-en-hw', label: '宿題', amount: { value: 5, unit: 'ページ' } }],
    accuracy: { level: 3, label: '〜70%' },
    issues: o.issues || [],
    device: { id: 'a3f9', kind: 'iPad' },
    createdAt: o.createdAt || at,
    updatedAt: at,
    deleted: !!o.deleted,
  };
}

module.exports = { FakeGitHub, makeDevice, sampleRecord, APP_DIR, OWNER, REPO };
