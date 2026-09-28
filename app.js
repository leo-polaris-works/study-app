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
  showScreen(id);
}

// --- TOP ---
function isReadOnly() {
  return getSyncSummary().mode === 'read';
}

function renderTop() {
  // 「見るだけ」の端末では、記録・設定のボタンを出さない
  const writable = !isReadOnly();
  ['menu-record', 'menu-review', 'menu-plan', 'menu-settings'].forEach((id) => {
    $(id).hidden = !writable;
  });
  renderSyncLine();

  const s = weekSummary();
  $('week-total').textContent = formatMinutes(s.totalMinutes);
  $('week-days').textContent = `${s.dayCount}日`;

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
    row.appendChild(el('span', 'bar-value', formatMinutes(minutes)));
    box.appendChild(row);
  });
}

$('menu-record').addEventListener('click', () => {
  if (!isReadOnly()) startInput();
});

function openPlaceholder(title) {
  $('placeholder-title').textContent = title;
  showScreen('screen-placeholder');
}
$('menu-review').addEventListener('click', () => openPlaceholder('振り返り'));
$('menu-plan').addEventListener('click', () => openPlaceholder('学習計画'));

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
  const durChips = el('div', 'chips');
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

  const timeChipValues = getActiveMaster('duration').map((d) => d.minutes);
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
      });
      row.appendChild(chip);
    });
    body.appendChild(row);
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

// 7. 確認
function buildRecord() {
  const band = findById(getMaster('timeband'), form.timeBandId);
  const activity = findById(getMaster('activity'), form.activityId);
  const accuracy = form.accuracy ? ACCURACY_LEVELS.find((a) => a.level === form.accuracy) : null;
  const issueMaster = getMaster('issue');
  const now = new Date();
  const editing = form.editing;

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
function formatSyncTime(iso) {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}`;
}

function syncLineInfo(s) {
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
  if (s.expiryWarn) {
    text += `　鍵の期限まであと${s.expiryDaysLeft}日`;
    warn = true;
  }
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
  if (s.running) text = '送信中…';
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

// --- 保存の設定（鍵）。鍵が使えない間は、アプリ全体の代わりにこの画面だけが出る ---
let syncModeChoice = null;

function setFieldError(id, message) {
  const box = $(id);
  box.textContent = message || '';
  box.hidden = !message;
}

function clearSyncErrors() {
  ['sync-err-token', 'sync-err-expires', 'sync-err-mode', 'sync-err-connect'].forEach((id) => setFieldError(id, ''));
}

function renderSyncModeChips() {
  const box = $('sync-mode');
  box.innerHTML = '';
  [
    ['write', '記録する'],
    ['read', '見るだけ'],
  ].forEach(([value, label]) => {
    box.appendChild(
      makeChip(label, syncModeChoice === value, () => {
        syncModeChoice = value;
        renderSyncModeChips();
      })
    );
  });
}

function renderSyncScreen() {
  const s = getSyncSummary();
  $('btn-sync-back').hidden = s.locked;
  $('sync-title').textContent = s.locked ? '鍵を入れてください' : '保存の設定（鍵）';
  const lockBox = $('sync-lock-message');
  lockBox.hidden = !s.locked;
  lockBox.textContent = s.locked ? lockMessage(s.lockReason) : '';

  const status = $('sync-status');
  status.innerHTML = '';
  if (s.configured && !s.locked) {
    status.appendChild(el('div', null, `この端末：${s.mode === 'read' ? '見るだけ' : '記録する'}`));
    if (s.expiresOn) {
      const left = s.expiryDaysLeft !== null ? `（あと${s.expiryDaysLeft}日）` : '';
      status.appendChild(el('div', s.expiryWarn ? 'field-warn' : null, `鍵の期限：${s.expiresOn}${left}`));
    }
    if (s.mode !== 'read') status.appendChild(el('div', null, `送信待ち：${s.pending}件`));
    status.appendChild(el('div', null, s.lastSyncAt ? `最後の同期：${formatSyncTime(s.lastSyncAt)}` : 'まだ同期していません'));
    if (s.error) status.appendChild(el('div', 'field-warn', s.error.message));
  }

  if (syncModeChoice === null) syncModeChoice = s.mode;
  renderSyncModeChips();
  $('sync-target').textContent = `保存先：${SYNC_DEFAULTS.owner}/${SYNC_DEFAULTS.repo}（非公開）`;
  $('btn-sync-connect').textContent = s.configured && !s.locked ? '鍵を入れ直す' : 'つないで確認する';
  $('sync-manage').hidden = !s.configured || s.locked;
}

$('menu-sync').addEventListener('click', () => {
  renderSyncScreen();
  showScreen('screen-sync');
});
$('btn-sync-back').addEventListener('click', () => goTo('screen-top'));

$('btn-sync-connect').addEventListener('click', async () => {
  clearSyncErrors();
  const btn = $('btn-sync-connect');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '確認中…';
  const result = await connectWithToken({
    token: $('sync-token').value,
    expiresOn: $('sync-expires').value,
    mode: syncModeChoice,
  });
  btn.disabled = false;
  btn.textContent = label;
  if (!result.ok) {
    const e = result.errors || {};
    setFieldError('sync-err-token', e.token);
    setFieldError('sync-err-expires', e.expiresOn);
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
  showScreen('screen-sync');
});

// 同期の状態が変わったとき、開いている画面を更新する（入力中の画面は触らない）
function handleSyncChange() {
  if (getLockState().locked) {
    showScreen('screen-sync');
    return;
  }
  renderSyncLine();
  if (currentScreen === 'screen-top') renderTop();
  else if (currentScreen === 'screen-records') renderRecordsList();
  else if (currentScreen === 'screen-sync') renderSyncScreen();
  else if (currentScreen === 'screen-done') renderDoneSync();
}

// --- 初期化 ---
if (typeof location !== 'undefined' && /[?&]dev=1/.test(location.search || '')) $('dev-tools').hidden = false;

onSyncChange(handleSyncChange);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (getLockState().locked) showScreen('screen-sync'); // 開いている間に期限が切れた場合
  syncNow({}).catch(() => {});
});
window.addEventListener('online', kickSync);

renderTop();
showScreen('screen-top');
if (!getLockState().locked) kickSync();
