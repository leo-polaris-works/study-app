// 記録の保存と集計。画面は端末内（localStorage）の記録だけを読み書きし、GitHub との送受信は sync.js が行う。
// 形式は 記録設計/02_記録データの形式.md

const RECORDS_KEY = 'study_records_v6';
const OLD_MOCK_RECORDS_KEY = 'study_mock_records_v5';
const META_KEY = 'study_sync_meta_v1'; // 記録ごとの保存先パスと sha の控え
const OUTBOX_KEY = 'study_outbox_v1'; // 送信待ちの記録ID
const DEVICE_KEY = 'study_device_v1';
const SCHEMA_VERSION = 1;
const SAMPLE_PREFIX = 'sample-';

// モック段階の記録は引き継がない
try {
  localStorage.removeItem(OLD_MOCK_RECORDS_KEY);
} catch (e) {
  // localStorage が使えなければ何もしない
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ローカル日付の YYYY-MM-DD（UTC にずれないよう toISOString は使わない）
function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shiftDate(str, days) {
  const d = parseDate(str);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

// タイムゾーンつきのローカル日時（例：2026-09-28T19:30:45+09:00）
function localIso(d = new Date()) {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${formatDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function displayDate(str) {
  const d = parseDate(str);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

// --- 端末の識別 ---
function detectDeviceKind() {
  if (typeof navigator === 'undefined') return 'PC';
  const ua = navigator.userAgent || '';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  return 'PC';
}

function getDevice() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY));
    if (saved && saved.id) return saved;
  } catch (e) {
    // 壊れていれば作り直す
  }
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  const device = { id, kind: detectDeviceKind() };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  return device;
}

// 記録ID：作成日時（ローカル）＋端末ID。ファイル名になり、並べると時系列になる
function makeRecordId(d = new Date()) {
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `${stamp}-${getDevice().id}`;
}

// --- 記録の読み書き（削除は deleted: true の印をつけるだけで、データは残す） ---
function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function writeRecords(records) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

function loadActiveRecords() {
  return loadRecords().filter((r) => !r.deleted);
}

function saveRecord(record) {
  const records = loadRecords();
  records.push(record);
  writeRecords(records);
  markPending(record);
}

function updateRecord(record) {
  const records = loadRecords();
  const i = records.findIndex((r) => r.id === record.id);
  if (i >= 0) records[i] = record;
  else records.push(record);
  writeRecords(records);
  markPending(record);
}

function markRecordDeleted(id) {
  const records = loadRecords();
  const r = records.find((x) => x.id === id);
  if (!r) return;
  r.deleted = true;
  r.updatedAt = localIso();
  writeRecords(records);
  markPending(r);
}

// --- 送信の控え（保存先パス・sha・送信待ち） ---
function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function isSampleId(id) {
  return String(id).startsWith(SAMPLE_PREFIX);
}

// 保存先：最初に登録したときの勉強日の月で固定する（あとで日付を直しても動かさない）
function defaultRecordPath(record) {
  return `records/${record.date.slice(0, 7)}/${record.id}.json`;
}

function getMeta(id) {
  return readJson(META_KEY, {})[id] || {};
}

function setMeta(id, patch) {
  const all = readJson(META_KEY, {});
  all[id] = Object.assign({}, all[id], patch);
  localStorage.setItem(META_KEY, JSON.stringify(all));
}

function pendingIds() {
  const list = readJson(OUTBOX_KEY, []);
  return Array.isArray(list) ? list : [];
}

// 送信待ちに登録する（サンプルは送らない）。保存先パスは最初の1回だけ決める
function markPending(record) {
  if (isSampleId(record.id)) return;
  if (!getMeta(record.id).path) setMeta(record.id, { path: defaultRecordPath(record) });
  const ids = pendingIds();
  if (!ids.includes(record.id)) ids.push(record.id);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(ids));
}

function clearPending(id) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(pendingIds().filter((x) => x !== id)));
}

