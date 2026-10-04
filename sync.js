// 保存の仕組み：非公開リポジトリとの送受信、送信待ち、鍵（トークン）の設定とロック。
// 画面は端末内の記録だけを読み書きし、ここが裏で GitHub と同期する（data.js・github.js を使う）。

const SYNC_CONFIG_KEY = 'study_sync_v1';
const SYNC_STATE_KEY = 'study_sync_state_v1';
const PULL_WINDOW_DAYS = 63; // 他の端末の記録を取り込む範囲（作成日から）。学習計画の期間と振り返りに使う
const PULL_INTERVAL_MS = 60 * 1000; // 取り込みの間隔（手動・登録直後を除く）
const PUT_RETRY_MAX = 3;
const FETCH_PARALLEL = 4;
const RECORD_FILE_PATTERN = /^(\d{8})-\d{6}-[a-z0-9]+\.json$/;
const PLAN_FILE_PATTERN = /^plan-\d{8}-\d{6}-[a-z0-9]+\.json$/;
const REVIEW_FILE_PATTERN = /^review-\d{8}\.json$/;

let syncSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// パソコンで開いたテスト用（localhost）。鍵なしで使え、どこにも送らない（公開ページではこうならない）
const LOCAL_TEST = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname || '');

// --- 鍵と接続先の設定（端末内） ---
function loadSyncConfig() {
  const c = readJson(SYNC_CONFIG_KEY, null);
  if (!c || typeof c.token !== 'string' || !c.token) return null;
  return {
    owner: c.owner || SYNC_DEFAULTS.owner,
    repo: c.repo || SYNC_DEFAULTS.repo,
    token: c.token,
    mode: c.mode === 'read' ? 'read' : 'write',
    authFailed: !!c.authFailed,
  };
}

function saveSyncConfig(cfg) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
}

function persistSyncState(patch) {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(Object.assign(readJson(SYNC_STATE_KEY, {}), patch)));
}

// 鍵がなければ、または使えなければロック（鍵の画面以外は開かない）。通信できないだけならロックしない
function getLockState() {
  if (LOCAL_TEST) return { locked: false, reason: null };
  const cfg = loadSyncConfig();
  if (!cfg) return { locked: true, reason: 'nokey' };
  if (cfg.authFailed) return { locked: true, reason: 'auth' };
  return { locked: false, reason: null };
}

function lockMessage(reason) {
  if (reason === 'auth') return '鍵が使えなくなりました（有効期限が切れたか、無効にされた可能性があります）。これまでの記録は端末に残っていて、新しい鍵を入れると送られます。お父さんに新しい鍵を入れてもらってください';
  return 'はじめに、鍵を入れてください';
}

// --- 鍵の入力チェック ---
function validateTokenInput(input) {
  const errors = {};
  const token = String(input.token || '').trim();
  if (!token) errors.token = '鍵が入力されていません';
  else if (/[^\x21-\x7e]/.test(token)) errors.token = '鍵に使えない文字（空白・全角など）が入っています。コピーし直してください';
  else if (!token.startsWith('github_pat_')) errors.token = 'この形の鍵は使えません（github_pat_ で始まる fine-grained の鍵を使ってください）';
  else if (token.length < 40) errors.token = '鍵が短すぎます。最後までコピーできていますか';

  if (input.mode !== 'write' && input.mode !== 'read') errors.mode = 'この端末の使い方を選んでください';
  return { ok: Object.keys(errors).length === 0, errors, token };
}

