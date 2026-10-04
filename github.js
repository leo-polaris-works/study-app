// GitHub Contents API の薄いクライアント。通信は fetch だけ（テストでは偽の fetch に差し替える）。
// 鍵（トークン）は Authorization ヘッダーにだけ入れる。URL・ログ・エラー文には出さない。

const GITHUB_API = 'https://api.github.com';

// --- UTF-8 と base64 ---
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// --- エラー ---
// kind：network（通信できない）／auth（401）／forbidden（403 権限不足）／ratelimit（403・429 回数制限）
//       notfound（404）／conflict（409・422 同時書き込み・sha の食い違い）／server（5xx）／other
function makeGithubError(kind, status, message) {
  const err = new Error(message || kind);
  err.kind = kind;
  err.status = status;
  return err;
}

function classifyGithubStatus(status, headers, message) {
  const remaining = headers && headers.get ? headers.get('x-ratelimit-remaining') : null;
  const retryAfter = headers && headers.get ? headers.get('retry-after') : null;
  if (status === 401) return 'auth';
  if (status === 403) {
    if (remaining === '0' || retryAfter || /rate limit|abuse/i.test(message || '')) return 'ratelimit';
    return 'forbidden';
  }
  if (status === 429) return 'ratelimit';
  if (status === 404) return 'notfound';
  if (status === 409 || status === 422) return 'conflict';
  if (status >= 500) return 'server';
  return 'other';
}

async function githubRequest(cfg, method, apiPath, body) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: 'Bearer ' + cfg.token,
  };
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    // cache: 'no-store'：GitHub の GET は60秒キャッシュされ、書いた直後に古い一覧が返るのを避ける
    res = await fetch(GITHUB_API + apiPath, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (e) {
    throw makeGithubError('network', 0, '通信できません');
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (res.ok) return { status: res.status, data };

  const message = data && typeof data.message === 'string' ? data.message : '';
  throw makeGithubError(classifyGithubStatus(res.status, res.headers, message), res.status, message);
}

function repoApiPath(cfg, suffix) {
  return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${suffix || ''}`;
}

function contentsApiPath(cfg, filePath) {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return repoApiPath(cfg, '/contents/' + encoded);
}

// リポジトリの情報（鍵がリポジトリに届くかの確認にも使う）
async function githubGetRepo(cfg) {
  const res = await githubRequest(cfg, 'GET', repoApiPath(cfg));
  return res.data;
}

// フォルダの一覧（type＝'file'：ファイル／'dir'：下のフォルダ）。フォルダがまだなければ空の配列
async function githubListDir(cfg, dirPath, type) {
  try {
    const res = await githubRequest(cfg, 'GET', contentsApiPath(cfg, dirPath));
    return Array.isArray(res.data) ? res.data.filter((x) => x.type === (type || 'file')).map((x) => ({ name: x.name, path: x.path, sha: x.sha })) : [];
  } catch (e) {
    if (e.kind === 'notfound') return [];
    throw e;
  }
}

// ファイルの中身（文字列）と sha。なければ null
async function githubGetFile(cfg, filePath) {
  try {
    const res = await githubRequest(cfg, 'GET', contentsApiPath(cfg, filePath));
    const d = res.data;
    if (!d || Array.isArray(d) || typeof d.content !== 'string') return null;
    return { text: base64ToUtf8(d.content), sha: d.sha };
  } catch (e) {
    if (e.kind === 'notfound') return null;
    throw e;
  }
}

// ファイルの作成・更新。更新のときは、いま置かれているファイルの sha が必要
async function githubPutFile(cfg, filePath, text, message, sha) {
  const body = { message, content: utf8ToBase64(text) };
  if (sha) body.sha = sha;
  const res = await githubRequest(cfg, 'PUT', contentsApiPath(cfg, filePath), body);
  return { sha: res.data && res.data.content ? res.data.content.sha : null };
}