// 記録の形の確認（他の端末から取り込む JSON は、画面に出す前に必ず通す）
function isValidRecord(r) {
  const isStr = (v) => typeof v === 'string';
  const hasLabel = (x) => x && typeof x === 'object' && isStr(x.label);
  if (!r || typeof r !== 'object') return false;
  if (!isStr(r.id) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false;
  if (typeof r.schemaVersion !== 'number' || typeof r.totalMinutes !== 'number') return false;
  if (!SUBJECTS.includes(r.subject) || !hasLabel(r.activity)) return false;
  if (r.timeBand !== null && !hasLabel(r.timeBand)) return false;
  if (!Array.isArray(r.fields) || !r.fields.every((f) => hasLabel(f) && typeof f.minutes === 'number')) return false;
  if (!Array.isArray(r.materials) || !r.materials.every(hasLabel)) return false;
  if (!Array.isArray(r.issues) || !r.issues.every(hasLabel)) return false;
  if (r.accuracy !== null && !(r.accuracy && typeof r.accuracy.level === 'number' && isStr(r.accuracy.label))) return false;
  if (!r.device || !isStr(r.device.id) || !isStr(r.device.kind)) return false;
  if (!isStr(r.createdAt) || !isStr(r.updatedAt) || typeof r.deleted !== 'boolean') return false;
  // わからなかったところ（なくてもよい）
  if (r.unclear !== undefined && !(r.unclear && isStr(r.unclear.text) && (r.unclear.resolvedAt === null || isStr(r.unclear.resolvedAt)))) return false;
  return true;
}

// 他の端末から取り込んだ記録を反映する（送信待ちには入れない）
function applyRemoteRecord(record, path, sha) {
  const records = loadRecords();
  const i = records.findIndex((r) => r.id === record.id);
  if (i >= 0) records[i] = record;
  else records.push(record);
  writeRecords(records);
  setMeta(record.id, { path, sha });
}

// 送信済みの記録・計画の控えを消す（鍵を消すとき）。送信待ちは残す
function clearSyncedRecords() {
  const pending = pendingIds().concat(pendingPlanIds());
  writeRecords(loadRecords().filter((r) => pending.includes(r.id)));
  writePlans(loadPlans().filter((p) => pending.includes(p.id)));
  const meta = readJson(META_KEY, {});
  Object.keys(meta).forEach((id) => {
    if (!pending.includes(id)) delete meta[id];
  });
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// --- 学習計画（1計画＝1ファイル。記録と同じく端末内が先で、送信は sync.js） ---
const PLANS_KEY = 'study_plans_v1';
const PLAN_OUTBOX_KEY = 'study_plan_outbox_v1';
const PLAN_PREFIX = 'plan-';

function loadPlans() {
  const list = readJson(PLANS_KEY, []);
  return Array.isArray(list) ? list : [];
}

function writePlans(plans) {
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

function loadActivePlans() {
  return loadPlans()
    .filter((p) => !p.deleted)
    .sort((a, b) => (a.testDate < b.testDate ? 1 : a.testDate > b.testDate ? -1 : 0));
}

function findPlan(id) {
  return loadPlans().find((p) => p.id === id) || null;
}

function defaultPlanPath(plan) {
  return `plans/${plan.id}.json`;
}

function pendingPlanIds() {
  const list = readJson(PLAN_OUTBOX_KEY, []);
  return Array.isArray(list) ? list : [];
}

function markPlanPending(plan) {
  if (plan.id === SAMPLE_PLAN_ID) return; // サンプルの計画は送らない
  if (!getMeta(plan.id).path) setMeta(plan.id, { path: defaultPlanPath(plan) });
  const ids = pendingPlanIds();
  if (!ids.includes(plan.id)) ids.push(plan.id);
  localStorage.setItem(PLAN_OUTBOX_KEY, JSON.stringify(ids));
}

function clearPendingPlan(id) {
  localStorage.setItem(PLAN_OUTBOX_KEY, JSON.stringify(pendingPlanIds().filter((x) => x !== id)));
}

function putPlan(plan) {
  const plans = loadPlans();
  const i = plans.findIndex((p) => p.id === plan.id);
  if (i >= 0) plans[i] = plan;
  else plans.push(plan);
  writePlans(plans);
}

function savePlan(plan) {
  plan.updatedAt = localIso();
  putPlan(plan);
  markPlanPending(plan);
}

function markPlanDeleted(id) {
  const plan = findPlan(id);
  if (!plan) return;
  plan.deleted = true;
  savePlan(plan);
}

function applyRemotePlan(plan, path, sha) {
  putPlan(plan);
  setMeta(plan.id, { path, sha });
}

// 新しい計画。1周目の正答率の見込みは、前の計画があればそこから写す
function newPlan(today = formatDate(new Date())) {
  const prev = loadActivePlans()[0];
  const now = localIso();
  const testDate = shiftDate(today, 28);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: PLAN_PREFIX + makeRecordId(),
    name: '',
    testDate,
    startDate: today,
    items: [],
    months: defaultPlanMonths(today, testDate),
    firstAccuracy: prev ? prev.firstAccuracy : PLAN_DEFAULTS.firstAccuracy,
    device: getDevice(),
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
}

// 計画の形の確認（他の端末から取り込む JSON は必ず通す）
function isValidPlan(p) {
  const isStr = (v) => typeof v === 'string';
  const isDate = (v) => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isMark = (m) => m && isNum(m.lap) && isDate(m.date) && (m.nextAmount === null || isNum(m.nextAmount));
  const isItem = (it) =>
    it && isStr(it.materialId) && SUBJECTS.includes(it.subject) && isStr(it.label) && isStr(it.unit) && isNum(it.amount) && isNum(it.laps) && (it.lapMarks === undefined || (Array.isArray(it.lapMarks) && it.lapMarks.every(isMark)));
  if (!p || typeof p !== 'object' || !isStr(p.id) || !p.id.startsWith(PLAN_PREFIX)) return false;
  if (!isNum(p.schemaVersion) || !isStr(p.name) || !isDate(p.testDate) || !isDate(p.startDate)) return false;
  if (!Array.isArray(p.items) || !p.items.every(isItem)) return false;
  if (!Array.isArray(p.months) || !p.months.every((m) => m && isStr(m.month) && /^\d{4}-\d{2}$/.test(m.month) && isNum(m.percent))) return false;
  if (!isNum(p.firstAccuracy)) return false;
  if (!isStr(p.createdAt) || !isStr(p.updatedAt) || typeof p.deleted !== 'boolean') return false;
  return true;
}

function findRecord(id) {
  return loadRecords().find((r) => r.id === id) || null;
}

// 直近 days 日の記録（削除済みを除く。新しい順）
function recentRecords(days = 14) {
  const from = shiftDate(formatDate(new Date()), -(days - 1));
  return loadActiveRecords()
    .filter((r) => r.date >= from)
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
}

// --- 集計（TOP の今週表示など） ---
// 今週の月曜の日付（週の集計の起点）
function startOfWeekStr(date = new Date()) {
  const d = new Date(date);
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

function thisWeekRecords() {
  const start = startOfWeekStr();
  return loadActiveRecords().filter((r) => r.date >= start);
}

function weekSummary() {
  const records = thisWeekRecords();
  const bySubject = {};
  SUBJECTS.forEach((s) => (bySubject[s] = 0));
  const days = new Set();
  let total = 0;
  records.forEach((r) => {
    total += r.totalMinutes || 0;
    days.add(r.date);
    if (bySubject[r.subject] !== undefined) bySubject[r.subject] += r.totalMinutes || 0;
  });
  return { totalMinutes: total, dayCount: days.size, bySubject };
}

function dayTotalMinutes(dateStr) {
  return loadActiveRecords()
    .filter((r) => r.date === dateStr)
    .reduce((sum, r) => sum + (r.totalMinutes || 0), 0);
}

function formatMinutes(min) {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

// テスト・実機確認用のサンプルデータ（本番運用では使わない）。2週間分の記録と、端末内だけの計画（送らない）
const SAMPLE_PLAN_ID = PLAN_PREFIX + SAMPLE_PREFIX + '0';

function seedSampleData() {
  const today = formatDate(new Date());
  const device = getDevice();
  const acc = (level) => ACCURACY_LEVELS.find((a) => a.level === level);
  const rows = [
    { d: 0, band: ['tb-night', '夜'], subject: '理科', activity: ['a-test', 'テスト対策'], minutes: 25, fields: [['f-sc-chem', '化学', 15], ['f-sc-bio', '生物', 10]], materials: [['m-sc-work', 'ワーク', 5, 'ページ'], ['m-sc-redo', '解き直し', 8, '問題']], accuracy: acc(3), issues: [['i-nounder', 'そもそも分からない'], ['i-forgot', '前のを忘れた']], unclear: 'ワーク p.12 問4、化学反応式の係数の決め方' },
    { d: 0, band: ['tb-evening', '夕方'], subject: '数学', activity: ['a-hw', '宿題・提出物'], minutes: 50, fields: [['f-ma-calc', '計算', 20], ['f-ma-word', '文章題', 30]], materials: [['m-ma-hw', '宿題', 6, 'ページ']], accuracy: acc(4), issues: [] },
    { d: -1, band: ['tb-morning', '朝'], subject: '英語', activity: ['a-review-week', '復習（今週の授業）'], minutes: 15, fields: [['f-en-word', '単語・熟語', 15]], materials: [['m-en-word', '単語', 30, '語']], accuracy: null, issues: [] },
    { d: -1, band: ['tb-night', '夜'], subject: '数学', activity: ['a-review-week', '復習（今週の授業）'], minutes: 40, fields: [['f-ma-figure', '図形', 40]], materials: [['m-ma-work', 'ワーク', 4, 'ページ']], accuracy: acc(2), issues: [['i-again', 'また間違えた']] },
    { d: -2, band: ['tb-night', '夜'], subject: '理科', activity: ['a-review-past', '復習（先週以前）'], minutes: 30, fields: [['f-sc-chem', '化学', 30]], materials: [['m-sc-work', 'ワーク', 3, 'ページ']], accuracy: acc(3), issues: [['i-before', '前の内容があやしい']], unclear: '化学変化と質量の計算', resolved: -1 },
    { d: -3, band: ['tb-morning', '朝'], subject: '英語', activity: ['a-review-week', '復習（今週の授業）'], minutes: 15, fields: [['f-en-word', '単語・熟語', 15]], materials: [['m-en-word', '単語', 30, '語']], accuracy: null, issues: [] },
    { d: -4, band: ['tb-night', '夜'], subject: '数学', activity: ['a-hw', '宿題・提出物'], minutes: 45, fields: [['f-ma-figure', '図形', 45]], materials: [['m-ma-hw', '宿題', 4, 'ページ']], accuracy: acc(2), issues: [['i-again', 'また間違えた']] },
    { d: -6, band: ['tb-evening', '夕方'], subject: '国語', activity: ['a-hw', '宿題・提出物'], minutes: 30, fields: [['f-jp-kanji', '漢字', 30]], materials: [['m-jp-kanji', '漢字', 50, '字']], accuracy: acc(4), issues: [] },
    { d: -8, band: ['tb-night', '夜'], subject: '数学', activity: ['a-test', 'テスト対策'], minutes: 40, fields: [['f-ma-figure', '図形', 40]], materials: [['m-ma-redo', '解き直し', 10, '問題']], accuracy: acc(2), issues: [] },
    { d: -9, band: ['tb-night', '夜'], subject: '英語', activity: ['a-hw', '宿題・提出物'], minutes: 30, fields: [['f-en-grammar', '文法', 30]], materials: [['m-en-hw', '宿題', 3, 'ページ']], accuracy: acc(3), issues: [] },
    { d: -10, band: ['tb-night', '夜'], subject: '理科', activity: ['a-test', 'テスト対策'], minutes: 40, fields: [['f-sc-chem', '化学', 40]], materials: [['m-sc-work', 'ワーク', 4, 'ページ']], accuracy: acc(3), issues: [] },
    { d: -12, band: ['tb-evening', '夕方'], subject: '英語', activity: ['a-review-past', '復習（先週以前）'], minutes: 20, fields: [['f-en-word', '単語・熟語', 20]], materials: [['m-en-word', '単語', 40, '語']], accuracy: acc(4), issues: [] },
  ];
  const records = loadRecords();
  rows.forEach((r, i) => {
    const now = localIso();
    records.push({
      schemaVersion: SCHEMA_VERSION,
      id: SAMPLE_PREFIX + i,
      date: shiftDate(today, r.d),
      timeBand: { id: r.band[0], label: r.band[1] },
      totalMinutes: r.minutes,
      subject: r.subject,
      activity: { id: r.activity[0], label: r.activity[1] },
      fields: r.fields.map((f) => ({ id: f[0], label: f[1], minutes: f[2] })),
      materials: r.materials.map((m) => ({ id: m[0], label: m[1], amount: { value: m[2], unit: m[3] } })),
      accuracy: r.accuracy || null,
      issues: r.issues.map((x) => ({ id: x[0], label: x[1] })),
      ...(r.unclear ? { unclear: { text: r.unclear, resolvedAt: r.resolved === undefined ? null : shiftDate(today, r.resolved) } } : {}),
      device,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });
  });
  writeRecords(records);

  // 計画は端末内に置くだけ（送信待ちに入れない）
  const start = shiftDate(today, -14);
  const testDate = shiftDate(today, 28);
  const now = localIso();
  putPlan({
    schemaVersion: SCHEMA_VERSION,
    id: SAMPLE_PLAN_ID,
    name: 'サンプルのテスト',
    testDate,
    startDate: start,
    items: [
      { materialId: 'm-sc-work', subject: '理科', label: 'ワーク', unit: 'ページ', amount: 60, laps: 3, lapMarks: [] },
      { materialId: 'm-en-word', subject: '英語', label: '単語', unit: '語', amount: 120, laps: 3, lapMarks: [] },
      { materialId: 'm-ma-work', subject: '数学', label: 'ワーク', unit: 'ページ', amount: 40, laps: 3, lapMarks: [] },
    ],
    months: defaultPlanMonths(start, testDate),
    firstAccuracy: PLAN_DEFAULTS.firstAccuracy,
    device,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });
}

function clearSampleData() {
  writeRecords(loadRecords().filter((r) => !isSampleId(r.id)));
  writePlans(loadPlans().filter((p) => p.id !== SAMPLE_PLAN_ID));
}
