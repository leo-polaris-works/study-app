// 学習計画の画面：一覧・編集・結果（グラフ）。計算は plan.js、保存は data.js・sync.js。

const SVG_NS = 'http://www.w3.org/2000/svg';

let editingPlan = null;
let viewingPlanId = null;
let lapForm = null; // 「○周目が終わった」の入力中 { item, lap }

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
  return laps.map((l) => `${l}周目`).join('・');
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

// 日付が変わって対象の月が変わったら、月ごとの割合を初期値に戻す
function syncPlanMonths(p) {
  const months = planMonths(p.startDate, p.testDate).map((m) => m.month);
  const current = (p.months || []).map((m) => m.month);
  if (months.join() !== current.join()) p.months = defaultPlanMonths(p.startDate, p.testDate);
}

function monthTotal(p) {
  return (p.months || []).reduce((a, m) => a + (m.percent || 0), 0);
}

function renderPlanEdit() {
  const p = editingPlan;
  const body = $('plan-edit-body');
  body.innerHTML = '';
  const onDate = (key) => (v) => {
    p[key] = v;
    syncPlanMonths(p);
    renderPlanEdit();
  };

  const basic = editSection(body, 'テスト');
  basic.appendChild(labeled('名前', textInput(p.name, (v) => (p.name = v.trim()))));
  basic.appendChild(labeled('テスト日', textInput(p.testDate, onDate('testDate'), 'date')));
  basic.appendChild(labeled('計画の開始日', textInput(p.startDate, onDate('startDate'), 'date')));

  const range = editSection(body, '範囲', '教材ごとに、テスト範囲の量と周回数');
  SUBJECTS.forEach((subject) => {
    const block = el('div', 'plan-subject');
    block.appendChild(el('div', 'plan-subject-name', subject));
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
        Object.assign(it, { materialId: m.id, label: m.label, unit: m.unit, laps: defaultLaps(m.id, m.unit), lapMarks: [] });
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
          p.items.push({ materialId: m.id, subject, label: m.label, unit: m.unit, amount: null, laps: defaultLaps(m.id, m.unit), lapMarks: [] });
          renderPlanEdit();
        })
      );
    }
    range.appendChild(block);
  });

  const monthsSec = editSection(body, '月ごとの割合', '範囲×周回の全体を、月ごとにどれだけ進めるか（%）。テストに近い月ほど多めにしてあります');
  const months = planMonths(p.startDate, p.testDate);
  const sum = el('div', 'plan-sum');
  const showSum = () => {
    const t = monthTotal(p);
    sum.textContent = `合計 ${t}%` + (t === 100 ? '' : '（100%にしてください）');
    sum.classList.toggle('warn', t !== 100);
  };
  months.forEach((m) => {
    const entry = p.months.find((x) => x.month === m.month);
    const label = `${monthLabel(m.month)}（${shortDate(m.from)}〜${shortDate(m.to)}・${m.days}日）`;
    const input = makeNumberInput(entry.percent, 0, 100, (v) => {
      entry.percent = v || 0;
      showSum();
    });
    const row = labeled(label, input);
    row.appendChild(el('span', 'plan-unit', '%'));
    monthsSec.appendChild(row);
  });
  showSum();
  monthsSec.appendChild(sum);
  monthsSec.appendChild(
    smallButton('初期値に戻す', () => {
      p.months = defaultPlanMonths(p.startDate, p.testDate);
      renderPlanEdit();
    })
  );

  const detail = editSection(body, '細かい設定');
  detail.appendChild(labeled('1周目の正答率の見込み（%）', makeNumberInput(Math.round(p.firstAccuracy * 100), 10, 95, (v) => (p.firstAccuracy = (v || 60) / 100))));
  detail.appendChild(el('div', 'field-note', '2周目（×だけ）の量の見込みに使います。記録がたまると記録の正答率を、1周目を「終わった」にして×の量を入れるとその量を使います'));
}

function validatePlan(p) {
  if (!p.name) return 'テストの名前を入れてください';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.testDate) || !/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) return '日付を入れてください';
  if (p.startDate >= p.testDate) return '開始日はテスト日より前にしてください';
  if (!p.items.length) return '範囲の教材を1つ以上入れてください';
  if (p.items.some((it) => !(it.amount > 0))) return '範囲の量が入っていない教材があります';
  if (p.items.some((it) => !(it.laps >= 1 && it.laps <= 10))) return '周回数は1〜10にしてください';
  if (monthTotal(p) !== 100) return '月ごとの割合を、合計100%にしてください';
  return null;
}

$('btn-plan-save').addEventListener('click', () => {
  const error = validatePlan(editingPlan);
  $('plan-edit-error').hidden = !error;
  $('plan-edit-error').textContent = error || '';
  if (error) return;
  editingPlan.items.forEach((it) => (it.lapMarks = (it.lapMarks || []).filter((m) => m.lap < it.laps)));
  savePlan(editingPlan);
  kickSync();
  openPlanResult(editingPlan.id);
});

