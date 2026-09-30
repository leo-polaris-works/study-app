// 学習計画の画面：一覧・編集・結果（グラフ）。計算は plan.js、保存は data.js・sync.js。

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 月〜日
const SVG_NS = 'http://www.w3.org/2000/svg';

let editingPlan = null;
let viewingPlanId = null;

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, String(attrs[k])));
  return node;
}

function todayStr() {
  return formatDate(new Date());
}

function shortDate(str) {
  const d = parseDate(str);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function aboutMinutes(min) {
  return '約' + formatMinutes(Math.max(0, Math.round(min / 5) * 5));
}

function lapText(laps) {
  return laps.map((l) => (l === 1 ? '1周目' : `${l}周目`)).join('・');
}

// --- 一覧 ---
function openPlans() {
  renderPlansList();
  showScreen('screen-plans');
}

function renderPlansList() {
  const box = $('plans-list');
  box.innerHTML = '';
  const plans = loadActivePlans();
  if (!plans.length) {
    box.appendChild(el('div', 'field-note', 'まだ計画がありません'));
    return;
  }
  const today = todayStr();
  plans.forEach((p) => {
    const item = el('button', 'record-item');
    item.appendChild(el('div', 'record-item-main', p.name));
    const left = daysUntil(today, p.testDate);
    const when = left > 0 ? `あと${left}日` : left === 0 ? '今日' : '終了';
    item.appendChild(el('div', 'record-item-sub', `テスト ${displayDate(p.testDate)}　${when}`));
    item.addEventListener('click', () => openPlanResult(p.id));
    box.appendChild(item);
  });
}

$('btn-plan-new').addEventListener('click', () => openPlanEdit(newPlan()));

// --- 編集 ---
function openPlanEdit(plan) {
  editingPlan = JSON.parse(JSON.stringify(plan));
  $('plan-edit-title').textContent = findPlan(plan.id) ? '計画を直す' : '計画を作る';
  $('plan-edit-error').hidden = true;
  renderPlanEdit();
  showScreen('screen-plan-edit');
}

$('btn-plan-edit-back').addEventListener('click', () => {
  if (viewingPlanId && findPlan(viewingPlanId) && editingPlan && editingPlan.id === viewingPlanId) openPlanResult(viewingPlanId);
  else openPlans();
});

function editSection(body, title, note) {
  const sec = el('div', 'plan-section');
  sec.appendChild(el('h3', 'plan-heading', title));
  if (note) sec.appendChild(el('div', 'field-note', note));
  body.appendChild(sec);
  return sec;
}

function labeled(label, control) {
  const row = el('label', 'plan-row');
  row.appendChild(el('span', 'plan-row-label', label));
  row.appendChild(control);
  return row;
}

function textInput(value, onChange, type) {
  const input = el('input', 'plan-input');
  input.type = type || 'text';
  input.value = value || '';
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

function smallButton(label, onClick, extra) {
  const b = el('button', 'btn btn-small' + (extra ? ' ' + extra : ''), label);
  b.addEventListener('click', onClick);
  return b;
}

function plannableMaterials(subject) {
  return materialsForSubject(subject).filter((m) => m.unit !== 'なし');
}

function renderPlanEdit() {
  const p = editingPlan;
  const body = $('plan-edit-body');
  body.innerHTML = '';

  const basic = editSection(body, 'テスト');
  basic.appendChild(labeled('名前', textInput(p.name, (v) => (p.name = v.trim()))));
  basic.appendChild(labeled('テスト日', textInput(p.testDate, (v) => (p.testDate = v), 'date')));
  basic.appendChild(labeled('計画の開始日', textInput(p.startDate, (v) => (p.startDate = v), 'date')));

  const range = editSection(body, '範囲', '教材ごとに、テスト範囲の量と周回数。重点の教科は、時間が足りないときに多く配ります');
  SUBJECTS.forEach((subject) => {
    const block = el('div', 'plan-subject');
    const head = el('div', 'plan-subject-head');
    head.appendChild(el('span', 'plan-subject-name', subject));
    const focused = p.focus.includes(subject);
    head.appendChild(
      makeChip('重点', focused, () => {
        p.focus = focused ? p.focus.filter((s) => s !== subject) : p.focus.concat(subject);
        renderPlanEdit();
      })
    );
    block.appendChild(head);

    const options = plannableMaterials(subject);
    p.items.forEach((it, index) => {
      if (it.subject !== subject) return;
      const row = el('div', 'plan-item');
      const usedByOthers = p.items.filter((x, i) => i !== index).map((x) => x.materialId);
      const sel = el('select', 'setting-select');
      options
        .filter((m) => m.id === it.materialId || !usedByOthers.includes(m.id))
        .forEach((m) => {
          const opt = el('option', null, m.label);
          opt.value = m.id;
          if (m.id === it.materialId) opt.selected = true;
          sel.appendChild(opt);
        });
      sel.addEventListener('change', () => {
        const m = options.find((x) => x.id === sel.value);
        Object.assign(it, { materialId: m.id, label: m.label, unit: m.unit, laps: defaultLaps(m.id, m.unit) });
        renderPlanEdit();
      });
      row.appendChild(sel);
      row.appendChild(makeNumberInput(it.amount, 1, 9999, (v) => (it.amount = v)));
      row.appendChild(el('span', 'plan-unit', it.unit));
      row.appendChild(makeNumberInput(it.laps, 1, 10, (v) => (it.laps = v)));
      row.appendChild(el('span', 'plan-unit', '周'));
      row.appendChild(
        smallButton('×', () => {
          p.items.splice(index, 1);
          renderPlanEdit();
        })
      );
      block.appendChild(row);
    });
    const free = options.filter((m) => !p.items.some((x) => x.materialId === m.id));
    if (free.length) {
      block.appendChild(
        smallButton('＋教材', () => {
          const m = free[0];
          p.items.push({ materialId: m.id, subject, label: m.label, unit: m.unit, amount: null, laps: defaultLaps(m.id, m.unit) });
          renderPlanEdit();
        })
      );
    }
    range.appendChild(block);
  });

  const time = editSection(body, '使える時間（曜日ごと）', 'テスト範囲の勉強に使える時間（分）。塾など、決まった教科にしか使えない枠は教科を選びます（選ばない＝どの教科でも）');
  WEEK_ORDER.forEach((wd) => {
    const block = el('div', 'plan-day');
    block.appendChild(el('span', 'plan-day-name', WEEKDAYS[wd]));
    const slots = el('div', 'plan-slots');
    p.week[wd].forEach((slot, si) => {
      const row = el('div', 'plan-slot');
      row.appendChild(makeNumberInput(slot.minutes, 0, 600, (v) => (slot.minutes = v || 0)));
      row.appendChild(el('span', 'plan-unit', '分'));
      const chips = el('div', 'chips chips-mini');
      SUBJECTS.forEach((s) => {
        const on = slot.subjects.includes(s);
        chips.appendChild(
          makeChip(s.slice(0, 1), on, () => {
            slot.subjects = on ? slot.subjects.filter((x) => x !== s) : slot.subjects.concat(s);
            renderPlanEdit();
          })
        );
      });
      row.appendChild(chips);
      row.appendChild(
        smallButton('×', () => {
          p.week[wd].splice(si, 1);
          renderPlanEdit();
        })
      );
      slots.appendChild(row);
    });
    slots.appendChild(
      smallButton('＋枠', () => {
        p.week[wd].push({ minutes: 30, subjects: [] });
        renderPlanEdit();
      })
    );
    block.appendChild(slots);
    time.appendChild(block);
  });
  const restOptions = ['なし'].concat(WEEK_ORDER.map((wd) => WEEKDAYS[wd]));
  const restValue = p.restDay === null ? 'なし' : WEEKDAYS[p.restDay];
  time.appendChild(
    labeled(
      '予備日',
      makeSelect(restOptions, restValue, (v) => {
        p.restDay = v === 'なし' ? null : WEEKDAYS.indexOf(v);
      })
    )
  );
  time.appendChild(el('div', 'field-note', '予備日は予定を入れず、遅れを取り戻す日にします'));

  const ex = editSection(body, '使えない日・少ない日', '大会・行事の日など。0分＝勉強しない日');
  p.exceptions.forEach((e, i) => {
    const row = el('div', 'plan-slot');
    row.appendChild(textInput(e.date, (v) => (e.date = v), 'date'));
    row.appendChild(makeNumberInput(e.minutes, 0, 600, (v) => (e.minutes = v || 0)));
    row.appendChild(el('span', 'plan-unit', '分'));
    row.appendChild(
      smallButton('×', () => {
        p.exceptions.splice(i, 1);
        renderPlanEdit();
      })
    );
    ex.appendChild(row);
  });
  ex.appendChild(
    smallButton('＋日を追加', () => {
      p.exceptions.push({ date: p.startDate, minutes: 0 });
      renderPlanEdit();
    })
  );

  const detail = editSection(body, '細かい設定');
  detail.appendChild(labeled('計画に使う割合（%）', makeNumberInput(Math.round(p.margin * 100), 50, 100, (v) => (p.margin = (v || 80) / 100))));
  detail.appendChild(el('div', 'field-note', '計画はたいてい遅れるので、使える時間の一部だけを計画に使います'));
  detail.appendChild(labeled('1周目の正答率の見込み（%）', makeNumberInput(Math.round(p.firstAccuracy * 100), 10, 95, (v) => (p.firstAccuracy = (v || 60) / 100))));
  detail.appendChild(el('div', 'field-note', '2周目（×だけ）の量の見込みに使います。記録がたまると、記録の正答率を使います'));
}

function validatePlan(p) {
  if (!p.name) return 'テストの名前を入れてください';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.testDate) || !/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) return '日付を入れてください';
  if (p.startDate >= p.testDate) return '開始日はテスト日より前にしてください';
  if (!p.items.length) return '範囲の教材を1つ以上入れてください';
  if (p.items.some((it) => !(it.amount > 0))) return '範囲の量が入っていない教材があります';
  if (p.items.some((it) => !(it.laps >= 1 && it.laps <= 10))) return '周回数は1〜10にしてください';
  if (p.exceptions.some((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.date))) return '使えない日の日付を入れてください';
  return null;
}

