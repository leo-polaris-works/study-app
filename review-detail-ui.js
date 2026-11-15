// 振り返りの画面：月・テストまで（期間×観点）と、今週と共通の観点の表示。計算は review.js・plan.js。

let detailPeriod = 'month'; // month＝月／test＝テストまで（計画があるときだけ）。振り返りのタブで決まる
let detailAnchor = null; // 見ている期間に含まれる日
let detailView = 'subject'; // subject＝教科／field＝学習内容／amount＝量／issue＝課題。今週・月・テストまでで共通
let detailPlanId = null; // 「テストまで」で見ている計画

function resetReviewDetail() {
  detailAnchor = todayStr();
  detailPlanId = null;
}

// 「テストまで」で選べる計画（テスト日の順）
function detailPlans() {
  return loadActivePlans().sort((a, b) => (a.testDate < b.testDate ? -1 : a.testDate > b.testDate ? 1 : 0));
}

// 最初は、今かかっている計画。なければ、いちばん最近に始まったもの
function currentDetailPlan(plans, today) {
  return plans.find((p) => p.id === detailPlanId) || planForRange(plans, today, today) || plans.filter((p) => p.startDate <= today).pop() || plans[0] || null;
}

function detailLabel(range, today, plan) {
  if (range.kind === 'test') return `${plan.name} ${shortDate(range.from)}〜${shortDate(range.to)}`;
  const now = range.from <= today && today <= range.to;
  return `${now ? '今月 ' : ''}${Number(range.from.slice(0, 4))}年${Number(range.from.slice(5, 7))}月`;
}

// ‹ ›：月は前後の月へ、テストまでは前後の計画へ
function moveReviewDetail(dir) {
  const today = todayStr();
  if (detailPeriod === 'test') {
    const plans = detailPlans();
    const next = plans[plans.indexOf(currentDetailPlan(plans, today)) + dir];
    if (next) detailPlanId = next.id;
  } else {
    const moved = detailRange(detailPeriod, shiftDetailAnchor(detailRange(detailPeriod, detailAnchor), dir));
    detailAnchor = moved.from <= today && today <= moved.to ? today : moved.from;
  }
  renderReview();
}

$('btn-detail-prev').addEventListener('click', () => moveReviewDetail(-1));
$('btn-detail-next').addEventListener('click', () => moveReviewDetail(1));

function renderReviewDetail(period) {
  const today = todayStr();
  if (!detailAnchor || detailAnchor > today) detailAnchor = today;
  const plans = detailPlans();
  detailPeriod = period === 'test' && plans.length ? 'test' : 'month';

  const testPlan = detailPeriod === 'test' ? currentDetailPlan(plans, today) : null;
  const range = detailRange(detailPeriod, detailAnchor, testPlan);
  const plan = testPlan || planForRange(plans, range.from, range.to);
  $('detail-range-label').textContent = detailLabel(range, today, testPlan);
  $('btn-detail-prev').disabled = testPlan ? plans.indexOf(testPlan) <= 0 : range.from <= firstReviewDate();
  $('btn-detail-next').disabled = testPlan ? plans.indexOf(testPlan) >= plans.length - 1 : range.to >= today;

  const records = loadActiveRecords();
  const list = recordsBetween(records, range.from, range.to);
  const body = $('review-detail-body');
  body.innerHTML = '';
  const sync = getSyncSummary();
  if (!sync.localTest && (reviewRangeFailed || sync.error)) body.appendChild(el('div', 'field-note', LOCAL_ONLY_NOTE));
  renderTrend(body, records, range, today, list);
  renderDetailViews(body, records, list, range, plan, today);
  requestReviewRange(range.prev ? range.prev.from : range.from, range.to, plan);
}

function subjectFill(subject) {
  return `subj-fill-${SUBJECTS.indexOf(subject)}`;
}

function subjectBar(ratio, subject) {
  const track = progressBar(ratio);
  track.firstChild.classList.add(subjectFill(subject));
  return track;
}

