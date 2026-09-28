// 保存の仕組み：非公開リポジトリとの送受信、送信待ち、鍵（トークン）の設定とロック。
// 画面は端末内の記録だけを読み書きし、ここが裏で GitHub と同期する（data.js・github.js を使う）。

const SYNC_CONFIG_KEY = 'study_sync_v1';
const SYNC_STATE_KEY = 'study_sync_state_v1';
const PULL_WINDOW_DAYS = 28; // 他の端末の記録を取り込む範囲（作成日から）
const PULL_INTERVAL_MS = 60 * 1000; // 取り込みの間隔（手動・登録直後を除く）
const EXPIRY_WARN_DAYS = 14;
const PUT_RETRY_MAX = 3;
const FETCH_PARALLEL = 4;
const RECORD_FILE_PATTERN = /^(\d{8})-\d{6}-[a-z0-9]+\.json$/;

let syncSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- 鍵と接続先の設定（端末内） ---
function loadSyncConfig() {
  const c = readJson(SYNC_CONFIG_KEY, null);
  if (!c || typeof c.token !== 'string' || !c.token) return null;
  return {
    owner: c.owner || SYNC_DEFAULTS.owner,
    repo: c.repo || SYNC_DEFAULTS.repo,
    token: c.token,
    mode: c.mode === 'read' ? 'read' : 'write',
    expiresOn: c.expiresOn || null,
    authFailed: !!c.authFailed,
  };
}

function saveSyncConfig(cfg) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
}

function persistSyncState(patch) {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(Object.assign(readJson(SYNC_STATE_KEY, {}), patch)));
}

function daysBetween(fromStr, toStr) {
  return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
}

// 鍵がなければ、または使えなければロック（鍵の画面以外は開かない）。通信できないだけならロックしない
function getLockState(today = formatDate(new Date())) {
  const cfg = loadSyncConfig();
  if (!cfg) return { locked: true, reason: 'nokey' };
  if (cfg.authFailed) return { locked: true, reason: 'auth' };
  if (cfg.expiresOn && today > cfg.expiresOn) return { locked: true, reason: 'expired' };
  return { locked: false, reason: null };
}

function lockMessage(reason) {
  if (reason === 'auth') return '鍵が使えません（正しくないか、期限切れ・無効になっています）。お父さんに新しい鍵を入れてもらってください';
  if (reason === 'expired') return '鍵の期限が切れています。お父さんに新しい鍵を入れてもらってください';
  return 'はじめに、鍵を入れてください';
}

// 鍵の期限まで何日か（設定なしは null）
function expiryDaysLeft(today = formatDate(new Date())) {
  const cfg = loadSyncConfig();
  return cfg && cfg.expiresOn ? daysBetween(today, cfg.expiresOn) : null;
}

// --- 鍵の入力チェック ---
function validateTokenInput(input, today = formatDate(new Date())) {
  const errors = {};
  const token = String(input.token || '').trim();
  if (!token) errors.token = '鍵が入力されていません';
  else if (/[^\x21-\x7e]/.test(token)) errors.token = '鍵に使えない文字（空白・全角など）が入っています。コピーし直してください';
  else if (!token.startsWith('github_pat_')) errors.token = 'この形の鍵は使えません（github_pat_ で始まる fine-grained の鍵を使ってください）';
  else if (token.length < 40) errors.token = '鍵が短すぎます。最後までコピーできていますか';

  const exp = String(input.expiresOn || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || formatDate(parseDate(exp)) !== exp) errors.expiresOn = '鍵の有効期限の日付を入れてください';
  else if (exp < today) errors.expiresOn = '有効期限が過ぎています。新しい鍵を作ってください';

  if (input.mode !== 'write' && input.mode !== 'read') errors.mode = 'この端末の使い方を選んでください';
  return { ok: Object.keys(errors).length === 0, errors, token };
}

function syncErrorMessage(kind, mode, context) {
  switch (kind) {
    case 'auth':
      return '鍵が正しくないか、期限が切れています。お父さんに新しい鍵を入れてもらってください';
    case 'forbidden':
      return mode === 'read' ? '鍵の権限が足りません（読み取りの権限が必要です）' : 'この鍵には書き込みの権限がありません（「見るだけ」の鍵では記録できません）';
    case 'ratelimit':
      return 'しばらくしてから、もう一度試してください';
    case 'notfound':
      return '保存先が見つかりません（鍵の対象リポジトリと、リポジトリ名を確認してください）';
    case 'network':
      return context === 'connect' ? 'つながりません。通信できる場所で、もう一度押してください' : 'つながりません。あとで自動で送り直します';
    case 'server':
      return 'GitHub が混み合っています。あとで自動で送り直します';
    case 'conflict':
      return '別の端末と同時に書き込みました。あとで自動で送り直します';
    default:
      return '保存でエラーが出ました。あとでもう一度試します';
  }
}

