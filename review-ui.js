// 振り返り：わからなかったことノート。記録に書いた「わからなかったところ」を教科ごとに並べ、「わかった」の印を付ける。

let reviewFilter = 'open'; // open＝まだ／all＝すべて

function openReview() {
  renderReview();
  showScreen('screen-review');
}

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

function renderReview() {
  const all = unclearRecords();
  const open = all.filter((r) => !r.unclear.resolvedAt);
  $('review-summary').textContent = `まだ ${open.length}件　わかった ${all.length - open.length}件`;
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
      const card = el('div', 'note-item' + (r.unclear.resolvedAt ? ' is-done' : ''));
      const fields = r.fields.map((f) => f.label).join('・');
      card.appendChild(el('div', 'note-meta', `${displayDate(r.date)}　${fields}`));
      card.appendChild(el('div', 'note-text', r.unclear.text));
      const issues = r.issues.filter((i) => i.id !== 'i-free').map((i) => i.label);
      const meta = [];
      if (issues.length) meta.push(issues.join('・'));
      if (r.accuracy) meta.push(`正答率 ${r.accuracy.label}`);
      if (meta.length) card.appendChild(el('div', 'note-meta', meta.join('　')));
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
      card.appendChild(actions);
      box.appendChild(card);
    });
  });
}
