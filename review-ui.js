// 振り返りの画面：今週のまとめ・わからなかったことノート。計算は review.js・plan.js。くわしく見るは review-detail-ui.js。

let reviewTab = 'summary'; // summary＝今週のまとめ／detail＝くわしく見る／note＝ノート
let reviewWeek = null; // まとめで見ている週の月曜
let reviewFilter = 'open'; // open＝まだ／all＝すべて
let reviewDoneView = 'band'; // まとめの表示：band＝時間（時間帯の表）／detail＝学習内容（記録ごと）／issue＝課題／plan＝計画（計画の進みと気づき）
let reviewRangeFailed = false; // 表示する期間の記録を取れなかった

// 開いたときは、その場で同期する
function openReview(tab) {
  reviewTab = tab || 'summary';
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
  renderSegmented(
    $('review-tabs'),
    [
      ['summary', '今週のまとめ'],
      ['detail', 'くわしく見る'],
      ['note', 'ノート'],
    ],
    reviewTab,
    (v) => {
      reviewTab = v;
      renderReview();
    }
  );
  $('review-panel-summary').hidden = reviewTab !== 'summary';
  $('review-panel-detail').hidden = reviewTab !== 'detail';
  $('review-panel-note').hidden = reviewTab !== 'note';
  if (reviewTab === 'summary') renderReviewSummary();
  else if (reviewTab === 'detail') renderReviewDetail();
  else renderReviewNote();
}

// --- 今週のまとめ ---
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

function renderReviewSummary() {
  const today = todayStr();
  const thisWeek = startOfWeekStr(parseDate(today));
  if (!reviewWeek || reviewWeek > thisWeek) reviewWeek = thisWeek;
  const weekEnd = shiftDate(reviewWeek, 6);
  $('review-week-label').textContent = `${reviewWeek === thisWeek ? '今週' : ''} ${shortDate(reviewWeek)}〜${shortDate(weekEnd)}`.trim();
  $('btn-review-prev').disabled = reviewWeek <= firstReviewWeek();
  $('btn-review-next').disabled = reviewWeek >= thisWeek;

  const records = loadActiveRecords();
  const summary = summarizeWeek(records, reviewWeek, today);
  const plan = planForWeek(loadActivePlans(), reviewWeek);
  const progress = plan ? planProgress(plan, records, reviewWeek, today) : null;
  const insights = detectInsights(records, reviewWeek, today, progress);

  const body = $('review-summary-body');
  body.innerHTML = '';
  const sync = getSyncSummary();
  if (!sync.localTest && (reviewRangeFailed || sync.error)) body.appendChild(el('div', 'field-note', LOCAL_ONLY_NOTE));
  renderWeekChange(body, thisWeek);
  renderDoneCard(body, summary, progress, insights);
  requestReviewRange(shiftDate(reviewWeek, -7), weekEnd, plan);
}

// その週にがんばること（1行）。今週のまとめでは、押すと TOP と同じダイアログで変えられる
function renderWeekChange(body, thisWeek) {
  const change = changeInEffect(loadReviews(), reviewWeek);
  const current = reviewWeek === thisWeek;
  const canChoose = current && !isReadOnly();
  if (!change && !canChoose) return;
  const line = el(canChoose ? 'button' : 'div', 'review-change');
  line.appendChild(el('span', 'review-change-label', current ? '今週がんばること' : 'この週にがんばること'));
  line.appendChild(el('span', 'review-change-text' + (change ? '' : ' is-empty'), change ? changeText(change) : 'タップして決める'));
  if (canChoose) line.addEventListener('click', openChangeDialog);
  body.appendChild(line);
}