// --- 結果 ---
function openPlanResult(id) {
  viewingPlanId = id;
  lapForm = null;
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
  renderItemProgress(body, result, today);
  renderWeekChart(body, result, today);
  renderCumulativeChart(body, result, today);
  renderPlanBasis(body, result);
}

function renderPlanStatus(body, result, today) {
  const c = card(body);
  const left = daysUntil(today, result.plan.testDate);
  c.appendChild(el('div', 'plan-big', left > 0 ? `テストまで あと${left}日（${displayDate(result.plan.testDate)}）` : `テスト日：${displayDate(result.plan.testDate)}`));
  if (result.warnings.length) {
    c.appendChild(el('div', 'plan-short', 'この割合のままだと、目安の日に間に合わない周があります'));
    const list = el('ul', 'plan-list');
    result.warnings.forEach((w) => {
      list.appendChild(el('li', null, `${itemName(result, w.item)}の${w.lap}周目：終わるのは${shortDate(w.finish)}ごろ（目安 ${shortDate(w.deadline)}まで）`));
    });
    c.appendChild(list);
    c.appendChild(el('div', 'field-note', '前の月の割合を増やすと早く終わります'));
  } else {
    c.appendChild(el('div', 'plan-ok', `1周目はテスト${PLAN_DEFAULTS.phase1Days}日前、解き直しは${PLAN_DEFAULTS.phase2Days}日前までに終わる割合です`));
  }
  if (result.behind.length) {
    const names = result.behind.map((b) => `${itemName(result, b.item)}（約${roundAmount(b.deficit)}${result.items[b.item].unit}）`).join('、');
    c.appendChild(el('div', 'plan-note', `予定より遅れている教材：${names}。今月の残りの日に分けました`));
  }
}

// テストまでの流れ：月ごとの割合と、1周目の目安・今日
function renderTimeline(body, result, today) {
  const c = card(body, 'テストまでの流れ');
  const start = result.plan.startDate;
  const end = result.plan.testDate;
  const total = Math.max(1, daysUntil(start, end));
  const W = 320;
  const x = (d) => (Math.min(total, Math.max(0, daysUntil(start, d))) / total) * W;
  // 端に近いラベルは、はみ出さないよう内側へ寄せる
  const anchor = (px) => (px < 24 ? 'start' : px > W - 24 ? 'end' : 'middle');
  const svg = svgEl('svg', { viewBox: `0 0 ${W} 66`, class: 'plan-svg', role: 'img', 'aria-label': 'テストまでの流れ' });
  const max = Math.max(1, ...result.months.map((m) => m.percent / m.days));
  result.months.forEach((m) => {
    const x0 = x(m.from);
    const x1 = x(shiftDate(m.to, 1));
    const shade = 0.25 + 0.75 * (m.percent / m.days / max);
    svg.appendChild(svgEl('rect', { x: x0 + 0.5, y: 14, width: Math.max(1, x1 - x0 - 1), height: 20, rx: 4, class: 'month-band', 'fill-opacity': shade.toFixed(2) }));
    const label = svgEl('text', { x: (x0 + x1) / 2, y: 28, class: 'phase-label', 'text-anchor': 'middle' });
    label.textContent = x1 - x0 > 46 ? `${monthLabel(m.month)} ${m.percent}%` : `${m.percent}%`;
    svg.appendChild(label);
  });
  const d1 = result.deadlines[1];
  if (d1 > start) {
    const dx = x(shiftDate(d1, 1));
    svg.appendChild(svgEl('line', { x1: dx, y1: 10, x2: dx, y2: 38, class: 'deadline-line' }));
    const t = svgEl('text', { x: dx, y: 50, class: 'axis-label', 'text-anchor': anchor(dx) });
    t.textContent = '1周目まで';
    svg.appendChild(t);
  }
  if (today >= start && today <= end) {
    const tx = x(today);
    svg.appendChild(svgEl('line', { x1: tx, y1: 8, x2: tx, y2: 40, class: 'today-line' }));
    const t = svgEl('text', { x: tx, y: 9, class: 'axis-label', 'text-anchor': anchor(tx) });
    t.textContent = '今日';
    svg.appendChild(t);
  }
  // テスト日は「1周目まで」と重ならないよう、下の段に置く
  const e = svgEl('text', { x: W, y: 63, class: 'axis-label', 'text-anchor': 'end' });
  e.textContent = `テスト ${shortDate(end)}`;
  svg.appendChild(e);
  c.appendChild(svg);
  c.appendChild(el('div', 'field-note', '色が濃い月ほど、1日あたりの量が多い'));
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
    const text = list.length ? list.map((x) => `${itemName(result, x.item)} ${roundAmount(x.amount)}${result.items[x.item].unit}`).join('、') : 'なし';
    const row = el('div', 'plan-day-target');
    row.appendChild(el('span', 'plan-day-when', `${i === 0 ? '今日' : '明日'} ${displayDate(d)}`));
    row.appendChild(el('span', null, text));
    c.appendChild(row);
  });
}

