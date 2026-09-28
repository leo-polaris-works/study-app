// 記録の保存と集計（モック段階は端末内 localStorage。形式は 記録設計/02_記録データの形式.md）

const RECORDS_KEY = 'study_mock_records_v5';
const DEVICE_KEY = 'study_device_v1';
const SCHEMA_VERSION = 1;

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
}

function updateRecord(record) {
  const records = loadRecords();
  const i = records.findIndex((r) => r.id === record.id);
  if (i >= 0) records[i] = record;
  else records.push(record);
  writeRecords(records);
}

function markRecordDeleted(id) {
  const records = loadRecords();
  const r = records.find((x) => x.id === id);
  if (!r) return;
  r.deleted = true;
  r.updatedAt = localIso();
  writeRecords(records);
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

// テスト・実機確認用のサンプルデータ（本番運用では使わない）
function seedSampleData() {
  const today = formatDate(new Date());
  const device = getDevice();
  const rows = [
    { d: 0, band: ['tb-night', '夜'], subject: '理科', activity: ['a-test', 'テスト対策'], minutes: 25, fields: [['f-sc-chem', '化学', 15], ['f-sc-bio', '生物', 10]], materials: [['m-sc-work', 'ワーク', 5, 'ページ'], ['m-sc-redo', '解き直し', 8, '問題']], accuracy: { level: 3, label: '〜70%' }, issues: [['i-forgot', '前のを忘れた']] },
    { d: 0, band: ['tb-evening', '夕方'], subject: '数学', activity: ['a-hw', '宿題・提出物'], minutes: 50, fields: [['f-ma-calc', '計算', 20], ['f-ma-word', '文章題', 30]], materials: [['m-ma-hw', '宿題', 6, 'ページ']], accuracy: { level: 4, label: '〜90%' }, issues: [] },
    { d: -1, band: ['tb-morning', '朝'], subject: '英語', activity: ['a-review-week', '復習（今週の授業）'], minutes: 15, fields: [['f-en-word', '単語・熟語', 15]], materials: [['m-en-word', '単語', 30, '語']], accuracy: null, issues: [] },
    { d: -2, band: ['tb-night', '夜'], subject: '社会', activity: ['a-review-past', '復習（先週以前）'], minutes: 25, fields: [['f-so-history', '歴史', 25]], materials: [['m-so-text', '教科書', 4, 'ページ']], accuracy: { level: 2, label: '〜50%' }, issues: [['i-again', 'また間違えた'], ['i-seeans', '見れば分かる']] },
  ];
  const records = loadRecords();
  rows.forEach((r, i) => {
    const now = localIso();
    records.push({
      schemaVersion: SCHEMA_VERSION,
      id: 'sample-' + i,
      date: shiftDate(today, r.d),
      timeBand: { id: r.band[0], label: r.band[1] },
      totalMinutes: r.minutes,
      subject: r.subject,
      activity: { id: r.activity[0], label: r.activity[1] },
      fields: r.fields.map((f) => ({ id: f[0], label: f[1], minutes: f[2] })),
      materials: r.materials.map((m) => ({ id: m[0], label: m[1], amount: { value: m[2], unit: m[3] } })),
      accuracy: r.accuracy,
      issues: r.issues.map((x) => ({ id: x[0], label: x[1] })),
      device,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });
  });
  writeRecords(records);
}

function clearSampleData() {
  writeRecords(loadRecords().filter((r) => !String(r.id).startsWith('sample-')));
}