// --- 状態（画面が読む） ---
const syncState = { running: false, error: null, notice: '', lastPullAt: 0 };
const syncListeners = [];

function onSyncChange(fn) {
  syncListeners.push(fn);
}

function notifySync() {
  const summary = getSyncSummary();
  syncListeners.forEach((fn) => {
    try {
      fn(summary);
    } catch (e) {
      // 画面側の失敗で同期を止めない
    }
  });
}

function getSyncSummary(today = formatDate(new Date())) {
  const cfg = loadSyncConfig();
  const lock = getLockState(today);
  const daysLeft = expiryDaysLeft(today);
  return {
    configured: !!cfg,
    locked: lock.locked,
    lockReason: lock.reason,
    mode: cfg ? cfg.mode : null,
    pending: pendingIds().length,
    running: syncState.running,
    error: syncState.error,
    notice: syncState.notice,
    lastSyncAt: readJson(SYNC_STATE_KEY, {}).lastSyncAt || null,
    expiresOn: cfg ? cfg.expiresOn : null,
    expiryDaysLeft: daysLeft,
    expiryWarn: daysLeft !== null && daysLeft >= 0 && daysLeft <= EXPIRY_WARN_DAYS,
  };
}

// --- 鍵を入れて確認する／消す ---
async function connectWithToken(input) {
  const v = validateTokenInput(input);
  if (!v.ok) return { ok: false, errors: v.errors };
  const cfg = {
    owner: SYNC_DEFAULTS.owner,
    repo: SYNC_DEFAULTS.repo,
    token: v.token,
    mode: input.mode,
    expiresOn: input.expiresOn,
    authFailed: false,
  };
  try {
    const repo = await githubGetRepo(cfg);
    if (cfg.mode === 'write' && repo && repo.permissions && repo.permissions.push === false) {
      return { ok: false, message: 'この鍵には書き込みの権限がありません。「見るだけ」の鍵ではありませんか？' };
    }
  } catch (e) {
    return { ok: false, message: syncErrorMessage(e.kind || 'other', cfg.mode, 'connect') };
  }
  saveSyncConfig(cfg);
  syncState.error = null;
  notifySync();
  return { ok: true };
}

// 鍵を消す。送信済みの記録の控えも消す（GitHub 側には残る）。送信待ちの記録は端末に残す
function disconnectSync() {
  localStorage.removeItem(SYNC_CONFIG_KEY);
  localStorage.removeItem(SYNC_STATE_KEY);
  clearSyncedRecords();
  syncState.error = null;
  syncState.notice = '';
  syncState.lastPullAt = 0;
  notifySync();
}