$('btn-plan-save').addEventListener('click', () => {
  const error = validatePlan(editingPlan);
  $('plan-edit-error').hidden = !error;
  $('plan-edit-error').textContent = error || '';
  if (error) return;
  editingPlan.exceptions.sort((a, b) => (a.date < b.date ? -1 : 1));
  savePlan(editingPlan);
  kickSync();
  openPlanResult(editingPlan.id);
});

// --- 結果 ---
function openPlanResult(id) {
  viewingPlanId = id;
  renderPlanResult();
  showScreen('screen-plan-result');
}

$('btn-plan-edit').addEventListener('click', () => {
  const p = findPlan(viewingPlanId);
  if (p) openPlanEdit(p);
});

$('btn-plan-delete').addEventListener('click', () => {
  const p = findPlan(viewingPlanId);
  if (!p || !confirm(`「${p.name}」の計画を削除しますか？`)) return;
  markPlanDeleted(p.id);
  kickSync();
  openPlans();
});

function card(body, title) {
  const c = el('div', 'plan-card');
  if (title) c.appendChild(el('h3', 'plan-heading', title));
  body.appendChild(c);
  return c;
}

function itemName(result, index) {
  const it = result.items[index];
  return `${it.subject} ${it.label}`;
}

function progressBar(ratio) {
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill');
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  track.appendChild(fill);
  return track;
}