// 推移グラフ：時間を教科で積み上げた縦棒（週ごと）
function renderTrend(body, records, range, today, list) {
  const c = card(body);
  const head = el('div', 'review-head');
  head.appendChild(el('h3', 'plan-heading', '勉強した時間'));
  if (list.length) head.appendChild(el('span', 'review-facts', `${new Set(list.map((r) => r.date)).size}日・${formatMinutes(totalMinutesOf(list))}`));
  c.appendChild(head);

  const buckets = trendBuckets(records, range, today);
  const max = Math.max(1, ...buckets.map((b) => b.minutes));
  const chart = el('div', 'trend');
  buckets.forEach((b) => {
    const col = el('div', 'trend-col' + (b.current ? ' is-today' : '') + (b.future ? ' is-future' : ''));
    col.appendChild(el('div', 'trend-value', b.minutes ? String(b.minutes) : ''));
    const box = el('div', 'trend-box');
    SUBJECTS.forEach((s) => {
      if (!b.bySubject[s]) return;
      const seg = el('div', `trend-seg ${subjectFill(s)}`);
      seg.style.height = `${(b.bySubject[s] / max) * 100}%`;
      box.appendChild(seg);
    });
    col.appendChild(box);
    col.appendChild(el('div', 'trend-label', shortDate(b.from)));
    chart.appendChild(col);
  });
  c.appendChild(chart);

  const legend = el('div', 'trend-legend');
  SUBJECTS.forEach((s) => {
    const x = el('span', 'trend-legend-item');
    x.appendChild(el('span', `trend-dot ${subjectFill(s)}`));
    x.appendChild(el('span', null, s));
    legend.appendChild(x);
  });
  c.appendChild(legend);
  c.appendChild(el('div', 'field-note', '棒は週ごと（日付は週のはじめ）。棒の上の数字は分'));
}

// 観点を「教科／学習内容／量／課題」で切り替える（今週・月・テストまで）
function renderDetailViews(body, records, list, range, plan, today) {
  const c = card(body);
  const sw = el('div', 'seg-group review-switch detail-switch');
  renderSegmented(
    sw,
    [
      ['subject', '教科'],
      ['field', '学習内容'],
      ['amount', '量'],
      ['issue', '課題'],
    ],
    detailView,
    (v) => {
      detailView = v;
      renderReview();
    }
  );
  c.appendChild(sw);
  if (detailView === 'amount') renderDetailAmounts(c, detailAmounts(records, range, plan, today), range, today);
  else if (!list.length) c.appendChild(el('div', 'field-note', 'この期間の記録はまだありません'));
  else if (detailView === 'field') renderDetailFields(c, detailByField(list));
  else if (detailView === 'issue') renderIssues(c, issueSummary(list));
  else renderDetailSubjects(c, list);
}

// 教科：時間（横棒）・記録数・正答率の目安と、やったことの内訳（100%の帯）
function renderDetailSubjects(c, list) {
  const rows = detailBySubject(list);
  const max = Math.max(1, ...rows.map((x) => x.minutes));
  rows.forEach((x) => {
    const row = el('div', 'subj-row');
    row.appendChild(subjectTag(x.subject, x.subject));
    row.appendChild(subjectBar(x.minutes / max, x.subject));
    row.appendChild(el('span', 'subj-row-value', x.count ? formatMinutes(x.minutes) : '—'));
    c.appendChild(row);
    if (!x.count) return;
    const about = x.accuracy ? `・正答率 ${x.accuracy.label}${/%$/.test(x.accuracy.label) ? 'くらい' : ''}` : '';
    c.appendChild(el('div', 'subj-row-sub', `${x.count}回${about}`));
  });

  c.appendChild(el('h4', 'review-subheading', 'やったことの内訳'));
  const acts = activityBreakdown(list);
  const total = Math.max(1, totalMinutesOf(list));
  const band = el('div', 'act-band');
  const shade = (i) => `act-${Math.min(i, 5)}`;
  acts.forEach((a, i) => {
    const seg = el('div', shade(i));
    seg.style.width = `${(a.minutes / total) * 100}%`;
    band.appendChild(seg);
  });
  c.appendChild(band);
  acts.forEach((a, i) => {
    const row = el('div', 'act-row');
    row.appendChild(el('span', `trend-dot ${shade(i)}`));
    row.appendChild(el('span', 'act-row-name', a.label));
    row.appendChild(el('span', 'act-row-value', formatMinutes(a.minutes)));
    c.appendChild(row);
  });
  c.appendChild(el('div', 'field-note', '記録した内容から出しています。正答率は、記録した回のまん中の段階'));
}