function subjectTag(subject, text) {
  return el('span', `subj-tag subj-${SUBJECTS.indexOf(subject)}`, text);
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

// 記録1件の3行（やったこと・時間・正答率／学習内容／量）
function recordLines(r) {
  const item = el('div', 'day-record');
  const top = el('div', 'day-item');
  top.appendChild(subjectTag(r.subject, r.subject));
  top.appendChild(el('span', 'day-item-name', r.activity.label));
  top.appendChild(el('span', 'day-item-value', formatMinutes(r.totalMinutes)));
  if (r.accuracy) top.appendChild(el('span', 'day-item-accuracy', r.accuracy.label));
  item.appendChild(top);
  item.appendChild(el('div', 'day-record-sub', r.fields.map((f) => `${f.label}${formatMinutes(f.minutes)}`).join('・')));
  const amounts = r.materials.map((m) => (m.amount ? `${m.label} ${m.amount.value}${m.amount.unit}` : m.label)).join('・');
  if (amounts) item.appendChild(el('div', 'day-record-sub day-record-amount', amounts));
  return item;
}

// 曜日ごとの縦並び：曜日・合計の右に、記録ごとに3行
function renderDayList(box, summary) {
  const list = el('div', 'day-list');
  summary.days.forEach((d) => {
    const row = el('div', 'day-row' + (d.future ? ' is-future' : ''));
    const head = el('div', 'day-row-head');
    head.appendChild(el('div', 'day-row-date', `${WEEKDAYS[parseDate(d.date).getDay()]} ${shortDate(d.date)}`));
    if (!d.future) head.appendChild(el('div', 'day-row-total', d.records.length ? formatMinutes(d.minutes) : '記録なし'));
    row.appendChild(head);
    const items = el('div', 'day-row-items');
    d.records.forEach((r) => items.appendChild(recordLines(r)));
    row.appendChild(items);
    list.appendChild(row);
  });
  box.appendChild(list);
}

// 表示を「時間／学習内容／課題／計画」で切り替える。見出しの横に、その週の日数と合計時間を出す
function renderDoneCard(body, summary, progress, insights) {
  const c = card(body);
  c.classList.add('review-done');
  const head = el('div', 'review-head');
  head.appendChild(el('h3', 'plan-heading', 'できたこと'));
  if (summary.recordCount) head.appendChild(el('span', 'review-facts', `${summary.dayCount}日・${formatMinutes(summary.totalMinutes)}`));
  c.appendChild(head);
  const sw = el('div', 'seg-group review-switch');
  renderSegmented(
    sw,
    [
      ['band', '時間'],
      ['detail', '学習内容'],
      ['issue', '課題'],
      ['plan', '計画'],
    ],
    reviewDoneView,
    (v) => {
      reviewDoneView = v;
      renderReview();
    }
  );
  // 気づきは「計画」に出すので、数をボタンに添える
  if (insights.length) {
    const badge = el('span', 'seg-badge', String(insights.length));
    badge.setAttribute('aria-label', `ヒント${insights.length}件`);
    sw.children[3].appendChild(badge);
  }
  c.appendChild(sw);
  if (reviewDoneView === 'plan') {
    renderProgress(c, progress);
    renderHints(c, insights);
    return;
  }
  if (!summary.recordCount) {
    if (reviewDoneView === 'band') renderBandGrid(c, summary);
    c.appendChild(el('div', 'field-note', 'この週の記録はまだありません'));
    return;
  }
  if (reviewDoneView === 'issue') renderIssues(c, summary);
  else if (reviewDoneView === 'detail') renderDayList(c, summary);
  else {
    renderBandGrid(c, summary);
    // できたことの具体文は「時間」にだけ出す
    const list = el('ul', 'praise-list');
    praiseLines(summary, progress).forEach((line) => list.appendChild(el('li', null, line)));
    c.appendChild(list);
  }
}

// 課題：課題ごとの回数と教科（曜日ごとには出さない）
function renderIssues(c, summary) {
  summary.issues.items.forEach((x) => {
    const row = el('div', 'day-item issue-row');
    row.appendChild(el('span', 'day-item-name', x.label));
    row.appendChild(el('span', 'issue-subjects', x.subjects.join('・')));
    row.appendChild(el('span', 'day-item-value', `${x.n}回`));
    c.appendChild(row);
  });
  if (!summary.issues.items.length) c.appendChild(el('div', 'review-facts', '課題を選んだ記録はありません'));
  else if (summary.issues.none) c.appendChild(el('div', 'field-note', `課題なしの記録 ${summary.issues.none}回`));
}

function renderProgress(c, progress) {
  if (!progress) {
    c.appendChild(el('h4', 'review-subheading', '計画の進み'));
    c.appendChild(el('div', 'field-note', 'この週にかかる計画はありません'));
    return;
  }
  c.appendChild(el('h4', 'review-subheading', `計画の進み（${progress.plan.name}）`));
  const left = progress.daysLeft;
  c.appendChild(el('div', 'review-facts', left > 0 ? `テストまで あと${left}日` : left === 0 ? 'テストは今日' : 'テストは終わりました'));
  if (!progress.targets.length) c.appendChild(el('div', 'field-note', 'この週の予定はありません'));
  progress.targets.forEach((t) => {
    const row = el('div', 'plan-target');
    row.appendChild(el('div', 'plan-target-main', `${t.subject} ${t.label}　${t.done} / ${t.goal}${t.unit}`));
    row.appendChild(progressBar(t.done / Math.max(t.goal, 1)));
    row.appendChild(el('div', 'plan-target-sub', t.done >= t.goal ? '✓ 届いた' : `あと${t.goal - t.done}${t.unit}`));
    c.appendChild(row);
  });
  if (progress.adjust.length) {
    const box = el('div', 'review-adjust');
    progress.adjust.forEach((line) => box.appendChild(el('div', null, line)));
    box.appendChild(el('div', 'review-adjust-q', '計画を見直す？ 月ごとの割合（前の月を増やす）か、周回を減らす'));
    c.appendChild(box);
  }
  if (loadFeatures().admin) c.appendChild(smallButton('学習計画を開く', () => openPlanResult(progress.plan.id)));
}

// 気づき：できたことの文と同じ装飾。先頭の印は「ヒント」
function renderHints(c, insights) {
  c.appendChild(el('h4', 'review-subheading', '気づき'));
  if (!insights.length) {
    c.appendChild(el('div', 'review-facts', '気になるところは特にありません'));
    return;
  }
  const list = el('ul', 'praise-list hint-list');
  insights.forEach((x) => {
    const hint = el('li', 'hint-card');
    hint.appendChild(el('span', 'hint-label', 'ヒント'));
    hint.appendChild(el('span', 'hint-text', x.text));
    if (x.link === 'note') {
      hint.appendChild(
        smallButton(
          'ノートで見る',
          () => {
            reviewTab = 'note';
            renderReview();
          },
          'btn-link'
        )
      );
    }
    list.appendChild(hint);
  });
  c.appendChild(list);
  c.appendChild(el('div', 'field-note', '記録した内容から出しています'));
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
