// 画面（app.js）の論理テスト：鍵のロック・閲覧モード・保存状態の表示。実行：node app/tests/ui.test.js
// ブラウザは使わず、最小限の偽 DOM（index.html の id・class から作る）と偽 GitHub で動かす。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { FakeGitHub, sampleRecord, APP_DIR } = require('./harness');

const TOKEN_W = 'github_pat_' + 'W'.repeat(60);
const TOKEN_W2 = 'github_pat_' + 'X'.repeat(60);
const TOKEN_R = 'github_pat_' + 'R'.repeat(60);
const FAR = '2099-12-31';

// --- 最小限の偽 DOM ---
class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this._text = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.classSet = new Set();
    this.attrs = {};
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  get className() {
    return [...this.classSet].join(' ');
  }
  set className(v) {
    this.classSet = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach((x) => self.classSet.add(x)),
      remove: (...c) => c.forEach((x) => self.classSet.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !self.classSet.has(c) : !!force;
        if (on) self.classSet.add(c);
        else self.classSet.delete(c);
        return on;
      },
      contains: (c) => self.classSet.has(c),
    };
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  set innerHTML(v) {
    this.children = [];
    this._text = '';
  }
  appendChild(n) {
    this.children.push(n);
    return n;
  }
  append(...nodes) {
    nodes.forEach((n) => {
      if (typeof n === 'string') {
        const t = new El('#text');
        t._text = n;
        this.children.push(t);
      } else this.children.push(n);
    });
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get childNodes() {
    return this.children;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  async click() {
    if (this.disabled) return;
    await Promise.all((this.listeners.click || []).map((f) => f({ target: this })));
  }
  focus() {}
}

function makeUi(server, extra) {
  const store = new Map();
  const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
  const byId = {};
  const screens = [];
  const gotos = [];
  const tagRe = /<(\w+)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const attrs = m[2];
    const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1];
    const cls = (/\bclass="([^"]*)"/.exec(attrs) || [])[1] || '';
    const goto = (/\bdata-goto="([^"]+)"/.exec(attrs) || [])[1];
    if (!id && !goto) continue;
    const e = new El(m[1]);
    e.className = cls;
    e.id = id || '';
    e.hidden = /\bhidden\b/.test(attrs.replace(/class="[^"]*"/, ''));
    if (id) byId[id] = e;
    if (cls.split(/\s+/).includes('screen')) screens.push(e);
    if (goto) {
      e.dataset.goto = goto;
      gotos.push(e);
    }
  }
  const docListeners = {};
  const winListeners = {};
  const state = { confirmAnswer: true, confirms: [] };
  const context = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    fetch: async (url, init) => {
      if (state.offline) throw new TypeError('Failed to fetch');
      return server.handle(url, init);
    },
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    URL,
    console,
    setTimeout,
    clearTimeout,
    navigator: { userAgent: 'Android', maxTouchPoints: 5 },
    location: { search: (extra && extra.search) || '', hostname: (extra && extra.hostname) || 'leo-polaris-works.github.io' },
    alert: () => {},
    confirm: (msg) => {
      state.confirms.push(msg);
      return state.confirmAnswer;
    },
    prompt: () => null,
    document: {
      getElementById: (id) => {
        if (!byId[id]) throw new Error('id がありません: ' + id);
        return byId[id];
      },
      querySelectorAll: (sel) => (sel === '.screen' ? screens : sel === '[data-goto]' ? gotos : []),
      createElement: (tag) => new El(tag),
      createElementNS: (ns, tag) => new El(tag),
      addEventListener: (t, fn) => (docListeners[t] = docListeners[t] || []).push(fn),
      visibilityState: 'visible',
    },
    window: {
      scrollTo: () => {},
      addEventListener: (t, fn) => (winListeners[t] = winListeners[t] || []).push(fn),
    },
  };
  context.window.document = context.document;
  const ctx = vm.createContext(context);
  ['config.js', 'master.js', 'data.js', 'plan.js', 'review.js', 'github.js', 'sync.js', 'messages.js', 'images.js', 'app.js', 'plan-ui.js', 'review-ui.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(APP_DIR, f), 'utf8'), ctx, { filename: f });
  });
  ctx.run = (code) => vm.runInContext(code, ctx);
  ctx.run('syncSleep = () => Promise.resolve()');
  const ui = {
    ctx,
    state,
    $: (id) => byId[id],
    visibleScreens: () => screens.filter((s) => !s.hidden).map((s) => Object.keys(byId).find((k) => byId[k] === s)),
    fire: async (target, type) => {
      const list = (target === 'doc' ? docListeners : winListeners)[type] || [];
      await Promise.all(list.map((f) => f({})));
    },
    // 同期が終わるまで待つ
    settle: async () => {
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    },
  };
  return ui;
}

