// 画面切替とUIの配線。フレームワークは使わず、素のDOM操作のみ。

let form = null;

function $(id) {
  return document.getElementById(id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let currentScreen = null;

function showScreen(id) {
  if (getLockState().locked) id = 'screen-sync';
  if (id === 'screen-sync') renderSyncScreen();
  currentScreen = id;
  document.querySelectorAll('.screen').forEach((s) => {
    s.hidden = s.id !== id;
  });
  $('lap-dialog').hidden = true;
  window.scrollTo(0, 0);
}

function makeChip(label, selected, onClick, extraClass) {
  const btn = el('button', 'chip' + (extraClass ? ' ' + extraClass : ''), label);
  if (selected) btn.classList.add('selected');
  btn.addEventListener('click', onClick);
  return btn;
}

document.querySelectorAll('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => goTo(btn.dataset.goto));
});

function goTo(id) {
  if (id === 'screen-top') renderTop();
  if (id === 'screen-plans') renderPlansList();
  showScreen(id);
}

// --- 機能利用設定（管理用の機能を使うか。端末ごと） ---
const FEATURES_KEY = 'study_features_v1';

function loadFeatures() {
  const f = readJson(FEATURES_KEY, {});
  return { admin: f.admin === true }; // 初期は「利用しない」
}

function saveFeature(name, on) {
  localStorage.setItem(FEATURES_KEY, JSON.stringify(Object.assign(loadFeatures(), { [name]: !!on })));
}

// --- TOP ---
function isReadOnly() {
  return getSyncSummary().mode === 'read';
}

function renderTop() {
  // 「見るだけ」の端末では、学習記録のボタンを出さない（振り返りは見られる。書き込む操作だけ出さない）
  $('menu-record').hidden = isReadOnly();
  // 管理用（学習計画・学習記録設定）は、機能利用設定で「利用する」にした端末だけ出す
  const features = loadFeatures();
  $('menu-plan').hidden = !features.admin;
  $('menu-settings').hidden = !features.admin;
  const anyAdmin = !$('menu-plan').hidden || !$('menu-settings').hidden;
  $('admin-heading').hidden = !anyAdmin;
  $('admin-menu').hidden = !anyAdmin;
  renderSyncLine();
  renderTopWeek(renderTopPlanArea());
}

// --- TOP：テストまでの日数・計画（周回の表／今週のワーク）・今週のカード ---
// 計画は、今日がテスト日までに入るもの（テストが近い順）。テスト日だけで範囲（教材）がない計画もある
function currentPlan(today) {
  return (
    loadActivePlans()
      .filter((p) => p.startDate <= today && p.testDate >= today)
      .sort((a, b) => (a.testDate < b.testDate ? -1 : a.testDate > b.testDate ? 1 : 0))[0] || null
  );
}

function renderTopPlanArea() {
  const today = formatDate(new Date());
  const plan = currentPlan(today);
  const records = loadActiveRecords();
  const noplan = $('top-noplan');
  const count = $('top-count');
  const box = $('top-plan');
  [noplan, count, box].forEach((x) => (x.innerHTML = ''));
  noplan.hidden = !!plan;
  count.hidden = !plan;
  if (!plan) {
    const admin = loadFeatures().admin;
    noplan.appendChild(el('div', null, admin ? '次のテストの計画がまだありません' : '次のテストの計画はまだありません'));
    if (admin) noplan.appendChild(smallButton('学習計画を作る', () => openPlanEdit(newPlan())));
    renderWeekWork(box, records, today);
    return null;
  }
  const left = daysUntil(today, plan.testDate);
  count.appendChild(el('div', 'top-count-name', `${plan.name}（${shortDate(plan.testDate)}）まで`));
  const n = el('div', 'top-count-num');
  if (left > 0) {
    n.appendChild(el('span', null, 'あと'));
    n.appendChild(el('b', null, String(left)));
    n.appendChild(el('span', null, '日'));
  } else n.textContent = 'テストは今日';
  count.appendChild(n);
  if (!plan.items.length) {
    count.appendChild(el('div', 'top-count-sub', '範囲が発表されたら、周回で見られます'));
    renderWeekWork(box, records, today);
    return null;
  }
  return renderLapTable(box, plan, records, today);
}

// 今週のワーク：教科ごとに今週やったワークのページ数と前の週（範囲がなくても出せる）
function renderWeekWork(box, records, today) {
  const weekStart = startOfWeekStr();
  const pages = (from, to) => {
    const out = {};
    SUBJECTS.forEach((s) => (out[s] = 0));
    materialTotals(recordsBetween(records, from, to))
      .filter((m) => /-work$/.test(m.id) && m.unit === 'ページ')
      .forEach((m) => (out[m.subject] += m.value));
    return out;
  };
  const now = pages(weekStart, shiftDate(weekStart, 6));
  const prev = pages(shiftDate(weekStart, -7), shiftDate(weekStart, -1));
  const sum = (o) => SUBJECTS.reduce((a, s) => a + o[s], 0);
  const head = el('div', 'top-plan-goal');
  head.appendChild(el('span', null, '今週のワーク '));
  head.appendChild(el('b', null, String(sum(now))));
  head.appendChild(el('span', null, `ページ（前の週 ${sum(prev)}）`));
  box.appendChild(head);
  const max = Math.max(1, ...SUBJECTS.map((s) => now[s]));
  SUBJECTS.forEach((s) => {
    const row = el('div', 'work-row');
    row.appendChild(el('span', null, s));
    const track = el('div', 'work-track');
    const fill = el('i');
    fill.style.width = `${Math.round((now[s] / max) * 100)}%`;
    track.appendChild(fill);
    row.appendChild(track);
    const v = el('span', 'work-value' + (now[s] ? '' : ' is-zero'), `${now[s]}ページ`);
    v.appendChild(el('small', null, `前の週 ${prev[s]}`));
    row.appendChild(v);
    box.appendChild(row);
  });
}

// 周回の今の状態：いま進めている周（「終わった」を付けていない最初の周）と、その周の割合（付けるまでは99%で止める）。
// 割合は目安。2周目以降は、前の周を終えたときに次の量（×の数）を入れたときだけ測る（measured）。入れていなければ割合を出さない
function lapState(it) {
  const k = it.lapsNow.findIndex((l) => !l.marked);
  if (k < 0) return { lap: null, ratio: 1, done: 0, amount: 0, measured: false };
  const l = it.lapsNow[k];
  const prev = k > 0 ? lapMark(it, k) : null;
  const measured = k === 0 || !!(prev && typeof prev.nextAmount === 'number');
  return { lap: l.lap, ratio: l.amount > 0 ? l.done / l.amount : 0, done: l.done, amount: l.amount, measured };
}

function lapItemName(it) {
  return it.label === 'ワーク' ? it.subject : `${it.subject} ${it.label}`;
}

// 周回の表：1行が1教材、マス1つが1周。大きく遅れている教材の行だけ色を変える。行を押すと「終わった」を付けられる
function renderLapTable(box, plan, records, today) {
  const result = computePlan(plan, records, today);
  const lags = {};
  lagStatus(result).forEach((s) => {
    if (s.ratio !== null && s.ratio < RR.bigLagRatio) lags[s.item] = roundAmount(s.planned - s.done);
  });
  const states = result.items.map(lapState);
  const open = states.filter((x) => x.lap !== null);
  const head = el('div', 'top-plan-goal');
  if (!open.length) head.textContent = 'すべての周が終わりました';
  else {
    const lap = Math.min(...open.map((x) => x.lap));
    const maxLaps = Math.max(...result.items.map((it) => it.laps));
    const deadline = lap === 1 ? result.deadlines[1] : lap < maxLaps ? result.deadlines[2] : result.deadlines[3];
    const d = Math.max(0, daysUntil(today, deadline));
    head.appendChild(el('span', null, `${lap}周目の目安 `));
    head.appendChild(el('b', null, shortDate(deadline)));
    head.appendChild(el('span', null, ` まで（あと${d}日）`));
  }
  box.appendChild(head);
  const writable = !isReadOnly();
  result.items.forEach((it, i) => {
    const st = states[i];
    const late = lags[i] !== undefined && st.lap !== null && st.measured;
    const row = el(writable ? 'button' : 'div', 'lap-row' + (late ? ' is-late' : ''));
    if (writable) row.type = 'button';
    row.appendChild(el('span', 'lap-name', lapItemName(it)));
    const segs = el('div', 'top-lap-segs');
    it.lapsNow.forEach((l, k) => {
      const seg = el('div', 'top-lap-seg' + (l.marked ? ' is-done' : ''));
      if (!l.marked && k === st.lap - 1 && st.measured && l.amount > 0 && l.done > 0) {
        const fill = el('i');
        fill.style.width = `${Math.round(Math.min(0.99, l.done / l.amount) * 100)}%`;
        seg.appendChild(fill);
      }
      segs.appendChild(seg);
    });
    row.appendChild(segs);
    const v = el('span', 'lap-value');
    if (st.lap === null) v.textContent = '✓ 全部';
    else if (!st.measured) v.textContent = `${st.lap}周目`;
    else if (st.ratio >= 1) {
      v.textContent = `${st.lap}周目 もうすぐ`;
      if (writable) v.appendChild(el('small', null, '終わったら押す'));
    } else {
      v.textContent = `${st.lap}周目 ${Math.round(st.ratio * 100)}%`;
      if (late) v.appendChild(el('small', null, `予定まで あと${lags[i]}${it.unit}`));
    }
    row.appendChild(v);
    if (writable) row.addEventListener('click', () => openLapDialog(plan.id, i));
    box.appendChild(row);
  });
  if (writable) box.appendChild(el('div', 'field-note', 'マス1つ＝1周。行を押すと「終わった」を付けられる'));
  return planProgress(plan, records, startOfWeekStr(), today);
}

// 「○周目が終わった」を付ける・取り消す（計画のファイルを直して送る）
function setLapMark(planId, index, lap, nextAmount) {
  const plan = findPlan(planId);
  if (!plan || isReadOnly()) return;
  const it = plan.items[index];
  it.lapMarks = (it.lapMarks || []).filter((m) => m.lap < lap);
  if (nextAmount !== undefined) it.lapMarks.push({ lap, date: formatDate(new Date()), nextAmount });
  savePlan(plan);
  kickSync();
}

let lapDialog = null; // { planId, index }

function openLapDialog(planId, index) {
  const plan = findPlan(planId);
  if (!plan || isReadOnly()) return;
  lapDialog = { planId, index };
  const result = computePlan(plan, loadActiveRecords(), formatDate(new Date()));
  const it = result.items[index];
  const st = lapState(it);
  const body = $('lap-dialog-body');
  body.innerHTML = '';
  $('lap-dialog-title').textContent = st.lap === null ? `${lapItemName(it)}：すべての周が終わりました` : `${lapItemName(it)} ${st.lap}周目、終わった？`;
  let input = null;
  if (st.lap !== null) {
    if (st.measured) body.appendChild(el('div', 'field-note', `記録からの目安 ${Math.min(99, Math.round(st.ratio * 100))}%（${roundAmount(st.amount)}${it.unit}中 ${Math.round(st.done)}${it.unit}）`));
    if (planItemKind(it.unit) === 'drill' && st.lap < it.laps) {
      input = el('input', 'plan-input');
      input.type = 'number';
      input.min = '0';
      input.inputMode = 'numeric';
      input.setAttribute('aria-label', '次の周でやる量');
      body.appendChild(el('div', 'field-label', `${st.lap + 1}周目でやる量（×の数。わからなければ空けておく）`));
      body.appendChild(input);
    }
    const acts = el('div', 'lap-dialog-actions');
    acts.appendChild(smallButton('まだ', closeLapDialog));
    const done = el('button', 'btn btn-small btn-primary', '終わった');
    done.type = 'button';
    done.addEventListener('click', () => {
      const v = input && input.value !== '' ? Number(input.value) : null;
      setLapMark(planId, index, st.lap, v !== null && isFinite(v) && v >= 0 ? v : null);
      closeLapDialog();
    });
    acts.appendChild(done);
    body.appendChild(acts);
  }
  const last = (plan.items[index].lapMarks || []).slice(-1)[0];
  if (last) {
    body.appendChild(
      smallButton(
        `${last.lap}周目の「終わった」を取り消す`,
        () => {
          setLapMark(planId, index, last.lap);
          closeLapDialog();
        },
        'btn-link'
      )
    );
  }
  $('lap-dialog').hidden = false;
}

function closeLapDialog() {
  lapDialog = null;
  $('lap-dialog').hidden = true;
  if (currentScreen === 'screen-top') renderTop();
}

$('btn-lap-close').addEventListener('click', closeLapDialog);
$('lap-dialog').addEventListener('click', (e) => {
  if (e.target === $('lap-dialog')) closeLapDialog();
});

// 今週のカード：「今週　○時間○分　○日」、できたこと1行、教科ごとの時間の棒（あいている教科は「○日あき」）
function renderTopWeek(progress) {
  const s = weekSummary();
  $('week-total').textContent = formatMinutes(s.totalMinutes);
  $('week-days').textContent = `${s.dayCount}日`;
  const today = formatDate(new Date());
  const records = loadActiveRecords();
  const praise = praiseLines(summarizeWeek(records, startOfWeekStr(), today), progress)[0];
  $('week-praise').hidden = !praise;
  $('week-praise').textContent = praise || '';

  const gaps = subjectGaps(records, today);
  const box = $('week-subjects');
  box.innerHTML = '';
  const max = Math.max(1, ...Object.values(s.bySubject));
  SUBJECTS.forEach((name) => {
    const minutes = s.bySubject[name];
    const row = el('div', 'bar-row');
    row.appendChild(el('span', 'bar-name', name));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${Math.round((minutes / max) * 100)}%`;
    track.appendChild(fill);
    row.appendChild(track);
    const v = el('span', 'bar-value', formatMinutes(minutes));
    if (gaps[name] !== undefined) v.appendChild(el('span', 'bar-gap', gaps[name] === Infinity ? 'しばらくあき' : `${gaps[name]}日あき`));
    row.appendChild(v);
    box.appendChild(row);
  });
}

$('menu-record').addEventListener('click', () => {
  if (!isReadOnly()) startInput();
});

$('menu-review').addEventListener('click', () => openReview());
$('menu-plan').addEventListener('click', () => openPlans());

$('menu-settings').addEventListener('click', () => {
  settingsTab = settingsTab || 'field';
  renderSettings();
  showScreen('screen-settings');
});

$('btn-seed-sample').addEventListener('click', () => {
  seedSampleData();
  renderTop();
  alert('サンプルデータを入れました');
});
$('btn-clear-sample').addEventListener('click', () => {
  clearSampleData();
  renderTop();
  alert('サンプルデータを消しました');
});

// --- 入力（1項目1ページ。上部の現在地バーで抜け漏れを防ぐ） ---
const STEPS = [
  { key: 'when', label: 'いつ' },
  { key: 'activity', label: 'やったこと' },
  { key: 'fields', label: '学習内容' },
  { key: 'amount', label: '量' },
  { key: 'accuracy', label: '正答率' },
  { key: 'issue', label: '課題' },
  { key: 'confirm', label: '確認' },
];
const ADVANCE_DELAY_MS = 120;

let stepIndex = 0;
let advanceTimer = null;

function newForm() {
  return {
    date: formatDate(new Date()),
    timeBandId: autoTimeBandId(),
    durationId: null,
    subject: null,
    activityId: null,
    alloc: {},
    qty: {},
    accuracy: null,
    issueIds: [],
    issueOther: false,
    issueOtherText: '',
    unclearText: '',
    unclearResolvedAt: null,
    done: { when: false, amount: false, accuracy: false, issue: false },
    editing: null,
  };
}

function findById(list, id) {
  return list.find((x) => x.id === id) || null;
}

function totalMinutes() {
  const d = form.durationId ? findById(getMaster('duration'), form.durationId) : null;
  return d ? d.minutes : 0;
}

function allocSum() {
  return Object.values(form.alloc).reduce((a, b) => a + b, 0);
}

function selectedMaterials() {
  return getMaster('material').filter((m) => form.qty[m.id]);
}

function resetSubjectDependents() {
  form.alloc = {};
  form.qty = {};
  form.done.amount = false;
}

function startInput() {
  if (isReadOnly()) return;
  form = newForm();
  stepIndex = 0;
  renderStep();
  showScreen('screen-input');
}

function isStepDone(key) {
  switch (key) {
    case 'when':
      return form.done.when && !!form.durationId;
    case 'activity':
      return !!form.activityId && !!form.subject;
    case 'fields':
      return totalMinutes() > 0 && allocSum() === totalMinutes();
    case 'amount':
      return form.done.amount;
    case 'accuracy':
      return form.done.accuracy;
    case 'issue':
      return form.done.issue;
    default:
      return false;
  }
}

// 現在のページより後で、まだ入力が済んでいない最初のページへ進む（全部済みなら確認へ）
function advance() {
  clearTimeout(advanceTimer);
  let next = stepIndex + 1;
  while (next < STEPS.length - 1 && isStepDone(STEPS[next].key)) next++;
  stepIndex = next;
  renderStep();
}

function goNextSoon() {
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(advance, ADVANCE_DELAY_MS);
}

function goBack() {
  clearTimeout(advanceTimer);
  if (stepIndex === 0) {
    goTo('screen-top');
    return;
  }
  stepIndex -= 1;
  renderStep();
}

$('btn-step-back').addEventListener('click', goBack);

function renderStepper() {
  const bar = $('stepper');
  bar.innerHTML = '';
  STEPS.forEach((s, i) => {
    const li = el('li', 'step');
    const done = i !== stepIndex && s.key !== 'confirm' && (i < stepIndex || isStepDone(s.key));
    if (i === stepIndex) li.classList.add('current');
    else if (done) li.classList.add('done');

    li.appendChild(el('span', 'step-dot', done ? '✓' : String(i + 1)));
    const labelBox = el('span', 'step-label');
    s.label.split('/').forEach((line) => labelBox.appendChild(el('span', 'step-label-line', line)));
    li.appendChild(labelBox);

    if (i !== stepIndex && (i < stepIndex || isStepDone(s.key))) {
      li.classList.add('clickable');
      li.addEventListener('click', () => {
        clearTimeout(advanceTimer);
        stepIndex = i;
        renderStep();
      });
    }
    bar.appendChild(li);
  });
}

function renderStep() {
  renderStepper();
  const body = $('step-body');
  body.innerHTML = '';
  const renderers = {
    when: renderWhenStep,
    activity: renderActivityStep,
    fields: renderFieldsStep,
    amount: renderAmountStep,
    accuracy: renderAccuracyStep,
    issue: renderIssueStep,
    confirm: renderConfirmStep,
  };
  renderers[STEPS[stepIndex].key](body);
  window.scrollTo(0, 0);
}

function stepTitle(body, text, note) {
  body.appendChild(el('h2', 'step-title', text));
  if (note) body.appendChild(el('div', 'field-note', note));
}

function addNextButton(body, label, enabled, onClick) {
  const btn = el('button', 'btn btn-primary btn-big', label);
  btn.disabled = !enabled;
  btn.addEventListener('click', onClick);
  body.appendChild(btn);
  return btn;
}

// 1. いつ（日付・時間帯・合計時間）
function renderWhenStep(body) {
  stepTitle(body, 'いつ、どれくらい勉強した？');
  const today = formatDate(new Date());

  const nav = el('div', 'date-nav');
  const prev = el('button', 'btn btn-date', '◀');
  prev.addEventListener('click', () => {
    form.date = shiftDate(form.date, -1);
    renderStep();
  });
  const label = el('label', 'date-label');
  label.appendChild(el('span', null, displayDate(form.date) + (form.date === today ? '・今日' : '')));
  const dateInput = el('input');
  dateInput.type = 'date';
  dateInput.value = form.date;
  dateInput.max = today;
  dateInput.addEventListener('change', () => {
    if (dateInput.value) {
      form.date = dateInput.value;
      renderStep();
    }
  });
  label.appendChild(dateInput);
  const next = el('button', 'btn btn-date', '▶');
  next.disabled = form.date >= today;
  next.addEventListener('click', () => {
    if (form.date >= today) return;
    form.date = shiftDate(form.date, 1);
    renderStep();
  });
  nav.append(prev, label, next);
  body.appendChild(nav);

  body.appendChild(el('div', 'field-label', '時間帯'));
  const bandChips = el('div', 'chips');
  getActiveMaster('timeband').forEach((b) => {
    const chip = makeChip(b.label, form.timeBandId === b.id, () => {
      form.timeBandId = b.id;
      renderStep();
    });
    if (b.hint) chip.appendChild(el('small', 'chip-hint', b.hint));
    bandChips.appendChild(chip);
  });
  body.appendChild(bandChips);

  body.appendChild(el('div', 'field-label', '合計時間'));
  const durChips = el('div', 'chips-grid'); // 6個ずつ2段
  getActiveMaster('duration').forEach((d) => {
    durChips.appendChild(
      makeChip(d.label, form.durationId === d.id, () => {
        if (form.durationId !== d.id) {
          form.durationId = d.id;
          form.alloc = {};
        }
        renderStep();
      })
    );
  });
  body.appendChild(durChips);

  addNextButton(body, '次へ', !!form.timeBandId && !!form.durationId, () => {
    form.done.when = true;
    advance();
  });
}

// 2. やったこと＋教科（同じページ。どちらも必須。両方そろったら自動で次へ）
function renderActivityStep(body) {
  stepTitle(body, 'やったことと教科は？');
  const proceedIfDone = () => {
    if (form.activityId && form.subject) goNextSoon();
  };

  body.appendChild(el('div', 'field-label', 'やったこと'));
  const actChips = el('div', 'chips chips-big');
  getActiveMaster('activity').forEach((a) => {
    actChips.appendChild(
      makeChip(a.label, form.activityId === a.id, () => {
        form.activityId = a.id;
        renderStep();
        proceedIfDone();
      })
    );
  });
  body.appendChild(actChips);

  body.appendChild(el('div', 'field-label', '教科'));
  const subjChips = el('div', 'chips chips-big');
  SUBJECTS.forEach((name) => {
    subjChips.appendChild(
      makeChip(name, form.subject === name, () => {
        if (form.subject !== name) {
          form.subject = name;
          resetSubjectDependents();
        }
        renderStep();
        proceedIfDone();
      })
    );
  });
  body.appendChild(subjChips);
}

// 3. 学習内容（何に何分かけたか。項目ごとに時間を選び、合計を「いつ」の合計時間に合わせる）
function renderFieldsStep(body) {
  const total = totalMinutes();
  stepTitle(body, '何に何分かけた？');
  const remainBox = el('div', 'remain-box');
  body.appendChild(remainBox);

  const nextBtn = el('button', 'btn btn-primary btn-big', '次へ');
  nextBtn.addEventListener('click', advance);

  // 項目ごとの時間チップ：合計以下の選択肢のうち小さいほうから6個（1行に収める。大きい時間は「残り」）
  const timeChipValues = getActiveMaster('duration')
    .map((d) => d.minutes)
    .filter((v) => v <= total)
    .slice(0, 6);
  const refreshers = [];
  const refreshAll = () => {
    const remaining = total - allocSum();
    remainBox.textContent = remaining === 0 ? '合計が合いました' : `残り ${remaining}分`;
    remainBox.classList.toggle('ok', remaining === 0);
    nextBtn.disabled = remaining !== 0;
    refreshers.forEach((r) => r());
  };

  fieldsForSubject(form.subject).forEach((f) => {
    const row = el('div', 'time-row');
    row.appendChild(el('div', 'time-name', f.label));
    const chips = el('div', 'chips-oneline chips-time');
    const defs = timeChipValues.map((v) => ({ label: String(v), rest: false, v }));
    defs.push({ label: '残り', rest: true });

    const remainingFor = () => total - (allocSum() - (form.alloc[f.id] || 0));
    const valueOf = (def) => (def.rest ? remainingFor() : def.v);
    const isSelected = (def) => {
      const own = form.alloc[f.id] || 0;
      return own > 0 && (def.rest ? !timeChipValues.includes(own) : own === def.v);
    };

    const chipEls = defs.map((def) => {
      const chip = makeChip(def.label, false, () => {
        if (isSelected(def)) {
          delete form.alloc[f.id];
        } else {
          const value = valueOf(def);
          if (value <= 0 || value > remainingFor()) return;
          form.alloc[f.id] = value;
        }
        refreshAll();
      });
      chips.appendChild(chip);
      return chip;
    });

    refreshers.push(() => {
      chipEls.forEach((chip, i) => {
        const def = defs[i];
        const selected = isSelected(def);
        chip.classList.toggle('selected', selected);
        const value = valueOf(def);
        chip.disabled = !selected && (value <= 0 || value > remainingFor());
      });
    });

    row.appendChild(chips);
    body.appendChild(row);
  });

  body.appendChild(nextBtn);
  refreshAll();
}

// 4. 量（何をどれだけやったか。教科ごとの教材・作業を縦に並べ、行ごとに直接選ぶ。1つ以上必須）
function renderAmountStep(body) {
  stepTitle(body, '何をどれくらいやった？');
  const nextBtn = el('button', 'btn btn-primary btn-big', '次へ');
  const updateNext = () => {
    nextBtn.disabled = selectedMaterials().length === 0;
  };
  nextBtn.addEventListener('click', () => {
    form.done.amount = true;
    advance();
  });

  materialsForSubject(form.subject).forEach((m) => {
    const row = el('div', 'time-row');
    row.appendChild(el('div', 'time-name', m.unit === 'なし' ? m.label : `${m.label}（${m.unit}）`));

    const chipRow = el('div', 'chips-oneline chips-time' + (m.unit === 'なし' ? ' chips-single' : ''));
    const input = el('input', 'amount-custom');
    input.type = 'number';
    input.min = '1';
    input.max = '999';
    input.inputMode = 'numeric';
    input.placeholder = '数字';

    const values = m.unit === 'なし' ? [] : UNIT_PRESETS[m.unit] || [];
    let customOpen = !!form.qty[m.id] && m.unit !== 'なし' && !values.includes(form.qty[m.id]);
    if (customOpen) input.value = String(form.qty[m.id]);

    const chipEls = [];
    const changed = () => {
      form.done.amount = false;
      refresh();
    };

    if (m.unit === 'なし') {
      chipEls.push({
        chip: makeChip('やった', false, () => {
          if (form.qty[m.id]) delete form.qty[m.id];
          else form.qty[m.id] = true;
          changed();
        }),
        selected: () => !!form.qty[m.id],
      });
    } else {
      values.forEach((v) => {
        chipEls.push({
          chip: makeChip(String(v), false, () => {
            customOpen = false;
            if (form.qty[m.id] === v) delete form.qty[m.id];
            else form.qty[m.id] = v;
            changed();
          }),
          selected: () => !customOpen && form.qty[m.id] === v,
        });
      });
      chipEls.push({
        chip: makeChip('他', false, () => {
          if (customOpen) {
            customOpen = false;
            delete form.qty[m.id];
            input.value = '';
          } else {
            customOpen = true;
            delete form.qty[m.id];
            input.value = '';
          }
          changed();
          if (customOpen && input.focus) input.focus();
        }),
        selected: () => customOpen,
      });
    }
    chipEls.forEach((c) => chipRow.appendChild(c.chip));

    const refresh = () => {
      chipEls.forEach((c) => c.chip.classList.toggle('selected', c.selected()));
      input.hidden = !customOpen;
      updateNext();
    };
    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10);
      if (v > 0) form.qty[m.id] = v;
      else delete form.qty[m.id];
      form.done.amount = false;
      updateNext();
    });

    row.appendChild(chipRow);
    row.appendChild(input);
    body.appendChild(row);
    refresh();
  });

  body.appendChild(nextBtn);
  updateNext();
}

// 5. 正答率
function renderAccuracyStep(body) {
  stepTitle(body, '正答率は？', 'その回に解いた問題のうち○だった割合（×直しの回は、直せた割合）');
  const chips = el('div', 'chips chips-big');
  ACCURACY_LEVELS.forEach((a) => {
    chips.appendChild(
      makeChip(a.label, form.accuracy === a.level, () => {
        form.accuracy = a.level;
        form.done.accuracy = true;
        renderStep();
        goNextSoon();
      })
    );
  });
  chips.appendChild(
    makeChip('測っていない', form.done.accuracy && form.accuracy === null, () => {
      form.accuracy = null;
      form.done.accuracy = true;
      renderStep();
      goNextSoon();
    })
  );
  body.appendChild(chips);
}

// 6. 課題（複数選択・上限3つ。「その他」は自由入力できる）
let issueWarnTimer = null;

function issueCount() {
  return form.issueIds.length + (form.issueOther ? 1 : 0);
}

function renderIssueStep(body) {
  const title = el('h2', 'step-title');
  title.append('今日ひっかかったことは？（');
  const count = el('span', null, String(issueCount()));
  title.append(count, `/${ISSUE_MAX}）`);
  body.appendChild(title);

  const noneChips = el('div', 'chips chips-big');
  noneChips.appendChild(
    makeChip('特になし', form.done.issue && issueCount() === 0, () => {
      form.issueIds = [];
      form.issueOther = false;
      form.issueOtherText = '';
      form.unclearText = '';
      form.done.issue = true;
      renderStep();
      goNextSoon();
    })
  );
  body.appendChild(noneChips);

  const nextBtn = el('button', 'btn btn-primary btn-big', '次へ');
  nextBtn.disabled = issueCount() === 0;
  nextBtn.addEventListener('click', () => {
    form.done.issue = true;
    advance();
  });

  const warnLimit = () => {
    count.classList.add('warn');
    clearTimeout(issueWarnTimer);
    issueWarnTimer = setTimeout(() => count.classList.remove('warn'), 1200);
  };
  const afterChange = () => {
    form.done.issue = false;
    count.textContent = String(issueCount());
    nextBtn.disabled = issueCount() === 0;
    noneChips.firstChild.classList.remove('selected');
  };

  const items = getActiveMaster('issue');
  // 「わからなかった」の課題を選んだときだけ、わからなかったところを書ける（空欄でもよい）
  const unclearBox = el('div', 'unclear-box');
  unclearBox.appendChild(el('div', 'field-label', 'わからなかったところ（書けたら）'));
  const unclearInput = el('textarea', 'issue-free unclear-input');
  unclearInput.maxLength = UNCLEAR_MAX;
  unclearInput.rows = 2;
  unclearInput.placeholder = '例：理科ワーク p.32 問3、化学反応式の係数の決め方';
  unclearInput.value = form.unclearText;
  unclearInput.addEventListener('input', () => {
    form.unclearText = unclearInput.value;
  });
  unclearBox.appendChild(unclearInput);
  const showUnclear = () => {
    unclearBox.hidden = !hasUnclearIssue();
  };
  showUnclear();
  const groups = [...ISSUE_GROUPS];
  items.forEach((i) => {
    if (!groups.includes(i.group)) groups.push(i.group);
  });

  groups.forEach((g) => {
    const inGroup = items.filter((i) => i.group === g);
    if (inGroup.length === 0) return;
    body.appendChild(el('div', 'group-label', g));
    const row = el('div', 'chips chips-big');
    inGroup.forEach((i) => {
      const chip = makeChip(i.label, form.issueIds.includes(i.id), () => {
        if (form.issueIds.includes(i.id)) {
          form.issueIds = form.issueIds.filter((x) => x !== i.id);
        } else if (issueCount() < ISSUE_MAX) {
          form.issueIds.push(i.id);
        } else {
          warnLimit();
          return;
        }
        chip.classList.toggle('selected', form.issueIds.includes(i.id));
        afterChange();
        showUnclear();
      });
      row.appendChild(chip);
    });
    body.appendChild(row);
    if (g === UNCLEAR_GROUP) body.appendChild(unclearBox);
  });

  body.appendChild(el('div', 'group-label', 'その他'));
  const otherRow = el('div', 'chips chips-big');
  const freeInput = el('input', 'issue-free');
  freeInput.type = 'text';
  freeInput.maxLength = 40;
  freeInput.placeholder = '自由に書いてね';
  freeInput.value = form.issueOtherText;
  freeInput.hidden = !form.issueOther;
  freeInput.addEventListener('input', () => {
    form.issueOtherText = freeInput.value;
  });
  const otherChip = makeChip('その他（自由入力）', form.issueOther, () => {
    if (form.issueOther) {
      form.issueOther = false;
    } else if (issueCount() < ISSUE_MAX) {
      form.issueOther = true;
    } else {
      warnLimit();
      return;
    }
    otherChip.classList.toggle('selected', form.issueOther);
    freeInput.hidden = !form.issueOther;
    if (form.issueOther && freeInput.focus) freeInput.focus();
    afterChange();
  });
  otherRow.appendChild(otherChip);
  body.appendChild(otherRow);
  body.appendChild(freeInput);

  body.appendChild(nextBtn);
}

function hasUnclearIssue() {
  const master = getMaster('issue');
  return form.issueIds.some((id) => {
    const item = findById(master, id);
    return item && item.group === UNCLEAR_GROUP;
  });
}

// 7. 確認
function buildRecord() {
  const band = findById(getMaster('timeband'), form.timeBandId);
  const activity = findById(getMaster('activity'), form.activityId);
  const accuracy = form.accuracy ? ACCURACY_LEVELS.find((a) => a.level === form.accuracy) : null;
  const issueMaster = getMaster('issue');
  const now = new Date();
  const editing = form.editing;
  const unclearText = form.unclearText.trim().slice(0, UNCLEAR_MAX);
  const unclear = hasUnclearIssue() && unclearText ? { text: unclearText, resolvedAt: form.unclearResolvedAt || null } : null;

  return {
    schemaVersion: SCHEMA_VERSION,
    id: editing ? editing.id : makeRecordId(now),
    date: form.date,
    timeBand: band ? { id: band.id, label: band.label } : null,
    totalMinutes: totalMinutes(),
    subject: form.subject,
    activity: { id: activity.id, label: activity.label },
    fields: getMaster('field')
      .filter((f) => form.alloc[f.id] > 0)
      .map((f) => ({ id: f.id, label: f.label, minutes: form.alloc[f.id] })),
    materials: selectedMaterials().map((m) => ({
      id: m.id,
      label: m.label,
      amount: m.unit !== 'なし' && form.qty[m.id] ? { value: form.qty[m.id], unit: m.unit } : null,
    })),
    accuracy: accuracy ? { level: accuracy.level, label: accuracy.label } : null,
    issues: [
      ...form.issueIds
        .map((id) => findById(issueMaster, id))
        .filter(Boolean)
        .map((i) => ({ id: i.id, label: i.label })),
      ...(form.issueOther ? [{ id: 'i-free', label: 'その他', text: form.issueOtherText.trim() }] : []),
    ],
    ...(unclear ? { unclear } : {}),
    device: editing ? editing.device : getDevice(),
    createdAt: editing ? editing.createdAt : localIso(now),
    updatedAt: localIso(now),
    deleted: false,
  };
}

// 記録の内容を dl に並べる（確認ページと記録の詳細で共通）
function appendRecordRows(list, r) {
  addConfirmRow(list, '日付', displayDate(r.date));
  addConfirmRow(list, '時間帯', r.timeBand ? r.timeBand.label : '―');
  addConfirmRow(list, '教科', r.subject);
  addConfirmRow(list, 'やったこと', r.activity.label);
  addConfirmRow(list, '合計時間', `${r.totalMinutes}分`);
  addConfirmRow(
    list,
    '学習内容',
    r.fields.map((f) => `${f.label}　${f.minutes}分（${Math.round((f.minutes / r.totalMinutes) * 100)}%）`)
  );
  addConfirmRow(
    list,
    '量',
    r.materials.map((m) => (m.amount ? `${m.label}　${m.amount.value}${m.amount.unit}` : m.label))
  );
  addConfirmRow(list, '正答率', r.accuracy ? r.accuracy.label : '測っていない');
  addConfirmRow(
    list,
    '課題',
    r.issues.length ? r.issues.map((i) => (i.text ? `${i.label}：${i.text}` : i.label)).join('、') : '特になし'
  );
  if (r.unclear) {
    const done = r.unclear.resolvedAt ? `（わかった ${displayDate(r.unclear.resolvedAt)}）` : '';
    addConfirmRow(list, 'わからなかったところ', r.unclear.text + done);
  }
}

function addConfirmRow(list, term, lines) {
  list.appendChild(el('dt', null, term));
  const dd = el('dd');
  (Array.isArray(lines) ? lines : [lines]).forEach((line) => dd.appendChild(el('div', null, line)));
  list.appendChild(dd);
}

function renderConfirmStep(body) {
  const editing = !!form.editing;
  stepTitle(body, editing ? 'この内容で更新しますか？' : 'この内容で登録しますか？', '直したいところは、上のバーの項目をタップしてね');
  const incomplete = STEPS.slice(0, -1).some((s) => !isStepDone(s.key));
  if (incomplete) body.appendChild(el('div', 'field-warn', '入力が済んでいない項目があります。上のバーから入力してね'));

  const list = el('dl', 'confirm-list');
  if (!incomplete) appendRecordRows(list, buildRecord());
  body.appendChild(list);

  addNextButton(body, editing ? '更新する' : '登録する', !incomplete, () => {
    const record = buildRecord();
    if (editing) updateRecord(record);
    else saveRecord(record);
    renderDone(record, editing);
    showScreen('screen-done');
    kickSync();
  });
}

// --- 記録の修正・削除 ---
function recordToForm(r) {
  const f = newForm();
  const duration = getMaster('duration').find((d) => d.minutes === r.totalMinutes);
  f.date = r.date;
  f.timeBandId = r.timeBand ? r.timeBand.id : null;
  f.durationId = duration ? duration.id : null;
  f.subject = r.subject;
  f.activityId = r.activity ? r.activity.id : null;
  r.fields.forEach((x) => {
    f.alloc[x.id] = x.minutes;
  });
  r.materials.forEach((m) => {
    f.qty[m.id] = m.amount ? m.amount.value : true;
  });
  f.accuracy = r.accuracy ? r.accuracy.level : null;
  f.issueIds = r.issues.filter((i) => i.id !== 'i-free').map((i) => i.id);
  const free = r.issues.find((i) => i.id === 'i-free');
  f.issueOther = !!free;
  f.issueOtherText = free ? free.text || '' : '';
  f.unclearText = r.unclear ? r.unclear.text : '';
  f.unclearResolvedAt = r.unclear ? r.unclear.resolvedAt : null;
  f.done = { when: true, amount: true, accuracy: true, issue: true };
  f.editing = { id: r.id, createdAt: r.createdAt, device: r.device };
  return f;
}

function startEdit(id) {
  const r = findRecord(id);
  if (!r || isReadOnly()) return;
  form = recordToForm(r);
  stepIndex = STEPS.length - 1;
  renderStep();
  showScreen('screen-input');
}

let detailId = null;

function renderRecordsList() {
  $('records-note').textContent = isReadOnly() ? '直近14日の記録' : '直近14日。タップすると、修正・削除できます';
  const box = $('records-list');
  box.innerHTML = '';
  const list = recentRecords();
  if (list.length === 0) {
    box.appendChild(el('div', 'field-note', '直近14日の記録はまだありません'));
    return;
  }
  list.forEach((r) => {
    const item = el('button', 'record-item');
    item.appendChild(el('div', 'record-item-main', `${displayDate(r.date)}　${r.subject}・${r.activity.label}`));
    const fields = r.fields.map((f) => f.label).join('、');
    item.appendChild(el('div', 'record-item-sub', `${r.totalMinutes}分　${fields}`));
    item.addEventListener('click', () => openRecordDetail(r.id));
    box.appendChild(item);
  });
}

function openRecordDetail(id) {
  const r = findRecord(id);
  if (!r) return;
  detailId = id;
  $('detail-title').textContent = `${displayDate(r.date)}の記録`;
  const list = $('detail-list');
  list.innerHTML = '';
  appendRecordRows(list, r);
  const created = r.createdAt.slice(5, 16).replace('T', ' ');
  addConfirmRow(list, '記録した日時', created);
  addConfirmRow(list, '端末', `${r.device.kind}（${r.device.id}）`);
  $('btn-detail-edit').hidden = isReadOnly();
  $('btn-detail-delete').hidden = isReadOnly();
  showScreen('screen-record-detail');
}

$('menu-records').addEventListener('click', () => {
  renderRecordsList();
  showScreen('screen-records');
});
$('btn-detail-back').addEventListener('click', () => {
  renderRecordsList();
  showScreen('screen-records');
});
$('btn-detail-edit').addEventListener('click', () => startEdit(detailId));
$('btn-detail-delete').addEventListener('click', () => {
  if (isReadOnly() || !confirm('この記録を削除しますか？')) return;
  markRecordDeleted(detailId);
  renderTop();
  renderRecordsList();
  showScreen('screen-records');
  kickSync();
});

// --- 登録結果 ---
function renderDone(record, updated) {
  $('done-title').textContent = updated ? '更新しました' : '登録しました';
  const dayMinutes = dayTotalMinutes(record.date);
  const weekDays = weekSummary().dayCount;
  $('done-message').textContent = buildDoneMessage({
    timeBandId: record.timeBand ? record.timeBand.id : null,
    dayMinutes,
    weekDays,
    hasIssue: record.issues.length > 0,
  });
  $('done-facts').textContent = `${displayDate(record.date)}の合計 ${formatMinutes(dayMinutes)}／今週 ${weekDays}日記録`;

  renderDoneSync();
  renderDoneLap(record);

  const img = $('done-illust');
  if (ILLUSTRATIONS.length > 0) {
    img.onerror = () => {
      img.hidden = true;
    };
    img.src = pickRandom(ILLUSTRATIONS);
    img.hidden = false;
  } else {
    img.hidden = true;
  }
}

// 計画にある教材を記録したら、毎回「今は○周目。終わった？」と聞く（ページ数がずれていても聞く。押さなくても先に進める）
function lapsToAsk(record) {
  if (isReadOnly()) return [];
  const today = formatDate(new Date());
  const plan = currentPlan(today);
  if (!plan || !plan.items.length) return [];
  const ids = (record.materials || []).map((m) => m.id);
  const result = computePlan(plan, loadActiveRecords(), today);
  return result.items
    .filter((it) => ids.includes(it.materialId))
    .map((it) => ({ plan, it, st: lapState(it) }))
    .filter((x) => x.st.lap !== null);
}

function renderDoneLap(record) {
  const box = $('done-lap');
  box.innerHTML = '';
  const list = lapsToAsk(record);
  box.hidden = !list.length;
  list.forEach((x) => {
    const row = el('div', 'done-lap-item');
    const name = lapItemName(x.it);
    row.appendChild(el('div', 'done-lap-q', `${name}　今は ${x.st.lap}周目。終わった？`));
    if (x.st.measured) row.appendChild(el('div', 'field-note', `記録からの目安 ${Math.min(99, Math.round(x.st.ratio * 100))}%`));
    const acts = el('div', 'lap-dialog-actions');
    acts.appendChild(
      smallButton('まだ', () => {
        row.hidden = true;
        box.hidden = [...box.children].every((c) => c.hidden);
      })
    );
    const done = el('button', 'btn btn-small btn-primary', '終わった');
    done.type = 'button';
    done.addEventListener('click', () => {
      setLapMark(x.plan.id, x.it.index, x.st.lap, null);
      row.innerHTML = '';
      row.appendChild(el('div', 'done-lap-q', `✓ ${name} ${x.st.lap}周目、おつかれさま`));
      row.appendChild(el('div', 'field-note', '次の周でやる量（×の数）は、TOP の周回の行から入れられます'));
    });
    acts.appendChild(done);
    row.appendChild(acts);
    box.appendChild(row);
  });
}

$('btn-done-again').addEventListener('click', () => {
  startInput();
});
$('btn-done-top').addEventListener('click', () => goTo('screen-top'));

// --- 学習記録設定（マスタ） ---
let settingsTab = null;
let settingsFieldSubject = SUBJECTS[0];

function renderSettings() {
  const tabs = $('settings-tabs');
  tabs.innerHTML = '';
  Object.keys(MASTER_TITLES).forEach((type) => {
    tabs.appendChild(
      makeChip(MASTER_TITLES[type], settingsTab === type, () => {
        settingsTab = type;
        renderSettings();
      })
    );
  });
  renderSettingsBody();
}

function makeSelect(options, value, onChange) {
  const sel = el('select', 'setting-select');
  options.forEach((o) => {
    const opt = el('option', null, o);
    opt.value = o;
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function makeNumberInput(value, min, max, onChange) {
  const input = el('input', 'setting-number');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = String(min);
  input.max = String(max);
  input.value = value === undefined || value === null ? '' : String(value);
  input.addEventListener('change', () => onChange(input.value === '' ? null : parseInt(input.value, 10)));
  return input;
}

function renderSettingsBody() {
  const type = settingsTab;
  const list = getMaster(type);
  const body = $('settings-body');
  body.innerHTML = '';

  body.appendChild(el('p', 'field-note', '非表示にしても、過去の記録は変わりません。'));

  let visible = list;
  if (type === 'field' || type === 'material') {
    const subjectTabs = el('div', 'tabs');
    SUBJECTS.forEach((s) => {
      subjectTabs.appendChild(
        makeChip(s, settingsFieldSubject === s, () => {
          settingsFieldSubject = s;
          renderSettingsBody();
        })
      );
    });
    body.appendChild(subjectTabs);
    visible = list.filter((f) => f.subject === settingsFieldSubject);
  }

  visible.forEach((item, index) => {
    const row = el('div', 'setting-row' + (item.active ? '' : ' inactive'));

    const label = el('input', 'setting-label');
    label.type = 'text';
    label.maxLength = 16;
    label.value = item.label;
    label.addEventListener('change', () => {
      const v = label.value.trim();
      if (!v) {
        label.value = item.label;
        return;
      }
      item.label = v;
      saveMaster(type, list);
    });
    row.appendChild(label);

    const extra = el('div', 'setting-extra');
    if (type === 'material') {
      extra.appendChild(el('span', null, '量の単位'));
      extra.appendChild(
        makeSelect(UNITS, item.unit, (v) => {
          item.unit = v;
          saveMaster(type, list);
        })
      );
    } else if (type === 'duration') {
      extra.appendChild(el('span', null, '分'));
      extra.appendChild(
        makeNumberInput(item.minutes, 1, 300, (v) => {
          if (!v) return;
          item.minutes = v;
          item.label = `${v}分`;
          saveMaster(type, list);
          renderSettingsBody();
        })
      );
    } else if (type === 'issue') {
      extra.appendChild(
        makeSelect(ISSUE_GROUPS, item.group, (v) => {
          item.group = v;
          saveMaster(type, list);
        })
      );
    } else if (type === 'timeband') {
      extra.appendChild(el('span', null, '開始'));
      extra.appendChild(
        makeNumberInput(item.startHour, 0, 23, (v) => {
          item.startHour = v;
          saveMaster(type, list);
        })
      );
      extra.appendChild(el('span', null, '時'));
    }
    if (extra.childNodes.length) row.appendChild(extra);

    const swapWith = (otherItem) => {
      const a = list.indexOf(item);
      const b = list.indexOf(otherItem);
      [list[a], list[b]] = [list[b], list[a]];
      saveMaster(type, list);
      renderSettingsBody();
    };

    const actions = el('div', 'setting-actions');
    const up = el('button', 'btn btn-small', '↑');
    up.disabled = index === 0;
    up.addEventListener('click', () => swapWith(visible[index - 1]));
    const down = el('button', 'btn btn-small', '↓');
    down.disabled = index === visible.length - 1;
    down.addEventListener('click', () => swapWith(visible[index + 1]));
    const toggle = el('button', 'btn btn-small', item.active ? '表示中' : '非表示');
    toggle.addEventListener('click', () => {
      item.active = !item.active;
      saveMaster(type, list);
      renderSettingsBody();
    });
    actions.append(up, down, toggle);
    row.appendChild(actions);

    body.appendChild(row);
  });

  const add = el('button', 'btn btn-big', '＋ 項目を追加');
  add.addEventListener('click', () => {
    const name = (prompt('追加する項目の名前') || '').trim();
    if (!name) return;
    const item = { id: newMasterId(type), label: name, active: true };
    if (type === 'field') item.subject = settingsFieldSubject;
    if (type === 'material') Object.assign(item, { subject: settingsFieldSubject, unit: 'ページ' });
    if (type === 'duration') {
      const minutes = parseInt(prompt('時間（分）を数字で入力', '30'), 10);
      if (!(minutes > 0)) return;
      Object.assign(item, { minutes, label: `${minutes}分` });
    }
    if (type === 'issue') item.group = ISSUE_GROUPS[0];
    if (type === 'timeband') Object.assign(item, { hint: '', startHour: null });
    list.push(item);
    saveMaster(type, list);
    renderSettingsBody();
  });
  body.appendChild(add);

  const reset = el('button', 'btn btn-link btn-small', 'この一覧を初期値に戻す');
  reset.addEventListener('click', () => {
    if (!confirm(`「${MASTER_TITLES[type]}」を初期値に戻しますか？`)) return;
    resetMaster(type);
    renderSettingsBody();
  });
  body.appendChild(reset);
}

// --- 保存の状態（TOP の1行・登録結果） ---
const LOCAL_ONLY_NOTE = 'この端末にある記録で表示しています'; // 保存先から取れなかったとき

function formatSyncTime(iso) {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}`;
}

function syncLineInfo(s) {
  if (s.localTest) return { text: 'テスト用：このパソコンの中だけに保存（送信しません）', warn: true };
  if (s.locked) return { text: lockMessage(s.lockReason), warn: true };
  let text;
  let warn = false;
  if (s.running) {
    text = '同期中…';
  } else if (s.pending > 0) {
    text = `未送信 ${s.pending}件（${s.error ? s.error.message : '通信できたら自動で送ります'}）`;
    warn = !!s.error;
  } else if (s.error) {
    text = s.error.message;
    warn = true;
  } else if (s.lastSyncAt) {
    text = `${s.mode === 'read' ? '最新の記録を取り込みました' : '保存済み ✓'}（${formatSyncTime(s.lastSyncAt)}）`;
  } else {
    text = 'まだ同期していません';
  }
  if (s.notice) text += `　${s.notice}`;
  return { text, warn };
}

function renderSyncLine() {
  const info = syncLineInfo(getSyncSummary());
  const line = $('sync-line');
  line.textContent = info.text;
  line.classList.toggle('warn', info.warn);
}

function renderDoneSync() {
  const s = getSyncSummary();
  let text = '送信しました ✓';
  if (s.localTest) text = 'テスト用：このパソコンの中だけに保存しました（送信しません）';
  else if (s.running) text = '送信中…';
  else if (s.pending > 0) text = s.error ? `端末に保存しました。${s.error.message}` : '端末に保存しました。通信できたら自動で送ります';
  $('done-sync').textContent = text;
}

function kickSync() {
  syncNow({ force: true }).catch(() => {});
}

$('sync-line').addEventListener('click', () => {
  renderSyncScreen();
  showScreen('screen-sync');
});

// --- 機能利用設定・鍵。鍵が使えない間は、アプリ全体の代わりにこの画面だけが出る ---
let syncModeChoice = null;

function setFieldError(id, message) {
  const box = $(id);
  box.textContent = message || '';
  box.hidden = !message;
}

function clearSyncErrors() {
  ['sync-err-token', 'sync-err-mode', 'sync-err-connect'].forEach((id) => setFieldError(id, ''));
}

// 二択のスイッチ（ラジオボタンのグループ）
function renderSegmented(box, options, current, onChange) {
  box.innerHTML = '';
  options.forEach(([value, label]) => {
    box.appendChild(makeChip(label, current === value, () => onChange(value), 'seg'));
  });
}

// 鍵が入っていて使えるときは、選ぶとすぐ反映する（鍵は入れ直さない）
function renderSyncModeChips() {
  const s = getSyncSummary();
  const live = s.configured && !s.locked;
  renderSegmented(
    $('sync-mode'),
    [
      ['write', '記録する'],
      ['read', '見るだけ'],
    ],
    live ? s.mode : syncModeChoice,
    (value) => {
      if (live) {
        setSyncMode(value);
        return;
      }
      syncModeChoice = value;
      renderSyncModeChips();
    }
  );
}

function renderAdminChoice() {
  renderSegmented(
    $('sync-admin'),
    [
      [true, '利用する'],
      [false, '利用しない'],
    ],
    loadFeatures().admin,
    (value) => {
      saveFeature('admin', value);
      renderAdminChoice();
    }
  );
}

function renderSyncScreen() {
  const s = getSyncSummary();
  $('btn-sync-back').hidden = s.locked;
  $('sync-title').textContent = s.locked ? '鍵を入れてください' : '機能利用設定';
  const lockBox = $('sync-lock-message');
  lockBox.hidden = !s.locked;
  lockBox.textContent = s.locked ? lockMessage(s.lockReason) : '';

  const status = $('sync-status');
  status.innerHTML = '';
  if (s.localTest) {
    status.appendChild(el('div', null, 'テスト用（このパソコン）：鍵は使わず、どこにも送りません'));
  } else if (s.configured && !s.locked) {
    status.appendChild(el('div', null, `この端末：${s.mode === 'read' ? '見るだけ' : '記録する'}`));
    if (s.mode !== 'read') status.appendChild(el('div', null, `送信待ち：${s.pending}件`));
    status.appendChild(el('div', null, s.lastSyncAt ? `最後の同期：${formatSyncTime(s.lastSyncAt)}` : 'まだ同期していません'));
    if (s.error) status.appendChild(el('div', 'field-warn', s.error.message));
  }

  if (syncModeChoice === null) syncModeChoice = s.mode || 'write'; // 初期は「記録する」
  renderSyncModeChips();
  renderAdminChoice();
  // 鍵が入っていて使えるときは、鍵の欄と確認ボタンを出さない（鍵を消すまで再入力不要）
  const live = s.configured && !s.locked;
  $('sync-token-section').hidden = live || s.localTest;
  $('btn-sync-connect').hidden = live || s.localTest;
  $('sync-manage').hidden = !live || s.localTest;
}

$('btn-sync-back').addEventListener('click', () => goTo('screen-top'));

$('btn-sync-connect').addEventListener('click', async () => {
  clearSyncErrors();
  const btn = $('btn-sync-connect');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '確認中…';
  const result = await connectWithToken({
    token: $('sync-token').value,
    mode: syncModeChoice,
  });
  btn.disabled = false;
  btn.textContent = label;
  if (!result.ok) {
    const e = result.errors || {};
    setFieldError('sync-err-token', e.token);
    setFieldError('sync-err-mode', e.mode);
    setFieldError('sync-err-connect', result.message);
    return;
  }
  $('sync-token').value = '';
  goTo('screen-top');
  kickSync();
});

$('btn-sync-now').addEventListener('click', kickSync);

$('btn-sync-disconnect').addEventListener('click', () => {
  const pending = pendingIds().length;
  const note = pending > 0 ? `\n送信待ちの記録が${pending}件あります（端末に残り、新しい鍵を入れると送られます）。` : '';
  if (!confirm(`鍵を消しますか？\nこの端末に保存している送信済みの記録の控えも消えます（保存先には残ります）。${note}`)) return;
  disconnectSync();
  syncModeChoice = null;
  renderSyncScreen();
  showScreen('screen-sync');
});

// 同期の状態が変わったとき、開いている画面を更新する（入力中の画面は触らない）
function handleSyncChange() {
  if (getLockState().locked) {
    renderSyncScreen();
    showScreen('screen-sync');
    return;
  }
  renderSyncLine();
  if (currentScreen === 'screen-top') renderTop();
  else if (currentScreen === 'screen-records') renderRecordsList();
  else if (currentScreen === 'screen-plans') renderPlansList();
  else if (currentScreen === 'screen-review') renderReview();
  else if (currentScreen === 'screen-plan-result') renderPlanResult();
  else if (currentScreen === 'screen-sync') renderSyncScreen();
  else if (currentScreen === 'screen-done') renderDoneSync();
}

// --- 初期化 ---
if (typeof location !== 'undefined' && /[?&]dev=1/.test(location.search || '')) $('dev-tools').hidden = false;

onSyncChange(handleSyncChange);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (getLockState().locked) showScreen('screen-sync'); // 開いている間に鍵が使えなくなった場合
  syncNow({}).catch(() => {});
});
window.addEventListener('online', kickSync);

// 最初の表示は、すべてのスクリプトを読み終えてから（最後のスクリプトから呼ぶ。TOP は plan-ui.js の関数も使う）
function startApp() {
  renderTop();
  showScreen('screen-top');
  if (!getLockState().locked) kickSync();
}
