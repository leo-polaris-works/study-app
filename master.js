// 選択肢のマスタ。端末内（localStorage）に変更があればそれを使い、なければ config.js の初期値を使う。

const MASTER_KEY = 'study_master_v1';

function readMasterStore() {
  try {
    return JSON.parse(localStorage.getItem(MASTER_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function getMaster(type) {
  const store = readMasterStore();
  const list = store[type] || DEFAULT_MASTERS[type];
  return JSON.parse(JSON.stringify(list));
}

function getActiveMaster(type) {
  return getMaster(type).filter((item) => item.active);
}

function saveMaster(type, list) {
  const store = readMasterStore();
  store[type] = list;
  localStorage.setItem(MASTER_KEY, JSON.stringify(store));
}

function resetMaster(type) {
  const store = readMasterStore();
  delete store[type];
  localStorage.setItem(MASTER_KEY, JSON.stringify(store));
}

function newMasterId(type) {
  return type + '-u' + Date.now().toString(36);
}

function fieldsForSubject(subject) {
  if (!subject) return [];
  return getActiveMaster('field').filter((f) => f.subject === subject);
}

function materialsForSubject(subject) {
  if (!subject) return [];
  return getActiveMaster('material').filter((m) => m.subject === subject);
}

// 現在時刻から時間帯を自動選択する（開始時刻が現在以下で最も遅いもの）
function autoTimeBandId(date = new Date()) {
  const hour = date.getHours();
  const bands = getActiveMaster('timeband').filter((b) => typeof b.startHour === 'number');
  let picked = null;
  bands.forEach((b) => {
    if (b.startHour <= hour && (!picked || b.startHour > picked.startHour)) picked = b;
  });
  return picked ? picked.id : null;
}