// 「○周目が終わった」を保存する。ワーク等は、次の周でやる量（×の数）も入れられる
function saveLapMark(itemIndex, lap, nextAmount) {
  const plan = findPlan(viewingPlanId);
  const it = plan.items[itemIndex];
  it.lapMarks = (it.lapMarks || []).filter((m) => m.lap < lap);
  it.lapMarks.push({ lap, date: todayStr(), nextAmount });
  savePlan(plan);
  kickSync();
  lapForm = null;
  renderPlanResult();
}

function undoLapMark(itemIndex) {
  const plan = findPlan(viewingPlanId);
  const it = plan.items[itemIndex];
  const last = (it.lapMarks || [])[it.lapMarks.length - 1];
  if (!last || !confirm(`${it.label}の${last.lap}周目の「終わった」を取り消しますか？`)) return;
  it.lapMarks.pop();
  savePlan(plan);
  kickSync();
  renderPlanResult();
}

function renderLapControls(row, result, i) {
  const it = result.items[i];
  const next = it.lapList.find((l) => !l.marked);
  const box = el('div', 'lap-actions');
  if (lapForm && lapForm.item === i && next) {
    const after = it.lapList.find((l) => l.lap === next.lap + 1);
    let input = null;
    if (after && planItemKind(it.unit) === 'drill') {
      box.appendChild(el('span', 'plan-unit', `${after.lap}周目でやる量（×の数）`));
      input = makeNumberInput(null, 0, 9999, () => {});
      input.placeholder = String(roundAmount(after.amount));
      box.appendChild(input);
      box.appendChild(el('span', 'plan-unit', it.unit));
    }
    box.appendChild(
      smallButton('決定', () => {
        const v = input && input.value !== '' ? parseInt(input.value, 10) : null;
        saveLapMark(i, next.lap, Number.isFinite(v) ? v : null);
      })
    );
    box.appendChild(
      smallButton('やめる', () => {
        lapForm = null;
        renderPlanResult();
      })
    );
  } else {
    if (next) {
      box.appendChild(
        smallButton(`${next.lap}周目が終わった`, () => {
          lapForm = { item: i };
          renderPlanResult();
        })
      );
    } else box.appendChild(el('span', 'plan-unit', 'すべての周が終わりました'));
    if ((result.plan.items[i].lapMarks || []).length) box.appendChild(smallButton('取り消す', () => undoLapMark(i), 'btn-link'));
  }
  row.appendChild(box);
}

// 教材ごとの進み具合：全体（範囲×周回）の中で、周回ごとに色の濃さを変える
function renderItemProgress(body, result) {
  const c = card(body, '教材ごとの進み具合');
  result.items.forEach((it, i) => {
    const laps = it.lapsNow;
    const row = el('div', 'plan-target');
    row.appendChild(el('div', 'plan-target-main', `${itemName(result, i)}　${Math.round(it.doneNow)} / ${Math.round(it.total)}${it.unit}`));
    const track = el('div', 'lap-track');
    laps.forEach((l) => {
      const seg = el('div', `lap-seg lap-${Math.min(l.lap, 3)}`);
      seg.style.width = `${(l.amount / Math.max(it.total, 1e-9)) * 100}%`;
      const fill = el('div', 'lap-fill');
      fill.style.width = `${(l.done / Math.max(l.amount, 1e-9)) * 100}%`;
      seg.appendChild(fill);
      track.appendChild(seg);
    });
    row.appendChild(track);
    row.appendChild(el('div', 'plan-target-sub', laps.map((l) => `${l.lap}周目 ${roundAmount(l.amount)}${it.unit}${l.marked ? ' ✓' : ''}`).join('　')));
    renderLapControls(row, result, i);
    c.appendChild(row);
  });
  c.appendChild(el('div', 'field-note', '周が終わったらボタンを押します（✓）。押していない周は、やった量を順に埋めて推定しています'));
}

// 週ごとの目安時間（量×ペース）。テストに近づくほど増えるか
function renderWeekChart(body, result, today) {
  const c = card(body, '週ごとの目安時間');
  const weeks = weeklyMinutes(result);
  const max = Math.max(1, ...weeks.map((w) => w.minutes));
  const thisWeek = startOfWeekStr(parseDate(today));
  const chart = el('div', 'week-chart');
  weeks.forEach((w) => {
    const col = el('div', 'week-col' + (w.start === thisWeek ? ' is-today' : ''));
    col.appendChild(el('div', 'week-value', formatMinutes(Math.round(w.minutes / 10) * 10)));
    const box = el('div', 'day-box');
    const used = el('div', 'day-used');
    used.style.height = `${(w.minutes / max) * 100}%`;
    box.appendChild(used);
    col.appendChild(box);
    col.appendChild(el('div', 'day-label', shortDate(w.start)));
    chart.appendChild(col);
  });
  c.appendChild(chart);
  c.appendChild(el('div', 'field-note', '週の予定の量×1単位あたりの時間（参考）。日付は週の月曜'));
}

// 累積の計画（点線）と実績（実線）。単位がそろわないので時間に換算して足す
function renderCumulativeChart(body, result, today) {
  const c = card(body, '計画と実績（累積）');
  const pts = result.cumulative;
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
}