function detailSubjectHead(c, subject, text) {
  const head = el('div', 'detail-subject');
  head.appendChild(subjectTag(subject, subject));
  if (text) head.appendChild(el('span', 'detail-subject-total', text));
  c.appendChild(head);
}

// 学習内容：教科ごとに、分野ごとの時間（横棒・多い順）
function renderDetailFields(c, groups) {
  const max = Math.max(1, ...groups.map((g) => g.fields[0].minutes));
  groups.forEach((g) => {
    detailSubjectHead(c, g.subject, formatMinutes(g.minutes));
    g.fields.forEach((f) => {
      const row = el('div', 'field-row');
      row.appendChild(el('span', 'field-row-name', f.label));
      row.appendChild(subjectBar(f.minutes / max, g.subject));
      row.appendChild(el('span', 'field-row-value', formatMinutes(f.minutes)));
      c.appendChild(row);
    });
  });
}

// 量：教科ごとに、教材ごとの量。計画にある教材は予定と並べる（「あと○」。テストまでは周ごと）。計画にない教材は、やった量と前の週・月
function renderDetailAmounts(c, data, range, today) {
  const plan = data.plan;
  if (plan) {
    const left = daysUntil(today, plan.testDate);
    c.appendChild(el('div', 'review-facts', `計画：${plan.name}　${left > 0 ? `テストまで あと${left}日` : left === 0 ? 'テストは今日' : 'テストは終わりました'}`));
  }
  if (!data.groups.length) c.appendChild(el('div', 'field-note', 'この期間の量の記録はまだありません'));
  data.groups.forEach((g) => {
    detailSubjectHead(c, g.subject);
    g.items.forEach((x) => {
      const row = el('div', 'amount-row');
      const main = el('div', 'amount-main');
      main.appendChild(el('span', null, x.label));
      row.appendChild(main);
      const value = (text) => main.appendChild(el('span', 'subj-row-value', text));
      const sub = (text, done) => row.appendChild(el('div', 'amount-sub' + (done ? ' is-done' : ''), text));
      if (x.laps) {
        value(`${x.value} / ${x.total}${x.unit}`);
        row.appendChild(lapTrack(x.laps));
        sub(x.laps.map((l) => `${l.lap}周目 ${l.done}/${l.amount}${l.marked ? ' ✓' : ''}`).join('　'));
      } else if (x.goal) {
        value(`${x.value} / ${x.goal}${x.unit}`);
        row.appendChild(progressBar(x.value / x.goal));
        if (x.value >= x.goal) sub('✓ 届いた', true);
        else sub(`あと${x.goal - x.value}${x.unit}`);
      } else {
        value(`${x.value}${x.unit}`);
        if (x.prev > 0) sub(`${range.kind === 'week' ? '前の週' : '前の月'} ${x.prev}${x.unit}`);
      }
      c.appendChild(row);
    });
  });
  if (!plan) return;
  const note =
    range.kind === 'test'
      ? '計画の開始日からやった量'
      : range.kind === 'week'
        ? '「○ / ○」は、この週の予定に対してやった量'
        : '「○ / ○」は、月末までの予定（前の月までの残りを含む）に対してやった量';
  c.appendChild(el('div', 'field-note', `${note}。計画にない教材は、やった量だけ`));
  if (loadFeatures().admin) c.appendChild(smallButton('学習計画を開く', () => openPlanResult(plan.id)));
}

// 最後に読み込むスクリプトなので、ここでアプリを始める
startApp();