function syncErrorMessage(kind, mode, context) {
  switch (kind) {
    case 'auth':
      return '鍵が使えませんでした。入力の間違い、有効期限切れ、または無効にされた可能性があります。お父さんに新しい鍵を入れてもらってください';
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

function getSyncSummary() {
  const cfg = loadSyncConfig();
  const lock = getLockState();
  return {
    configured: !!cfg,
    localTest: LOCAL_TEST,
    locked: lock.locked,
    lockReason: lock.reason,
    mode: cfg ? cfg.mode : null,
    pending: pendingIds().length + pendingPlanIds().length + pendingReviewIds().length,
    running: syncState.running,
    error: syncState.error,
    notice: syncState.notice,
    lastSyncAt: readJson(SYNC_STATE_KEY, {}).lastSyncAt || null,
  };
}

// --- 鍵を入れて確認する／消す ---
async function connectWithToken(input) {
  if (LOCAL_TEST) return { ok: false, message: 'テスト用（このパソコン）では鍵を使いません' };
  const v = validateTokenInput(input);
  if (!v.ok) return { ok: false, errors: v.errors };
  const cfg = {
    owner: SYNC_DEFAULTS.owner,
    repo: SYNC_DEFAULTS.repo,
    token: v.token,
    mode: input.mode,
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

// 使い方（記録する／見るだけ）だけを変える。鍵は入れ直さない
function setSyncMode(mode) {
  const cfg = loadSyncConfig();
  if (!cfg || (mode !== 'write' && mode !== 'read')) return false;
  cfg.mode = mode;
  saveSyncConfig(cfg);
  notifySync();
  return true;
}

// 鍵を消す。送信済みの記録の控えも消す（GitHub 側には残る）。送信待ちの記録は端末に残す
function disconnectSync() {
  localStorage.removeItem(SYNC_CONFIG_KEY);
  localStorage.removeItem(SYNC_STATE_KEY);
  clearSyncedRecords();
  syncState.error = null;
  syncState.notice = '';
  syncState.lastPullAt = 0;
  rangePulledAt = {};
  recordMonths = [];
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

// 記録・計画・振り返りは同じ仕組みで送受信する
const DOC_KINDS = {
  record: { find: (id) => findRecord(id), apply: (d, p, sha) => applyRemoteRecord(d, p, sha), valid: (d) => isValidRecord(d), path: (d) => defaultRecordPath(d), pending: () => pendingIds(), done: (id) => clearPending(id), label: (d, sha) => (d.deleted ? '削除' : sha ? '修正' : '記録') },
  plan: { find: (id) => findPlan(id), apply: (d, p, sha) => applyRemotePlan(d, p, sha), valid: (d) => isValidPlan(d), path: (d) => defaultPlanPath(d), pending: () => pendingPlanIds(), done: (id) => clearPendingPlan(id), label: (d) => (d.deleted ? '計画の削除' : '計画') },
  review: { find: (id) => findReview(id), apply: (d, p, sha) => applyRemoteReview(d, p, sha), valid: (d) => isValidReview(d), path: (d) => defaultReviewPath(d), pending: () => pendingReviewIds(), done: (id) => clearPendingReview(id), label: () => 'がんばること' },
};

function parseDocText(kind, text, expectedId) {
  try {
    const r = JSON.parse(text);
    return DOC_KINDS[kind].valid(r) && r.id === expectedId ? r : null;
  } catch (e) {
    return null;
  }
}

// --- 送る ---
// 戻り値：'sent'（送れた・すでに同じ内容だった）／'adopted'（別の端末のほうが新しく、その内容にそろえた）
// 止めるべき失敗（通信・鍵・権限など）は例外で返す
async function sendDoc(cfg, kind, record) {
  const k = DOC_KINDS[kind];
  const meta = getMeta(record.id);
  const path = meta.path || k.path(record);
  const text = serializeRecord(record);
  let sha = meta.sha || null;

  for (let attempt = 0; attempt < PUT_RETRY_MAX; attempt++) {
    const label = k.label(record, sha);
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
      const remoteRecord = parseDocText(kind, remote.text, record.id);
      if (remoteRecord && stamp(remoteRecord.updatedAt) > stamp(record.updatedAt)) {
        k.apply(remoteRecord, path, remote.sha);
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
  for (const kind of ['record', 'plan', 'review']) {
    const k = DOC_KINDS[kind];
    for (const id of k.pending()) {
      const record = k.find(id);
      if (!record) {
        k.done(id);
        continue;
      }
      const outcome = await sendDoc(cfg, kind, record);
      if (outcome === 'adopted') {
        k.done(id);
        result.adopted++;
      } else {
        const current = k.find(id);
        if (current && current.updatedAt === record.updatedAt) k.done(id); // 送信中に直された場合は待ちに残す
        result.sent++;
      }
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

function monthsBetween(from, to) {
  const months = [];
  let m = from.slice(0, 7);
  while (m <= to.slice(0, 7)) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${pad2(mo + 1)}`;
  }
  return months;
}

// 月のフォルダの一覧と比べて、取りに行く記録を選ぶ。fromKey があれば、それより前に作った記録は除く
async function listRecordTargets(cfg, months, fromKey) {
  const pending = pendingIds();
  const targets = [];
  for (const month of months) {
    const entries = await githubListDir(cfg, `records/${month}`);
    entries.forEach((entry) => {
      const m = RECORD_FILE_PATTERN.exec(entry.name);
      if (!m || (fromKey && m[1] < fromKey)) return;
      const id = entry.name.slice(0, -'.json'.length);
      if (pending.includes(id)) return; // 端末側の変更が送信待ち。送るときに新旧を比べる
      if (findRecord(id) && getMeta(id).sha === entry.sha) return; // 変わっていない
      targets.push({ id, path: entry.path, kind: 'record' });
    });
  }
  return targets;
}

// 計画・振り返りは数が少ないので、すべて見る
async function listDocTargets(cfg, kind, dir, pattern) {
  const k = DOC_KINDS[kind];
  const pending = k.pending();
  const targets = [];
  (await githubListDir(cfg, dir)).forEach((entry) => {
    if (!pattern.test(entry.name)) return;
    const id = entry.name.slice(0, -'.json'.length);
    if (pending.includes(id)) return;
    if (k.find(id) && getMeta(id).sha === entry.sha) return;
    targets.push({ id, path: entry.path, kind });
  });
  return targets;
}

async function fetchTargets(cfg, targets) {
  const result = { fetched: 0, invalid: 0 };
  await mapLimit(targets, FETCH_PARALLEL, async (t) => {
    const k = DOC_KINDS[t.kind];
    const file = await githubGetFile(cfg, t.path);
    if (!file) return;
    const remote = parseDocText(t.kind, file.text, t.id);
    if (!remote) {
      result.invalid++;
      return;
    }
    const local = k.find(t.id);
    if (!local || stamp(remote.updatedAt) > stamp(local.updatedAt)) {
      k.apply(remote, t.path, file.sha);
      result.fetched++;
    } else {
      setMeta(t.id, { path: t.path, sha: file.sha });
    }
  });
  return result;
}

async function doPull(cfg) {
  await githubGetRepo(cfg); // 鍵・保存先が正しいかを先に確かめる（401・404 をここで見つける）

  const todayStr = formatDate(new Date());
  const cutoff = shiftDate(todayStr, -PULL_WINDOW_DAYS);
  const targets = (await listRecordTargets(cfg, monthsBetween(cutoff, todayStr), cutoff.replace(/-/g, '')))
    .concat(await listDocTargets(cfg, 'plan', 'plans', PLAN_FILE_PATTERN))
    .concat(await listDocTargets(cfg, 'review', 'reviews', REVIEW_FILE_PATTERN));
  return fetchTargets(cfg, targets);
}

// --- 期間を指定して取り込む（取り込み範囲より前の記録。振り返り・学習計画の結果で使う） ---
let rangePulledAt = {}; // 月 → 最後に一覧を見た時刻
let recordMonths = []; // 保存先にある月のフォルダ（古い順）

// from〜to の月のフォルダを取る。戻り値の failed は、取れなかった（端末にある記録で表示する）
async function pullRange(from, to) {
  const result = { fetched: 0, failed: false };
  const cfg = loadSyncConfig();
  if (LOCAL_TEST || !cfg || getLockState().locked) return result;
  const todayStr = formatDate(new Date());
  if (from >= shiftDate(todayStr, -PULL_WINDOW_DAYS)) return result; // ふだんの取り込みの範囲
  const months = monthsBetween(from, to < todayStr ? to : todayStr).filter((m) => Date.now() - (rangePulledAt[m] || 0) >= PULL_INTERVAL_MS);
  if (!months.length) return result;
  try {
    result.fetched = (await fetchTargets(cfg, await listRecordTargets(cfg, months, null))).fetched;
    months.forEach((m) => (rangePulledAt[m] = Date.now()));
  } catch (e) {
    result.failed = true;
  }
  return result;
}

// 保存先にある月を調べる（振り返りでさかのぼれる範囲に使う）。変わったら true
async function loadRecordMonths() {
  const cfg = loadSyncConfig();
  if (LOCAL_TEST || !cfg || getLockState().locked) return false;
  try {
    const months = (await githubListDir(cfg, 'records', 'dir')).map((x) => x.name).filter((n) => /^\d{4}-\d{2}$/.test(n)).sort();
    const changed = months.join() !== recordMonths.join();
    recordMonths = months;
    return changed;
  } catch (e) {
    return false;
  }
}

// --- 送って・取り込む ---
let syncPromise = null;

let syncAgain = false; // 同期中に force で頼まれた（終わってからもう一度行う）

// force：取り込みの間隔（60秒）を無視する（起動時・登録直後・手動）
function syncNow(opts) {
  if (syncPromise) {
    if (opts && opts.force) syncAgain = true;
    return syncPromise;
  }
  syncPromise = doSync(opts || {}).finally(() => {
    syncPromise = null;
    if (syncAgain) {
      syncAgain = false;
      syncNow({ force: true }).catch(() => {});
    }
  });
  return syncPromise;
}

async function doSync(opts) {
  if (LOCAL_TEST) return getSyncSummary();
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