function renderPlanResult() {
  const plan = findPlan(viewingPlanId);
  const body = $('plan-result-body');
  body.innerHTML = '';
  if (!plan || plan.deleted) {
    $('plan-result-title').textContent = '学習計画';
    body.appendChild(el('div', 'field-note', 'この計画は削除されました'));
    return;
  }
  const today = todayStr();
  const result = computePlan(plan, loadActiveRecords(), today);
  $('plan-result-title').textContent = plan.name;

  renderPlanStatus(body, result, today);
  renderTimeline(body, result, today);
  renderWeekTargets(body, result, today);
  renderDayTargets(body, result, today);
  renderItemProgress(body, result);
  renderDayChart(body, result, today);
  renderCumulativeChart(body, result, today);
  renderPlanBasis(body, result);
}

function renderPlanStatus(body, result, today) {
  const c = card(body);
  const left = daysUntil(today, result.plan.testDate);
  c.appendChild(el('div', 'plan-big', left > 0 ? `テストまで あと${left}日（${displayDate(result.plan.testDate)}）` : `テスト日：${displayDate(result.plan.testDate)}`));
  if (result.feasible) {
    c.appendChild(el('div', 'plan-ok', '使える時間の中に入ります'));
    c.appendChild(el('div', 'field-note', `締切：1周目 ${shortDate(result.deadlines[1])}／解き直し ${shortDate(result.deadlines[2])}／仕上げ ${shortDate(result.deadlines[3])}（早く終われば前倒しで進みます）`));
  } else {
    result.phases
      .filter((p) => p.shortage >= 1)
      .forEach((p) => c.appendChild(el('div', 'plan-short', `${PHASE_LABELS[p.phase]}の締切（${shortDate(p.deadline)}）までに、時間が${aboutMinutes(p.shortage)}足りません`)));
    c.appendChild(el('div', 'field-note', '次のどれかで計画を直すと入りやすくなります'));
    const list = el('ul', 'plan-list');
    result.suggestions.forEach((s) => {
      let text = '';
      if (s.type === 'laps') text = `${itemName(result, s.item)}を${result.items[s.item].laps}周→${result.items[s.item].laps - 1}周にする（${aboutMinutes(s.minutes)}減る）`;
      const until = shortDate(result.deadlines[s.phase]);
      if (s.type === 'weekend') text = `${until}までの土日を30分ずつ増やす（${aboutMinutes(s.minutes)}増える）`;
      if (s.type === 'rest') text = `${until}までの予備日も使う（${aboutMinutes(s.minutes)}増える）`;
      list.appendChild(el('li', null, text));
    });
    c.appendChild(list);
  }
  if (result.lag.behind) {
    c.appendChild(el('div', 'plan-note', '予定より少し遅れているので、今日からの予定を組み直しました（1日の量は元の2割増しまで）'));
    if (result.lag.usedRest) c.appendChild(el('div', 'plan-note', '予備日も使っています'));
    if (result.lag.unplaced >= 1) c.appendChild(el('div', 'plan-note', `入りきらない分が${aboutMinutes(result.lag.unplaced)}あります。計画を直すか、予備日で取り戻しましょう`));
  }
}