function newServer() {
  const server = new FakeGitHub();
  server.addToken(TOKEN_W, 'write');
  server.addToken(TOKEN_W2, 'write');
  server.addToken(TOKEN_R, 'read');
  return server;
}

// 鍵の画面に入力して「つないで確認する」を押す
async function enterToken(ui, { token, mode }) {
  ui.$('sync-token').value = token;
  if (mode) ui.$('sync-mode').children[mode === 'write' ? 0 : 1].click();
  await ui.$('btn-sync-connect').click();
  await ui.settle();
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('鍵がないと、鍵の画面以外は開かない（ロック）', async () => {
  const ui = makeUi(newServer());
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-sync']);
  assert.strictEqual(ui.$('sync-title').textContent, '鍵を入れてください');
  assert.ok(!ui.$('sync-lock-message').hidden);
  assert.ok(ui.$('sync-lock-message').textContent.includes('鍵を入れてください'));
  assert.ok(ui.$('btn-sync-back').hidden, 'ロック中は TOP へ戻れない');
  assert.ok(ui.$('sync-manage').hidden);

  // どのボタンからも入力・一覧・設定は開かない
  await ui.$('menu-record').click();
  await ui.$('menu-records').click();
  await ui.$('menu-settings').click();
  ui.ctx.startInput();
  ui.ctx.goTo('screen-top');
  ui.ctx.showScreen('screen-records');
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-sync']);
});

test('鍵の入力ミスの表示（空欄・形式）と、失敗のあともロックのまま', async () => {
  const ui = makeUi(newServer());
  await enterToken(ui, { token: '' });
  assert.ok(ui.$('sync-err-token').textContent.includes('入力されていません'));
  assert.ok(ui.$('sync-err-mode').hidden, '使い方は初期から「記録する」が選ばれている');
  assert.ok(ui.$('sync-mode').children[0].classList.contains('selected'));
  assert.ok(!ui.$('sync-err-token').hidden);

  await enterToken(ui, { token: 'ghp_' + 'A'.repeat(50), mode: 'write' });
  assert.ok(ui.$('sync-err-token').textContent.includes('この形の鍵は使えません'));
  assert.ok(ui.$('sync-err-mode').hidden, '直したところのエラーは消える');

  await enterToken(ui, { token: 'github_pat_' + 'Z'.repeat(60), mode: 'write' });
  assert.ok(ui.$('sync-err-connect').textContent.includes('鍵が使えませんでした'));
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-sync']);
  assert.strictEqual(ui.ctx.loadSyncConfig(), null);
});

test('正しい鍵で TOP が開き、記録が送られ、状態行が「保存済み」になる。鍵の入力欄は空に戻る', async () => {
  const server = newServer();
  const ui = makeUi(server);
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-top']);
  assert.strictEqual(ui.$('sync-token').value, '');
  assert.ok(!ui.$('menu-record').hidden && ui.$('menu-settings').hidden, '管理機能は初期は出ない');
  assert.ok(ui.$('sync-line').textContent.includes('保存済み'));

  // 登録の直後に送られ、結果画面に送信状態が出る
  const date = ui.ctx.run('formatDate(new Date())');
  const r = sampleRecord({ id: date.replace(/-/g, '') + '-193045-a3f9', date });
  ui.ctx.saveRecord(r);
  ui.ctx.renderDone(r, false);
  ui.ctx.showScreen('screen-done');
  ui.ctx.kickSync();
  await ui.settle();
  assert.strictEqual(ui.$('done-sync').textContent, '送信しました ✓');
  assert.strictEqual(server.files.size, 1);
});

test('通信できないとき：TOP の状態行は「未送信」、登録結果は「端末に保存しました」。ロックはしない', async () => {
  const ui = makeUi(newServer());
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  ui.state.offline = true;
  const date = ui.ctx.run('formatDate(new Date())');
  const r = sampleRecord({ id: date.replace(/-/g, '') + '-193045-a3f9', date });
  ui.ctx.saveRecord(r);
  ui.ctx.renderDone(r, false);
  ui.ctx.showScreen('screen-done');
  ui.ctx.kickSync();
  await ui.settle();
  assert.ok(ui.$('done-sync').textContent.startsWith('端末に保存しました。'));
  ui.ctx.goTo('screen-top');
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-top']);
  assert.ok(ui.$('sync-line').textContent.includes('未送信 1件'));
  assert.ok(ui.$('sync-line').classList.contains('warn'));

  ui.state.offline = false;
  await ui.fire('win', 'online');
  await ui.settle();
  assert.ok(ui.$('sync-line').textContent.includes('保存済み'));
});

test('使っている途中で鍵が無効になったら、鍵の画面に切り替わる（記録は端末に残る）', async () => {
  const server = newServer();
  const ui = makeUi(server);
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  const date = ui.ctx.run('formatDate(new Date())');
  ui.ctx.saveRecord(sampleRecord({ id: date.replace(/-/g, '') + '-193045-a3f9', date }));
  server.revokeToken(TOKEN_W);
  ui.ctx.kickSync();
  await ui.settle();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-sync']);
  assert.ok(ui.$('sync-lock-message').textContent.includes('鍵が使えなくなりました'));
  assert.strictEqual(ui.ctx.pendingIds().length, 1);

  await enterToken(ui, { token: TOKEN_W2, mode: 'write' });
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-top']);
  assert.strictEqual(ui.ctx.pendingIds().length, 0);
  assert.strictEqual(server.files.size, 1);
});

test('管理機能は、機能利用設定の「利用する／利用しない」で出し入れできる。設定は端末に残り、最初の鍵の画面でも選べる', async () => {
  const ui = makeUi(newServer());
  // 最初の鍵の画面（ロック中）から選べる
  assert.ok(!ui.$('sync-admin').hidden && ui.$('sync-admin').children.length === 2);
  assert.ok(ui.$('sync-admin').children[1].classList.contains('selected'), '初期は「利用しない」');
  await ui.$('sync-admin').children[0].click();
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  assert.ok(!ui.$('menu-plan').hidden && !ui.$('menu-settings').hidden && !ui.$('admin-menu').hidden && !ui.$('admin-heading').hidden);
  assert.ok(!ui.$('menu-record').hidden && !ui.$('menu-records').hidden && !ui.$('menu-review').hidden);

  await ui.$('sync-line').click();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-sync']);
  assert.strictEqual(ui.$('sync-title').textContent, '機能利用設定');
  assert.ok(ui.$('sync-admin').children[0].classList.contains('selected'));
  await ui.$('sync-admin').children[1].click();
  assert.ok(ui.$('sync-admin').children[1].classList.contains('selected'));
  ui.ctx.goTo('screen-top');
  assert.ok(ui.$('menu-plan').hidden && ui.$('menu-settings').hidden && ui.$('admin-menu').hidden && ui.$('admin-heading').hidden);
  assert.strictEqual(JSON.stringify(ui.ctx.loadFeatures()), JSON.stringify({ admin: false }));
});

test('鍵は一度入れたら再入力不要。使い方は鍵なしですぐ変えられ、鍵を消すと鍵の欄が戻る', async () => {
  const ui = makeUi(newServer());
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  await ui.$('sync-line').click();
  assert.ok(ui.$('sync-token-section').hidden && ui.$('btn-sync-connect').hidden && !ui.$('sync-manage').hidden);
  await ui.$('sync-mode').children[1].click();
  assert.strictEqual(ui.ctx.loadSyncConfig().mode, 'read');
  assert.ok(ui.$('sync-mode').children[1].classList.contains('selected'));
  ui.ctx.goTo('screen-top');
  assert.ok(ui.$('menu-record').hidden, '見るだけに変わった');
  await ui.$('sync-line').click();
  await ui.$('sync-mode').children[0].click();
  assert.strictEqual(ui.ctx.loadSyncConfig().mode, 'write');
  assert.ok(ui.ctx.loadSyncConfig().token, '鍵は残っている');
  await ui.$('btn-sync-disconnect').click();
  assert.ok(!ui.$('sync-token-section').hidden && !ui.$('btn-sync-connect').hidden, '鍵を消すと鍵の欄が出る');
});

test('見るだけ：記録・設定のボタンが出ず、開けない。一覧は見え、修正・削除は出ない', async () => {
  const server = newServer();
  const date = new Date().toISOString().slice(0, 10);
  const owner = makeUi(server);
  await enterToken(owner, { token: TOKEN_W, mode: 'write' });
  const d = owner.ctx.run('formatDate(new Date())');
  owner.ctx.saveRecord(sampleRecord({ id: d.replace(/-/g, '') + '-193045-a3f9', date: d }));
  owner.ctx.kickSync();
  await owner.settle();
  assert.ok(date);

  const mother = makeUi(server);
  await enterToken(mother, { token: TOKEN_R, mode: 'read' });
  assert.deepStrictEqual(mother.visibleScreens(), ['screen-top']);
  assert.ok(mother.$('menu-record').hidden);
  assert.ok(!mother.$('menu-records').hidden && !mother.$('menu-review').hidden, '一覧と振り返りは見られる');
  assert.ok(mother.$('admin-menu').hidden, '管理機能は初期は出ない');
  await mother.$('sync-line').click();
  await mother.$('sync-admin').children[0].click();
  mother.ctx.goTo('screen-top');
  assert.ok(!mother.$('menu-plan').hidden && !mother.$('menu-settings').hidden, '見るだけでも、利用するにすれば出る');
  assert.ok(mother.$('sync-line').textContent.includes('最新の記録を取り込みました'));

  await mother.$('menu-record').click();
  mother.ctx.startInput();
  assert.deepStrictEqual(mother.visibleScreens(), ['screen-top']);

  await mother.$('menu-records').click();
  assert.strictEqual(mother.$('records-note').textContent, '直近14日の記録');
  assert.strictEqual(mother.$('records-list').children.length, 1);
  await mother.$('records-list').children[0].click();
  assert.deepStrictEqual(mother.visibleScreens(), ['screen-record-detail']);
  assert.ok(mother.$('btn-detail-edit').hidden && mother.$('btn-detail-delete').hidden);
  mother.ctx.startEdit(mother.ctx.recentRecords()[0].id);
  await mother.$('btn-detail-delete').click();
  assert.strictEqual(mother.ctx.recentRecords().length, 1, '削除もできない');
  assert.strictEqual(server.requests('PUT').length, 1, '見るだけの端末は書き込まない');
});

test('記録する端末：一覧の説明・修正・削除が出る。鍵を消すと鍵の画面になり、確認メッセージに送信待ち件数が出る', async () => {
  const ui = makeUi(newServer());
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  const d = ui.ctx.run('formatDate(new Date())');
  ui.ctx.saveRecord(sampleRecord({ id: d.replace(/-/g, '') + '-193045-a3f9', date: d }));
  ui.ctx.kickSync();
  await ui.settle();
  await ui.$('menu-records').click();
  assert.ok(ui.$('records-note').textContent.includes('修正・削除できます'));
  await ui.$('records-list').children[0].click();
  assert.ok(!ui.$('btn-detail-edit').hidden && !ui.$('btn-detail-delete').hidden);

  ui.state.offline = true;
  ui.ctx.saveRecord(sampleRecord({ id: d.replace(/-/g, '') + '-200000-a3f9', date: d }));
  ui.ctx.goTo('screen-top');
  await ui.$('sync-line').click();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-sync']);
  assert.ok(!ui.$('sync-manage').hidden);
  await ui.$('btn-sync-disconnect').click();
  assert.ok(ui.state.confirms[0].includes('送信待ちの記録が1件'));
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-sync']);
  assert.strictEqual(ui.$('sync-title').textContent, '鍵を入れてください');
  assert.strictEqual(ui.ctx.loadRecords().length, 1, '送信済みの控えは消え、送信待ちだけ残る');

  const again = makeUi(newServer());
  again.state.confirmAnswer = false;
  await enterToken(again, { token: TOKEN_W, mode: 'write' });
  await again.$('sync-line').click();
  await again.$('btn-sync-disconnect').click();
  assert.deepStrictEqual(again.visibleScreens(), ['screen-sync']);
  assert.ok(again.ctx.loadSyncConfig(), 'キャンセルしたら消さない');
});

// 入力の全ページを操作して、登録→送信まで通す（既存の入力の流れを壊していないことの確認）
function findAll(root, pred, out) {
  out = out || [];
  if (pred(root)) out.push(root);
  root.children.forEach((c) => findAll(c, pred, out));
  return out;
}
const chipByText = (root, text) => findAll(root, (e) => e.classSet.has('chip') && e.textContent === text)[0];
const buttonByText = (root, text) => findAll(root, (e) => e.tagName === 'button' && e.textContent === text)[0];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('入力の全ページ（いつ→やったこと・教科→学習内容→量→正答率→課題→確認）を通して登録され、送信される', async () => {
  const server = newServer();
  const ui = makeUi(server);
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  const body = ui.$('step-body');
  await ui.$('menu-record').click();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-input']);

  await chipByText(body, '50分').click();
  await buttonByText(body, '次へ').click();
  await chipByText(body, 'テスト対策').click();
  await chipByText(body, '英語').click();
  await wait(250);
  await chipByText(body, '残り').click();
  assert.ok(!buttonByText(body, '次へ').disabled, '合計が合えば次へ進める');
  await buttonByText(body, '次へ').click();
  const firstQty = findAll(body, (e) => e.classSet.has('chip') && /^\d+$/.test(e.textContent))[0];
  await firstQty.click();
  await buttonByText(body, '次へ').click();
  await chipByText(body, '〜70%').click();
  await wait(250);
  await chipByText(body, '特になし').click();
  await wait(250);
  await buttonByText(body, '登録する').click();
  await ui.settle();

  assert.deepStrictEqual(ui.visibleScreens(), ['screen-done']);
  assert.strictEqual(ui.$('done-title').textContent, '登録しました');
  assert.strictEqual(ui.$('done-sync').textContent, '送信しました ✓');
  const [p, file] = [...server.files.entries()][0];
  const rec = JSON.parse(file.text);
  assert.ok(/^records\/\d{4}-\d{2}\/\d{8}-\d{6}-[a-z0-9]{4}\.json$/.test(p), p);
  assert.strictEqual(rec.subject, '英語');
  assert.strictEqual(rec.activity.label, 'テスト対策');
  assert.strictEqual(rec.totalMinutes, 50);
  assert.strictEqual(rec.fields[0].minutes, 50);
  assert.strictEqual(rec.accuracy.label, '〜70%');
  assert.deepStrictEqual(rec.issues, []);
  assert.strictEqual(rec.deleted, false);
  assert.strictEqual(rec.device.kind, 'Android');
  assert.strictEqual(ui.ctx.pendingIds().length, 0);
});

test('実機テスト用のサンプルボタンは ?dev=1 のときだけ出る', () => {
  assert.ok(makeUi(newServer()).$('dev-tools').hidden);
  assert.ok(!makeUi(newServer(), { search: '?dev=1' }).$('dev-tools').hidden);
});

test('学習計画：作る→保存して計算→結果（目標・グラフ）が出て送信される。入力漏れ・割合の合計違いは保存しない。直す・削除もできる', async () => {
  const server = newServer();
  const ui = makeUi(server);
  await ui.$('sync-admin').children[0].click();
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  await ui.$('menu-plan').click();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-plans']);
  assert.ok(/まだ計画がありません/.test(ui.$('plans-list').textContent));

  await ui.$('btn-plan-new').click();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-plan-edit']);
  const body = ui.$('plan-edit-body');
  assert.ok(/合計 100%/.test(body.textContent), '月ごとの割合の初期値は合計100%');
  await ui.$('btn-plan-save').click();
  assert.ok(!ui.$('plan-edit-error').hidden, '名前がないと保存しない');

  const inputs = findAll(body, (e) => e.classSet.has('plan-input'));
  inputs[0].value = '後期中間';
  inputs[0].listeners.change[0]();
  await findAll(body, (e) => e.textContent === '＋教材')[3].click(); // 理科
  await ui.$('btn-plan-save').click();
  assert.ok(/量が入っていない/.test(ui.$('plan-edit-error').textContent));
  const nums = () => findAll(ui.$('plan-edit-body'), (e) => e.classSet.has('setting-number'));
  nums()[0].value = '40';
  nums()[0].listeners.change[0]();
  const month = nums()[2]; // 量・周回の次が、月ごとの割合の最初の欄
  const before = month.value;
  month.value = String(Number(before) + 5);
  month.listeners.change[0]();
  await ui.$('btn-plan-save').click();
  assert.ok(/合計100%/.test(ui.$('plan-edit-error').textContent), '割合の合計が100%でないと保存しない');
  month.value = before;
  month.listeners.change[0]();
  await ui.$('btn-plan-save').click();
  await ui.settle();

  assert.deepStrictEqual(ui.visibleScreens(), ['screen-plan-result']);
  assert.strictEqual(ui.$('plan-result-title').textContent, '後期中間');
  const result = ui.$('plan-result-body');
  ['テストまで', 'テストまでの流れ', '今週の目標', '今日・明日の目安', '教材ごとの進み具合', '週ごとの目安時間', '計画と実績', '理科 宿題'].forEach((t) => assert.ok(result.textContent.includes(t), t));
  assert.ok(findAll(result, (e) => e.tagName === 'svg').length >= 2, 'グラフが描かれる');
  const files = [...server.files.keys()].filter((k) => k.startsWith('plans/'));
  assert.strictEqual(files.length, 1);
  assert.strictEqual(JSON.parse(server.files.get(files[0]).text).items[0].amount, 40);

  // 周回のチェック：×の数を入れて「決定」すると保存され、次の周の量になる
  await buttonByText(ui.$('plan-result-body'), '1周目が終わった').click();
  const form = ui.$('plan-result-body');
  const xInput = findAll(form, (e) => e.classSet.has('setting-number'))[0];
  xInput.value = '7';
  await buttonByText(form, '決定').click();
  await ui.settle();
  const saved = ui.ctx.findPlan(ui.ctx.loadActivePlans()[0].id);
  assert.strictEqual(saved.items[0].lapMarks[0].nextAmount, 7);
  assert.ok(/2周目 7ページ/.test(ui.$('plan-result-body').textContent));
  assert.ok(buttonByText(ui.$('plan-result-body'), '2周目が終わった'));
  assert.strictEqual(JSON.parse(server.files.get(files[0]).text).items[0].lapMarks.length, 1, 'チェックも送信される');
  await buttonByText(ui.$('plan-result-body'), '取り消す').click();
  await ui.settle();
  assert.strictEqual(ui.ctx.findPlan(saved.id).items[0].lapMarks.length, 0);

  await ui.$('btn-plan-edit').click();
  assert.strictEqual(ui.$('plan-edit-title').textContent, '計画を直す');
  await ui.$('btn-plan-edit-back').click();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-plan-result']);

  await ui.$('btn-plan-delete').click();
  await ui.settle();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-plans']);
  assert.strictEqual(ui.ctx.loadActivePlans().length, 0);
  assert.strictEqual(JSON.parse(server.files.get(files[0]).text).deleted, true);
});

test('学習計画の結果：遅れ・目安の日に間に合わない周があっても表示でき、説明が出る', async () => {
  const server = newServer();
  const ui = makeUi(server);
  await ui.$('sync-admin').children[0].click();
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  const today = ui.ctx.formatDate(new Date());
  const p = JSON.parse(JSON.stringify(ui.ctx.newPlan()));
  p.name = '後ろ寄り';
  p.startDate = ui.ctx.shiftDate(today, -10);
  p.testDate = ui.ctx.shiftDate(today, 12);
  const months = ui.ctx.planMonths(p.startDate, p.testDate);
  p.months = months.map((m, i) => ({ month: m.month, percent: i === months.length - 1 ? 100 : 0 }));
  if (months.length === 1) p.months[0].percent = 100;
  p.items = [{ materialId: 'm-sc-work', subject: '理科', label: 'ワーク', unit: 'ページ', amount: 400, laps: 2, lapMarks: [] }];
  p.firstAccuracy = 0.95;
  ui.ctx.savePlan(p);
  const r = sampleRecord({ id: today.replace(/-/g, '') + '-190000-zzzz', date: ui.ctx.shiftDate(today, -1) });
  r.subject = '理科';
  r.materials = [{ id: 'm-sc-work', label: 'ワーク', amount: { value: 3, unit: 'ページ' } }];
  ui.ctx.saveRecord(r);
  await ui.$('menu-plan').click();
  await findAll(ui.$('plans-list'), (e) => e.classSet.has('record-item'))[0].click();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-plan-result']);
  const text = ui.$('plan-result-body').textContent;
  assert.ok(/遅れている教材/.test(text) && /今月の残りの日に分けました/.test(text), '遅れ');
  assert.ok(/間に合わない周があります/.test(text), '目安の日');
  assert.ok(/3 \/ /.test(text), '記録が進み具合に入る');
});

test('テスト用（localhost）：鍵なしで開き、記録・計画は端末内だけに保存され、GitHub に1回も通信しない。公開ページではロックのまま', async () => {
  assert.deepStrictEqual(makeUi(newServer()).visibleScreens(), ['screen-sync'], '公開ページでは鍵が必要');
  const server = newServer();
  const ui = makeUi(server, { hostname: 'localhost', search: '?dev=1' });
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-top']);
  assert.ok(/テスト用/.test(ui.$('sync-line').textContent));
  await ui.$('sync-line').click();
  assert.ok(ui.$('sync-token-section').hidden && ui.$('btn-sync-connect').hidden && ui.$('sync-manage').hidden, '鍵の欄は出ない');
  await ui.$('sync-admin').children[0].click();
  ui.ctx.goTo('screen-top');

  const body = ui.$('step-body');
  await ui.$('menu-record').click();
  await chipByText(body, '50分').click();
  await buttonByText(body, '次へ').click();
  await chipByText(body, 'テスト対策').click();
  await chipByText(body, '英語').click();
  await wait(250);
  await chipByText(body, '残り').click();
  await buttonByText(body, '次へ').click();
  await findAll(body, (e) => e.classSet.has('chip') && /^\d+$/.test(e.textContent))[0].click();
  await buttonByText(body, '次へ').click();
  await chipByText(body, '〜70%').click();
  await wait(250);
  await chipByText(body, '特になし').click();
  await wait(250);
  await buttonByText(body, '登録する').click();
  await ui.settle();
  assert.ok(/送信しません/.test(ui.$('done-sync').textContent));

  const p = JSON.parse(JSON.stringify(ui.ctx.newPlan()));
  p.name = 'テスト';
  p.items = [{ materialId: 'm-sc-work', subject: '理科', label: 'ワーク', unit: 'ページ', amount: 40, laps: 3 }];
  ui.ctx.savePlan(p);
  await ui.ctx.syncNow({ force: true });
  await ui.settle();
  assert.strictEqual(ui.ctx.loadActiveRecords().length, 1);
  assert.strictEqual(ui.ctx.loadActivePlans().length, 1);
  assert.strictEqual(server.log.length, 0, 'GitHub に通信しない');
  const r = await ui.ctx.connectWithToken({ token: TOKEN_W, mode: 'write' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(server.log.length, 0, '鍵を入れても通信しない');
});

// 入力を課題のページまで進める（いつ→やったこと・教科→学習内容→量→正答率）
async function inputUntilIssue(ui) {
  const body = ui.$('step-body');
  await ui.$('menu-record').click();
  await chipByText(body, '50分').click();
  await buttonByText(body, '次へ').click();
  await chipByText(body, 'テスト対策').click();
  await chipByText(body, '理科').click();
  await wait(250);
  await chipByText(body, '残り').click();
  await buttonByText(body, '次へ').click();
  await findAll(body, (e) => e.classSet.has('chip') && /^\d+$/.test(e.textContent))[0].click();
  await buttonByText(body, '次へ').click();
  await chipByText(body, '〜50%').click();
  await wait(250);
  return body;
}

test('わからなかったところ：「わからなかった」の課題を選んだときだけ入力欄が出て、書いた内容が記録・確認・ノートに出る。「わかった」と取り消しが送られ、直しても消えない', async () => {
  const server = newServer();
  const ui = makeUi(server);
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  const body = await inputUntilIssue(ui);
  const box = () => findAll(body, (e) => e.classSet.has('unclear-box'))[0];
  assert.ok(box().hidden, '最初は出ない');
  await chipByText(body, '眠い・疲れた').click();
  assert.ok(box().hidden, '「わからなかった」以外では出ない');
  await chipByText(body, 'そもそも分からない').click();
  assert.ok(!box().hidden, '「わからなかった」を選ぶと出る');
  const input = findAll(body, (e) => e.classSet.has('unclear-input'))[0];
  input.value = '  ワーク p.32 問3、化学反応式の係数  ';
  input.listeners.input[0]();
  await buttonByText(body, '次へ').click();
  assert.ok(/わからなかったところ.*ワーク p\.32 問3、化学反応式の係数/.test(body.textContent), '確認に出る');
  await buttonByText(body, '登録する').click();
  await ui.settle();

  const [p, file] = [...server.files.entries()][0];
  const rec = JSON.parse(file.text);
  assert.deepStrictEqual(rec.unclear, { text: 'ワーク p.32 問3、化学反応式の係数', resolvedAt: null });

  ui.ctx.goTo('screen-top');
  await ui.$('menu-review').click();
  assert.deepStrictEqual(ui.visibleScreens(), ['screen-review']);
  assert.ok(!ui.$('review-panel-summary').hidden && ui.$('review-panel-note').hidden, '最初は今週のまとめ');
  await chipByText(ui.$('review-tabs'), 'ノート').click();
  const list = ui.$('review-list');
  assert.ok(/理科（1）/.test(list.textContent) && /化学反応式の係数/.test(list.textContent));
  assert.ok(/そもそも分からない/.test(list.textContent) && /正答率 〜50%/.test(list.textContent));
  assert.strictEqual(ui.$('review-note-count').textContent, 'まだ 1件　わかった 0件');

  await buttonByText(list, 'わかった').click();
  await ui.settle();
  const today = ui.ctx.formatDate(new Date());
  assert.strictEqual(JSON.parse(server.files.get(p).text).unclear.resolvedAt, today, '「わかった」が送られる');
  assert.ok(/まだの項目はありません/.test(ui.$('review-list').textContent), '「まだ」には出ない');
  await chipByText(ui.$('review-filter'), 'すべて').click();
  assert.ok(/わかった /.test(ui.$('review-list').textContent));

  // 直しても、書いた内容と「わかった」は消えない
  ui.ctx.startEdit(rec.id);
  await buttonByText(ui.$('step-body'), '更新する').click();
  await ui.settle();
  assert.deepStrictEqual(JSON.parse(server.files.get(p).text).unclear, { text: 'ワーク p.32 問3、化学反応式の係数', resolvedAt: today });

  ui.ctx.goTo('screen-top');
  await ui.$('menu-review').click();
  await chipByText(ui.$('review-tabs'), 'ノート').click();
  await buttonByText(ui.$('review-list'), '取り消す').click();
  await ui.settle();
  assert.strictEqual(JSON.parse(server.files.get(p).text).unclear.resolvedAt, null);
});

test('わからなかったところ：書かなければ unclear は付かない。前からある記録を直しても形は変わらない（互換）', async () => {
  const server = newServer();
  const ui = makeUi(server);
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  const body = await inputUntilIssue(ui);
  await chipByText(body, '前の内容があやしい').click();
  await buttonByText(body, '次へ').click();
  await buttonByText(body, '登録する').click();
  await ui.settle();
  const first = JSON.parse([...server.files.values()][0].text);
  assert.ok(!('unclear' in first), '空欄なら付かない');

  const today = ui.ctx.formatDate(new Date());
  const old = sampleRecord({ id: today.replace(/-/g, '') + '-070000-oldx', date: today, issues: [{ id: 'i-nounder', label: 'そもそも分からない' }] });
  ui.ctx.saveRecord(old);
  await ui.settle();
  ui.ctx.startEdit(old.id);
  await buttonByText(ui.$('step-body'), '更新する').click();
  await ui.settle();
  const after = JSON.parse(server.files.get(`records/${today.slice(0, 7)}/${old.id}.json`).text);
  assert.deepStrictEqual(Object.keys(after), Object.keys(old), '項目は増えない');
  assert.ok(!('unclear' in after));
});

test('振り返り：最初は今週のまとめ。表示を「時間／学習内容／課題／計画」で切り替える。週を戻れ、今週より先には進めない。赤の警告や「未達」は出ない', async () => {
  const ui = makeUi(newServer());
  await enterToken(ui, { token: TOKEN_W, mode: 'write' });
  ui.ctx.seedSampleData();
  await ui.$('menu-review').click();
  const body = ui.$('review-summary-body');
  const text = body.textContent;
  // 最初は「時間」：時間帯×曜日の表（7日ぶんの合計つき）と、できたことの文。見出しの横に日数と合計時間
  const count = (cls) => findAll(ui.$('review-summary-body'), (e) => e.classSet.has(cls)).length;
  const headText = () => findAll(ui.$('review-summary-body'), (e) => e.classSet.has('review-head'))[0].textContent;
  assert.ok(/^できたこと\d日・/.test(headText()), headText());
  assert.ok(/数50/.test(text), text);
  assert.strictEqual(count('band-grid'), 1);
  assert.strictEqual(count('band-total'), 8, '「合計」の見出しと7日ぶん');
  assert.strictEqual(count('praise-list'), 1);
  assert.strictEqual(count('hint-card'), 0, '気づきは「計画」に出す');
  assert.strictEqual(count('subj-legend'), 0, '凡例は出さない');

  // 「学習内容」：曜日ごとに、記録ごとの3行（やったこと・時間・正答率／学習内容／量）。できたことの文は出さない
  await chipByText(ui.$('review-summary-body'), '学習内容').click();
  assert.strictEqual(count('band-grid') + count('praise-list'), 0);
  assert.strictEqual(count('day-row'), 7);
  const detail = ui.$('review-summary-body').textContent;
  assert.ok(/宿題・提出物50分〜90%/.test(detail) && /計算20分・文章題30分/.test(detail) && /宿題 6ページ/.test(detail), detail);

  // 「課題」：課題ごとの回数と教科
  await chipByText(ui.$('review-summary-body'), '課題').click();
  const issueText = ui.$('review-summary-body').textContent;
  assert.ok(/また間違えた数学\d回/.test(issueText) && /課題なしの記録 \d回/.test(issueText), issueText);
  assert.strictEqual(count('day-row') + count('band-grid') + count('praise-list'), 0);

  // 「計画」：計画の進みと気づき。見出しは変わらない
  await chipByText(ui.$('review-summary-body'), '計画').click();
  const planText = ui.$('review-summary-body').textContent;
  assert.ok(/^できたこと\d日・/.test(headText()));
  assert.ok(/計画の進み（サンプルのテスト）/.test(planText) && /テストまで あと28日/.test(planText), planText);
  assert.ok(/ヒント/.test(planText), 'サンプルでは気づきが出る');
  assert.ok(count('hint-card') >= 1 && count('hint-card') <= 3);
  assert.strictEqual(count('day-row') + count('band-grid'), 0);
  assert.ok(findAll(ui.$('review-summary-body'), (e) => e.textContent === '学習計画を開く').length === 0, '管理機能を使わない端末には出ない');
  assert.ok(!/未達|サボ|足りない/.test(text + detail + issueText + planText));
  const order = findAll(ui.$('review-summary-body'), (e) => e.classSet.has('seg')).map((e) => e.textContent);
  assert.deepStrictEqual(order, ['時間', '学習内容', '課題', '計画']);
  await chipByText(ui.$('review-summary-body'), '時間').click();
  assert.strictEqual(count('band-grid'), 1);
  assert.ok(ui.$('review-week-label').textContent.startsWith('今週'));
  assert.ok(ui.$('btn-review-next').disabled);
  await ui.$('btn-review-prev').click();
  assert.ok(!ui.$('review-week-label').textContent.startsWith('今週'));
  assert.ok(!ui.$('btn-review-next').disabled);
});

test('振り返り：見るだけの端末でも開け、ノートの「わかった」は出ない', async () => {
  const server = newServer();
  const owner = makeUi(server);
  await enterToken(owner, { token: TOKEN_W, mode: 'write' });
  const d = owner.ctx.run('formatDate(new Date())');
  const r = sampleRecord({ id: d.replace(/-/g, '') + '-193045-a3f9', date: d });
  r.unclear = { text: '連立方程式の文章題', resolvedAt: null };
  owner.ctx.saveRecord(r);
  owner.ctx.kickSync();
  await owner.settle();

  const mother = makeUi(server);
  await enterToken(mother, { token: TOKEN_R, mode: 'read' });
  await mother.$('menu-review').click();
  assert.deepStrictEqual(mother.visibleScreens(), ['screen-review']);
  await chipByText(mother.$('review-tabs'), 'ノート').click();
  assert.ok(/連立方程式の文章題/.test(mother.$('review-list').textContent));
  assert.strictEqual(findAll(mother.$('review-list'), (e) => e.tagName === 'button').length, 0);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('OK   ' + t.name);
    } catch (e) {
      failed++;
      console.log('NG   ' + t.name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n     ') : e));
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} 件 OK`);
  process.exit(failed ? 1 : 0);
})();