// --- 記録ファイル ---
function stamp(s) {
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

function serializeRecord(record) {
  return JSON.stringify(record, null, 2) + '\n';
}

function parseRecordText(text, expectedId) {
  try {
    const r = JSON.parse(text);
    return isValidRecord(r) && r.id === expectedId ? r : null;
  } catch (e) {
    return null;
  }
}

// --- 送る ---
// 戻り値：'sent'（送れた・すでに同じ内容だった）／'adopted'（別の端末のほうが新しく、その内容にそろえた）
// 止めるべき失敗（通信・鍵・権限など）は例外で返す
async function sendRecord(cfg, record) {
  const meta = getMeta(record.id);
  const path = meta.path || defaultRecordPath(record);
  const text = serializeRecord(record);
  let sha = meta.sha || null;

  for (let attempt = 0; attempt < PUT_RETRY_MAX; attempt++) {
    const label = record.deleted ? '削除' : sha ? '修正' : '記録';
    try {
      const res = await githubPutFile(cfg, path, text, `${label} ${record.id}`, sha);
      setMeta(record.id, { path, sha: res.sha });
      return 'sent';
    } catch (e) {
      if (e.kind !== 'conflict') throw e;
      // 同時に書かれた／sha が古い／すでにファイルがある：いまの状態を見て決める
      const remote = await githubGetFile(cfg, path);
      if (!remote) {
        sha = null; // ファイルはまだない。ブランチが同時に更新されただけなので、少し待ってやり直す
        await syncSleep(1200 * (attempt + 1));
        continue;
      }
      const remoteRecord = parseRecordText(remote.text, record.id);
      if (remoteRecord && stamp(remoteRecord.updatedAt) > stamp(record.updatedAt)) {
        applyRemoteRecord(remoteRecord, path, remote.sha);
        return 'adopted';
      }
      if (remote.text === text) {
        setMeta(record.id, { path, sha: remote.sha }); // 返事が届かなかっただけで、送信は通っていた
        return 'sent';
      }
      const wait = remote.sha === sha ? 1200 * (attempt + 1) : 0;
      sha = remote.sha;
      if (wait) await syncSleep(wait);
    }
  }
  throw makeGithubError('conflict', 409, '同時に書き込まれました');
}

let flushPromise = null;

function flush() {
  if (!flushPromise) {
    flushPromise = doFlush().finally(() => {
      flushPromise = null;
    });
  }
  return flushPromise;
}

async function doFlush() {
  const result = { sent: 0, adopted: 0 };
  const cfg = loadSyncConfig();
  if (!cfg || cfg.mode === 'read' || getLockState().locked) return result;
  for (const id of pendingIds()) {
    const record = findRecord(id);
    if (!record) {
      clearPending(id);
      continue;
    }
    const outcome = await sendRecord(cfg, record);
    if (outcome === 'adopted') {
      clearPending(id);
      result.adopted++;
    } else {
      const current = findRecord(id);
      if (current && current.updatedAt === record.updatedAt) clearPending(id); // 送信中に直された場合は待ちに残す
      result.sent++;
    }
  }
  return result;
}

// --- 取り込む ---
async function mapLimit(items, limit, fn) {
  let next = 0;
  let firstError = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !firstError) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (e) {
        if (!firstError) firstError = e;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
}

async function doPull(cfg) {
  await githubGetRepo(cfg); // 鍵・保存先が正しいかを先に確かめる（401・404 をここで見つける）

  const todayStr = formatDate(new Date());
  const cutoff = shiftDate(todayStr, -PULL_WINDOW_DAYS);
  const cutoffKey = cutoff.replace(/-/g, '');
  const months = [];
  for (let d = cutoff; d <= todayStr; d = shiftDate(d, 1)) {
    const m = d.slice(0, 7);
    if (!months.includes(m)) months.push(m);
  }

  const pending = pendingIds();
  const targets = [];
  for (const month of months) {
    const entries = await githubListDir(cfg, `records/${month}`);
    entries.forEach((entry) => {
      const m = RECORD_FILE_PATTERN.exec(entry.name);
      if (!m || m[1] < cutoffKey) return;
      const id = entry.name.slice(0, -'.json'.length);
      if (pending.includes(id)) return; // 端末側の変更が送信待ち。送るときに新旧を比べる
      if (findRecord(id) && getMeta(id).sha === entry.sha) return; // 変わっていない
      targets.push({ id, path: entry.path, listedSha: entry.sha });
    });
  }

  const result = { fetched: 0, invalid: 0 };
  await mapLimit(targets, FETCH_PARALLEL, async (t) => {
    const file = await githubGetFile(cfg, t.path);
    if (!file) return;
    const remote = parseRecordText(file.text, t.id);
    if (!remote) {
      result.invalid++;
      return;
    }
    const local = findRecord(t.id);
    if (!local || stamp(remote.updatedAt) > stamp(local.updatedAt)) {
      applyRemoteRecord(remote, t.path, file.sha);
      result.fetched++;
    } else {
      setMeta(t.id, { path: t.path, sha: file.sha });
    }
  });
  return result;
}

// --- 送って・取り込む ---
let syncPromise = null;

// force：取り込みの間隔（60秒）を無視する（起動時・登録直後・手動）
function syncNow(opts) {
  if (!syncPromise) {
    syncPromise = doSync(opts || {}).finally(() => {
      syncPromise = null;
    });
  }
  return syncPromise;
}

async function doSync(opts) {
  const cfg = loadSyncConfig();
  if (!cfg || getLockState().locked) return getSyncSummary();

  syncState.running = true;
  syncState.notice = '';
  notifySync();
  try {
    const sent = await flush();
    if (sent.adopted) syncState.notice = '別の端末で先に直されていた記録があり、その内容にそろえました';
    if (opts.force || sent.sent || Date.now() - syncState.lastPullAt >= PULL_INTERVAL_MS) {
      await doPull(cfg);
      syncState.lastPullAt = Date.now();
    }
    syncState.error = null;
    persistSyncState({ lastSyncAt: localIso() });
  } catch (e) {
    const kind = e && e.kind ? e.kind : 'other';
    if (kind === 'auth') saveSyncConfig(Object.assign({}, cfg, { authFailed: true }));
    syncState.error = { kind, message: syncErrorMessage(kind, cfg.mode) };
  } finally {
    syncState.running = false;
    notifySync();
  }
  return getSyncSummary();
}
