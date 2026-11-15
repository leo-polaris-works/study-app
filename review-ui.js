// 振り返りの画面：今週・わからなかったことノート。計算は review.js・plan.js。月・テストまでは review-detail-ui.js。

let reviewTab = 'week'; // week＝今週／month＝月／test＝テストまで（計画があるときだけ）／note＝ノート
let reviewWeek = null; // まとめで見ている週の月曜
let reviewFilter = 'open'; // open＝まだ／all＝すべて
let reviewRangeFailed = false; // 表示する期間の記録を取れなかった

// 開いたときは、その場で同期する
function openReview(tab) {
  reviewTab = tab || 'week';
  reviewWeek = startOfWeekStr(parseDate(todayStr()));
  resetReviewDetail();
  renderReview();
  showScreen('screen-review');
  kickSync();
  loadRecordMonths().then((changed) => {
    if (changed) refreshReview();
  });
}

// 裏の取得が終わったときの描き直し
function refreshReview() {
  if (currentScreen === 'screen-review') renderReview();
}

function renderReview() {
  const tabs = [
    ['week', '今週'],
    ['month', '月'],
  ];
  if (detailPlans().length) tabs.push(['test', 'テストまで']);
  else if (reviewTab === 'test') reviewTab = 'week';
  tabs.push(['note', 'ノート']);
  renderSegmented($('review-tabs'), tabs, reviewTab, (v) => {
    reviewTab = v;
    renderReview();
  });
  const detail = reviewTab === 'month' || reviewTab === 'test';
  $('review-panel-summary').hidden = reviewTab !== 'week';
  $('review-panel-detail').hidden = !detail;
  $('review-panel-note').hidden = reviewTab !== 'note';
  if (reviewTab === 'week') renderReviewSummary();
  else if (detail) renderReviewDetail(reviewTab);
  else renderReviewNote();
}

// --- 今週 ---
// さかのぼれるのは、いちばん古い記録まで（保存先にだけある月も含む）
function firstReviewDate() {
  const dates = loadActiveRecords().map((r) => r.date);
  if (recordMonths.length) dates.push(recordMonths[0] + '-01');
  const today = todayStr();
  const first = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today;
  return first < today ? first : today;
}

function firstReviewWeek() {
  return startOfWeekStr(parseDate(firstReviewDate()));
}

function moveReviewWeek(days) {
  reviewWeek = shiftDate(reviewWeek, days);
  renderReview();
}

// 表示に使う期間（前の期間との比較。計画があれば開始日から）が取り込み範囲より前なら、保存先から取る
function requestReviewRange(from, to, plan) {
  pullRange(plan && plan.startDate < from ? plan.startDate : from, to).then((r) => {
    if (!r.fetched && r.failed === reviewRangeFailed) return;
    reviewRangeFailed = r.failed;
    refreshReview();
  });
}

$('btn-review-prev').addEventListener('click', () => moveReviewWeek(-7));
$('btn-review-next').addEventListener('click', () => moveReviewWeek(7));

// 今週：勉強した時間（時間帯×曜日の表）と、観点（教科／学習内容／量／課題）。月・テストまでと同じ並び
function renderReviewSummary() {
  const today = todayStr();
  const thisWeek = startOfWeekStr(parseDate(today));
  if (!reviewWeek || reviewWeek > thisWeek) reviewWeek = thisWeek;
  const range = detailRange('week', reviewWeek);
  $('review-week-label').textContent = `${reviewWeek === thisWeek ? '今週' : ''} ${shortDate(range.from)}〜${shortDate(range.to)}`.trim();
  $('btn-review-prev').disabled = reviewWeek <= firstReviewWeek();
  $('btn-review-next').disabled = reviewWeek >= thisWeek;

  const records = loadActiveRecords();
  const list = recordsBetween(records, range.from, range.to);
  const plan = planForRange(detailPlans(), range.from, range.to);
  const body = $('review-summary-body');
  body.innerHTML = '';
  const sync = getSyncSummary();
  if (!sync.localTest && (reviewRangeFailed || sync.error)) body.appendChild(el('div', 'field-note', LOCAL_ONLY_NOTE));
  renderWeekTime(body, summarizeWeek(records, reviewWeek, today), weekHints(records, reviewWeek, today));
  renderDetailViews(body, records, list, range, plan, today);
  requestReviewRange(range.prev.from, range.to, plan);
}

function subjectTag(subject, text) {
  return el('span', `subj-tag subj-${SUBJECTS.indexOf(subject)}`, text);
}

// 勉強した時間（今週）：見出しの横に日数と合計時間。時間帯×曜日の表。その下に、偏りのヒント（教科の空きは TOP の棒に出すので除く）
function renderWeekTime(body, summary, hints) {
  const c = card(body);
  const head = el('div', 'review-head');
  head.appendChild(el('h3', 'plan-heading', '勉強した時間'));
  if (summary.recordCount) head.appendChild(el('span', 'review-facts', `${summary.dayCount}日・${formatMinutes(summary.totalMinutes)}`));
  c.appendChild(head);
  renderBandGrid(c, summary);
  hints.filter((h) => h.kind !== 'gap').forEach((h) => c.appendChild(el('div', 'week-hint', h.text)));
}