// テストまでの線表：期の区切りと今日の位置
function renderTimeline(body, result, today) {
  const c = card(body, 'テストまでの流れ');
  const start = result.plan.startDate;
  const end = result.plan.testDate;
  const total = Math.max(1, daysUntil(start, end));
  const W = 320;
  const x = (d) => (Math.min(total, Math.max(0, daysUntil(start, d))) / total) * W;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} 54`, class: 'plan-svg', role: 'img', 'aria-label': 'テストまでの流れ' });
  [1, 2, 3].forEach((p) => {
    const r = result.ranges[p];
    if (r.empty) return;
    const x0 = x(r.from);
    const x1 = x(shiftDate(r.to, 1));
    svg.appendChild(svgEl('rect', { x: x0, y: 14, width: Math.max(1, x1 - x0), height: 18, rx: 4, class: `phase phase-${p}` }));
    const label = svgEl('text', { x: (x0 + x1) / 2, y: 27, class: 'phase-label', 'text-anchor': 'middle' });
    label.textContent = PHASE_LABELS[p];
    svg.appendChild(label);
  });
  if (today >= start && today <= end) {
    const tx = x(today);
    svg.appendChild(svgEl('line', { x1: tx, y1: 8, x2: tx, y2: 38, class: 'today-line' }));
    const t = svgEl('text', { x: tx, y: 50, class: 'axis-label', 'text-anchor': 'middle' });
    t.textContent = '今日';
    svg.appendChild(t);
  }
  const s = svgEl('text', { x: 0, y: 9, class: 'axis-label' });
  s.textContent = shortDate(start);
  svg.appendChild(s);
  const e = svgEl('text', { x: W, y: 9, class: 'axis-label', 'text-anchor': 'end' });
  e.textContent = `テスト ${shortDate(end)}`;
  svg.appendChild(e);
  c.appendChild(svg);
}

function renderWeekTargets(body, result, today) {
  const weekStart = startOfWeekStr(parseDate(today));
  const c = card(body, `今週の目標（${shortDate(weekStart)}〜${shortDate(shiftDate(weekStart, 6))}）`);
  const list = weekTargets(result, weekStart).filter((x) => x.amount > 0.05);
  if (!list.length) {
    c.appendChild(el('div', 'field-note', '今週の予定はありません'));
    return;
  }
  list.forEach((x) => {
    const it = result.items[x.item];
    const goal = roundAmount(x.amount);
    const row = el('div', 'plan-target');
    row.appendChild(el('div', 'plan-target-main', `${itemName(result, x.item)}　${goal}${it.unit}（${lapText(x.laps)}）`));
    row.appendChild(progressBar(x.done / Math.max(goal, 1)));
    row.appendChild(el('div', 'plan-target-sub', `やった量 ${Math.round(x.done)}${it.unit}　目安 ${aboutMinutes(x.minutes)}`));
    c.appendChild(row);
  });
}

function renderDayTargets(body, result, today) {
  const c = card(body, '今日・明日の目安');
  [today, shiftDate(today, 1)].forEach((d, i) => {
    const list = dayTargets(result, d).filter((x) => x.amount > 0.05);
    const day = result.schedule.find((s) => s.date === d);
    let text;
    if (!day) text = 'なし';
    else if (day.rest && !list.length) text = '予備日';
    else if (!list.length) text = 'なし';
    else text = list.map((x) => `${itemName(result, x.item)} ${roundAmount(x.amount)}${result.items[x.item].unit}`).join('、');
    const row = el('div', 'plan-day-target');
    row.appendChild(el('span', 'plan-day-when', `${i === 0 ? '今日' : '明日'} ${displayDate(d)}`));
    row.appendChild(el('span', null, text));
    c.appendChild(row);
  });
}

// 教材ごとの進捗：全体（範囲×周回）の中で、周回ごとに色の濃さを変える
function renderItemProgress(body, result) {
  const c = card(body, '教材ごとの進み具合');
  result.items.forEach((it, i) => {
    const laps = result.progress.perItem[i].laps;
    const total = laps.reduce((a, l) => a + l.amount, 0);
    const done = laps.reduce((a, l) => a + l.done, 0);
    const row = el('div', 'plan-target');
    row.appendChild(el('div', 'plan-target-main', `${itemName(result, i)}　${Math.round(done)} / ${Math.round(total)}${it.unit}`));
    const track = el('div', 'lap-track');
    laps.forEach((l) => {
      const seg = el('div', `lap-seg lap-${Math.min(l.lap, 3)}`);
      seg.style.width = `${(l.amount / Math.max(total, 1e-9)) * 100}%`;
      const fill = el('div', 'lap-fill');
      fill.style.width = `${(l.done / Math.max(l.amount, 1e-9)) * 100}%`;
      seg.appendChild(fill);
      track.appendChild(seg);
    });
    row.appendChild(track);
    row.appendChild(el('div', 'plan-target-sub', laps.map((l) => `${l.lap}周目 ${roundAmount(l.amount)}${it.unit}`).join('　')));
    c.appendChild(row);
  });
  c.appendChild(el('div', 'field-note', '記録からは何周目か分からないため、やった量を1周目から順に埋めています'));
}

// 日ごとの使える時間（枠）と予定の時間（中身）
function renderDayChart(body, result, today) {
  const c = card(body, '日ごとの予定');
  const max = Math.max(1, ...result.schedule.map((d) => Math.max(d.rawMinutes * result.plan.margin, d.minutes)));
  const chart = el('div', 'day-chart');
  result.schedule.forEach((d) => {
    const col = el('div', 'day-col' + (d.date === today ? ' is-today' : ''));
    const box = el('div', 'day-box');
    const cap = el('div', 'day-cap' + (d.rest ? ' is-rest' : ''));
    cap.style.height = `${((d.rest ? d.rawMinutes * result.plan.margin : d.capacity) / max) * 100}%`;
    const used = el('div', 'day-used' + (d.minutes > d.capacity + 1 ? ' is-over' : ''));
    used.style.height = `${(d.minutes / max) * 100}%`;
    box.appendChild(cap);
    box.appendChild(used);
    col.appendChild(box);
    const mark = d.rest ? '予' : d.exception !== null ? '★' : '';
    col.appendChild(el('div', 'day-label', `${parseDate(d.date).getDate()}${mark}`));
    chart.appendChild(col);
  });
  c.appendChild(chart);
  c.appendChild(el('div', 'field-note', '薄い枠＝使える時間、濃い色＝予定。予＝予備日、★＝使えない日・少ない日'));
}

// 累積の計画（点線）と実績（実線）。単位がそろわないので時間に換算して足す
function renderCumulativeChart(body, result, today) {
  const c = card(body, '計画と実績（累積）');
  const pts = result.progress.cumulative;
  if (!pts.length) return;
  const W = 320;
  const H = 140;
  const pad = 18;
  const max = Math.max(1, ...pts.map((p) => Math.max(p.planned, p.actual || 0)));
  const x = (i) => pad + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - pad * 2));
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plan-svg', role: 'img', 'aria-label': '計画と実績' });
  svg.appendChild(svgEl('line', { x1: pad, y1: H - pad, x2: W - pad, y2: H - pad, class: 'axis' }));
  svg.appendChild(svgEl('polyline', { points: pts.map((p, i) => `${x(i)},${y(p.planned)}`).join(' '), class: 'line-plan' }));
  const actual = pts.map((p, i) => (p.actual === null ? null : `${x(i)},${y(p.actual)}`)).filter(Boolean);
  if (actual.length) svg.appendChild(svgEl('polyline', { points: actual.join(' '), class: 'line-actual' }));
  const ti = pts.findIndex((p) => p.date === today);
  if (ti >= 0) svg.appendChild(svgEl('line', { x1: x(ti), y1: pad, x2: x(ti), y2: H - pad, class: 'today-line' }));
  [0, pts.length - 1].forEach((i) => {
    const t = svgEl('text', { x: x(i), y: H - 4, class: 'axis-label', 'text-anchor': i ? 'end' : 'start' });
    t.textContent = shortDate(pts[i].date);
    svg.appendChild(t);
  });
  c.appendChild(svg);
  c.appendChild(el('div', 'field-note', '点線＝計画、実線＝やった量（どちらも時間に換算して累積）'));
}

function renderPlanBasis(body, result) {
  const c = card(body, '計算に使った値');
  result.items.forEach((it) => {
    const pace = it.pace.estimated ? `記録から ${it.pace.pace.toFixed(1)}分/${it.unit}（${it.pace.samples}件）` : `仮の値 ${it.pace.pace}分/${it.unit}`;
    c.appendChild(el('div', 'plan-target-sub', `${it.subject} ${it.label}：${pace}、正答率 ${Math.round(it.accuracy * 100)}%`));
  });
  c.appendChild(el('div', 'plan-target-sub', `計画に使う割合 ${Math.round(result.plan.margin * 100)}%`));
}