// 時間帯×曜日の表。マスは「数40」（数学を40分）。いちばん下は曜日ごとの合計
function renderBandGrid(box, summary) {
  const grid = el('div', 'band-grid');
  grid.appendChild(el('div', 'band-head'));
  summary.days.forEach((d) => {
    const head = el('div', 'band-head' + (d.future ? ' is-future' : ''));
    head.appendChild(el('div', null, WEEKDAYS[parseDate(d.date).getDay()]));
    head.appendChild(el('div', null, String(parseDate(d.date).getDate())));
    grid.appendChild(head);
  });
  summary.bands.forEach((band) => {
    grid.appendChild(el('div', 'band-name', band.label));
    summary.days.forEach((d) => {
      const cell = el('div', 'band-cell' + (d.future ? ' is-future' : ''));
      d.records.filter((r) => bandIdOf(r) === band.id).forEach((r) => cell.appendChild(subjectTag(r.subject, `${r.subject.charAt(0)}${r.totalMinutes}`)));
      grid.appendChild(cell);
    });
  });
  grid.appendChild(el('div', 'band-name band-total', '合計'));
  summary.days.forEach((d) => grid.appendChild(el('div', 'band-head band-total', d.minutes ? String(d.minutes) : '—')));
  box.appendChild(grid);
  box.appendChild(el('div', 'field-note', `数字は分。${SUBJECTS[0].charAt(0)}15＝${SUBJECTS[0]}を15分`));
}

// 課題：課題ごとの回数と教科
function renderIssues(c, issues) {
  issues.items.forEach((x) => {
    const row = el('div', 'day-item issue-row');
    row.appendChild(el('span', 'day-item-name', x.label));
    row.appendChild(el('span', 'issue-subjects', x.subjects.join('・')));
    row.appendChild(el('span', 'day-item-value', `${x.n}回`));
    c.appendChild(row);
  });
  if (!issues.items.length) c.appendChild(el('div', 'review-facts', '課題を選んだ記録はありません'));
  else if (issues.none) c.appendChild(el('div', 'field-note', `課題なしの記録 ${issues.none}回`));
}

// --- わからなかったことノート：記録に書いた「わからなかったところ」を教科ごとに並べ、「わかった」の印を付ける ---
function unclearRecords() {
  return loadActiveRecords()
    .filter((r) => r.unclear && r.unclear.text)
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
}

// 「わかった」を付ける・外す（記録を直して送る）
function setUnclearResolved(id, resolved) {
  const r = findRecord(id);
  if (!r || !r.unclear || isReadOnly()) return;
  const updated = JSON.parse(JSON.stringify(r));
  updated.unclear.resolvedAt = resolved ? formatDate(new Date()) : null;
  updated.updatedAt = localIso();
  updateRecord(updated);
  kickSync();
  renderReview();
}

function renderReviewNote() {
  const all = unclearRecords();
  const open = all.filter((r) => !r.unclear.resolvedAt);
  $('review-note-count').textContent = `まだ ${open.length}件　わかった ${all.length - open.length}件`;
  renderSegmented(
    $('review-filter'),
    [
      ['open', 'まだ'],
      ['all', 'すべて'],
    ],
    reviewFilter,
    (v) => {
      reviewFilter = v;
      renderReview();
    }
  );

  const box = $('review-list');
  box.innerHTML = '';
  const list = reviewFilter === 'open' ? open : all;
  if (!list.length) {
    const msg = all.length
      ? 'まだの項目はありません'
      : 'わからなかったところを書いた記録はまだありません。記録の「課題」で「わからなかった」の課題を選ぶと書けます';
    box.appendChild(el('div', 'field-note', msg));
    return;
  }
  const writable = !isReadOnly();
  SUBJECTS.forEach((subject) => {
    const items = list.filter((r) => r.subject === subject);
    if (!items.length) return;
    box.appendChild(el('h3', 'note-subject', `${subject}（${items.length}）`));
    items.forEach((r) => {
      const item = el('div', 'note-item' + (r.unclear.resolvedAt ? ' is-done' : ''));
      const fields = r.fields.map((f) => f.label).join('・');
      item.appendChild(el('div', 'note-meta', `${displayDate(r.date)}　${fields}`));
      item.appendChild(el('div', 'note-text', r.unclear.text));
      const issues = r.issues.filter((i) => i.id !== 'i-free').map((i) => i.label);
      const meta = [];
      if (issues.length) meta.push(issues.join('・'));
      if (r.accuracy) meta.push(`正答率 ${r.accuracy.label}`);
      if (meta.length) item.appendChild(el('div', 'note-meta', meta.join('　')));
      const actions = el('div', 'note-actions');
      if (r.unclear.resolvedAt) {
        actions.appendChild(el('span', 'note-done', `わかった ${displayDate(r.unclear.resolvedAt)}`));
        if (writable) {
          const undo = el('button', 'btn btn-small btn-link', '取り消す');
          undo.addEventListener('click', () => setUnclearResolved(r.id, false));
          actions.appendChild(undo);
        }
      } else if (writable) {
        const done = el('button', 'btn btn-small', 'わかった');
        done.addEventListener('click', () => setUnclearResolved(r.id, true));
        actions.appendChild(done);
      }
      item.appendChild(actions);
      box.appendChild(item);
    });
  });
}
