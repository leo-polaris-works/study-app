// 保存の仕組み（github.js・sync.js・data.js）の論理テスト。実行：node app/tests/sync.test.js
// 偽の GitHub と偽の localStorage だけを使い、実際の通信はしない。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FakeGitHub, makeDevice, sampleRecord, APP_DIR, REPO } = require('./harness');

const TOKEN_W = 'github_pat_' + 'W'.repeat(60);
const TOKEN_W2 = 'github_pat_' + 'X'.repeat(60);
const TOKEN_R = 'github_pat_' + 'R'.repeat(60);
const FAR = '2099-12-31';

const tests = [];
const plain = (x) => JSON.parse(JSON.stringify(x));
function eq(actual, expected) {
  assert.deepStrictEqual(plain(actual), plain(expected));
}

function test(name, fn) {
  tests.push({ name, fn });
}

function newWorld() {
  const server = new FakeGitHub();
  server.addToken(TOKEN_W, 'write');
  server.addToken(TOKEN_W2, 'write');
  server.addToken(TOKEN_R, 'read');
  return server;
}

async function connect(dev, token, mode) {
  const r = await dev.ctx.connectWithToken({ token, mode: mode || 'write' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
}

function today(dev) {
  return dev.ctx.run('formatDate(new Date())');
}

function daysAgo(dev, n) {
  return dev.ctx.run(`shiftDate(formatDate(new Date()), -${n})`);
}

function idFor(date, tail) {
  return date.replace(/-/g, '') + '-193045-' + (tail || 'a3f9');
}

// 記録を作って端末に登録する（送信待ちに入る）
function register(dev, o) {
  const r = sampleRecord(o);
  dev.ctx.saveRecord(r);
  return r;
}

function serverRecord(server, p) {
  return JSON.parse(server.files.get(p).text);
}

// --- base64 ---
test('日本語・絵文字を含む JSON が base64 で往復できる', () => {
  const dev = makeDevice(newWorld(), 'iPad');
  const text = JSON.stringify({ a: '宿題・提出物', b: '先生の説明が早い😀' }, null, 2) + '\n';
  assert.strictEqual(dev.ctx.base64ToUtf8(dev.ctx.utf8ToBase64(text)), text);
  assert.strictEqual(Buffer.from(dev.ctx.utf8ToBase64(text), 'base64').toString('utf8'), text);
});

// --- 鍵の入力チェック ---
test('鍵・使い方の入力チェック', () => {
  const dev = makeDevice(newWorld(), 'iPad');
  const v = (o) => dev.ctx.validateTokenInput(o);
  assert.ok(v({ token: '', mode: 'write' }).errors.token.includes('入力されていません'));
  assert.ok(v({ token: 'github_pat_ AAAA' + 'A'.repeat(50), mode: 'write' }).errors.token.includes('使えない文字'));
  assert.ok(v({ token: 'ｇｉｔｈｕｂ_pat_' + 'A'.repeat(50), mode: 'write' }).errors.token.includes('使えない文字'));
  assert.ok(v({ token: 'ghp_' + 'A'.repeat(50), mode: 'write' }).errors.token.includes('この形の鍵は使えません'));
  assert.ok(v({ token: 'github_pat_abc', mode: 'write' }).errors.token.includes('短すぎ'));
  assert.ok(v({ token: TOKEN_W, mode: 'x' }).errors.mode);
  const ok = v({ token: '  ' + TOKEN_W + '\n', mode: 'read' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.token, TOKEN_W);
});

// --- ロック ---
test('ロック：鍵なし・入力後・鍵が使えない（401）・通信できないだけ', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  eq(dev.ctx.getLockState(), { locked: true, reason: 'nokey' });

  await connect(dev, TOKEN_W);
  assert.strictEqual(dev.ctx.getLockState().locked, false);

  dev.offline = true;
  const s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error.kind, 'network');
  assert.strictEqual(s.locked, false, '通信できないだけではロックしない');

  dev.offline = false;
  server.revokeToken(TOKEN_W);
  const s2 = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s2.error.kind, 'auth');
  assert.strictEqual(s2.locked, true);
  assert.strictEqual(s2.lockReason, 'auth');
});

test('401 でロックされても未送信の記録は残り、新しい鍵で送られる。401 のあとは連打しない', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const r = register(dev, { id: idFor(today(dev)), date: today(dev) });
  server.revokeToken(TOKEN_W);
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(dev.ctx.pendingIds().length, 1);
  const before = server.log.length;
  await dev.ctx.syncNow({ force: true });
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(server.log.length, before, 'ロック中は通信しない');

  await connect(dev, TOKEN_W2);
  assert.strictEqual(dev.ctx.getLockState().locked, false);
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(dev.ctx.pendingIds().length, 0);
  assert.ok(server.files.has(`records/${r.date.slice(0, 7)}/${r.id}.json`));
});

// --- 接続の確認 ---
test('接続の確認：誤った鍵・保存先違い・通信不可・読み取り専用の鍵（書き込みモード）', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  const tryConnect = (token, mode) => dev.ctx.connectWithToken({ token, mode: mode || 'write' });

  let r = await tryConnect('github_pat_' + 'Z'.repeat(60));
  assert.strictEqual(r.ok, false);
  assert.ok(r.message.includes('鍵が使えませんでした'));

  server.repoName = 'other';
  r = await tryConnect(TOKEN_W);
  assert.ok(r.message.includes('保存先が見つかりません'));
  server.repoName = REPO;

  dev.offline = true;
  r = await tryConnect(TOKEN_W);
  assert.ok(r.message.includes('つながりません'));
  dev.offline = false;

  r = await tryConnect(TOKEN_R, 'write');
  assert.strictEqual(r.ok, false);
  assert.ok(r.message.includes('書き込みの権限'));

  assert.strictEqual(dev.ctx.loadSyncConfig(), null, '失敗したときは保存しない');
  r = await tryConnect(TOKEN_R, 'read');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(dev.ctx.loadSyncConfig().mode, 'read');
});

test('書き込み権限がない鍵（permissions が見えない場合）は、最初の送信で 403 として表示し、記録は残る', async () => {
  const server = newWorld();
  server.hidePermissions = true;
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_R, 'write');
  register(dev, { id: idFor(today(dev)), date: today(dev) });
  const s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error.kind, 'forbidden');
  assert.ok(s.error.message.includes('書き込みの権限'));
  assert.strictEqual(s.pending, 1);
  assert.strictEqual(s.locked, false);
  assert.strictEqual(server.files.size, 0);
});

test('回数制限（403 と x-ratelimit-remaining: 0）は ratelimit として扱い、待ちに残す', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  register(dev, { id: idFor(today(dev)), date: today(dev) });
  server.failNext.push({ method: 'PUT', status: 403, message: 'API rate limit exceeded', headers: { 'x-ratelimit-remaining': '0' } });
  const s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error.kind, 'ratelimit');
  assert.strictEqual(s.pending, 1);
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(dev.ctx.pendingIds().length, 0);
});

// --- 登録・修正・削除 ---
test('登録→送信：records/YYYY-MM/<id>.json に 02 の形で保存され、送信待ちが空になる', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const date = today(dev);
  const r = register(dev, { id: idFor(date), date, issues: [{ id: 'i-free', label: 'その他', text: '先生の説明が早い' }] });
  assert.strictEqual(dev.ctx.pendingIds().length, 1);
  await dev.ctx.syncNow({ force: true });
  const p = `records/${date.slice(0, 7)}/${r.id}.json`;
  assert.ok(server.files.has(p));
  assert.strictEqual(server.files.get(p).text, JSON.stringify(r, null, 2) + '\n');
  assert.deepStrictEqual(serverRecord(server, p), r);
  assert.strictEqual(dev.ctx.pendingIds().length, 0);
  const put = server.requests('PUT')[0];
  assert.strictEqual(put.body.message, `記録 ${r.id}`);
  assert.strictEqual(put.body.sha, undefined);
});

test('修正は sha つきの上書き、削除は deleted: true でファイルが残る', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const date = today(dev);
  const r = register(dev, { id: idFor(date), date });
  await dev.ctx.syncNow({ force: true });
  const p = `records/${date.slice(0, 7)}/${r.id}.json`;
  const sha1st = server.files.get(p).sha;

  const edited = Object.assign({}, r, { totalMinutes: 25, fields: [{ id: 'f-en-word', label: '単語・熟語', minutes: 25 }], updatedAt: '2099-01-01T10:00:00+09:00' });
  dev.ctx.updateRecord(edited);
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(serverRecord(server, p).totalMinutes, 25);
  assert.strictEqual(serverRecord(server, p).createdAt, r.createdAt);
  const put2 = server.requests('PUT')[1];
  assert.strictEqual(put2.body.sha, sha1st);
  assert.strictEqual(put2.body.message, `修正 ${r.id}`);

  dev.ctx.markRecordDeleted(r.id);
  await dev.ctx.syncNow({ force: true });
  assert.ok(server.files.has(p), 'ファイルは残る');
  assert.strictEqual(serverRecord(server, p).deleted, true);
  assert.strictEqual(server.requests('PUT')[2].body.message, `削除 ${r.id}`);
  assert.strictEqual(dev.ctx.recentRecords().length, 0);
});

test('勉強日の月が変わる修正でも、保存先パスは最初の月のまま（重複ファイルを作らない）', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const r = register(dev, { id: '20260930-193045-a3f9', date: '2026-09-30' });
  dev.ctx.updateRecord(Object.assign({}, r, { date: '2026-10-01', updatedAt: '2026-10-01T08:00:00+09:00' }));
  await dev.ctx.syncNow({ force: true });
  assert.deepStrictEqual([...server.files.keys()], ['records/2026-09/20260930-193045-a3f9.json']);
});

// --- オフライン ---
test('通信できないとき：待ちに残り、何度直しても復帰後に最後の状態が1回だけ送られる', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  dev.offline = true;
  const date = today(dev);
  const r = register(dev, { id: idFor(date), date });
  let s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error.kind, 'network');
  assert.strictEqual(s.pending, 1);
  dev.ctx.updateRecord(Object.assign({}, r, { totalMinutes: 15, fields: [{ id: 'f-en-word', label: '単語・熟語', minutes: 15 }], updatedAt: '2099-01-01T10:00:00+09:00' }));
  dev.ctx.updateRecord(Object.assign({}, r, { totalMinutes: 10, fields: [{ id: 'f-en-word', label: '単語・熟語', minutes: 10 }], updatedAt: '2099-01-01T11:00:00+09:00' }));
  assert.strictEqual(dev.ctx.pendingIds().length, 1);
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(server.requests('PUT').length, 0);

  dev.offline = false;
  s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error, null);
  assert.strictEqual(s.pending, 0);
  assert.strictEqual(server.requests('PUT').length, 1);
  assert.strictEqual(serverRecord(server, `records/${date.slice(0, 7)}/${r.id}.json`).totalMinutes, 10);
});

test('複数の送信待ちは順番に送られ、途中で通信が切れたら残りは待ちに残る', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const date = today(dev);
  register(dev, { id: idFor(date, 'aaaa'), date });
  register(dev, { id: idFor(date, 'bbbb'), date });
  register(dev, { id: idFor(date, 'cccc'), date });
  server.failNext.push({ method: 'PUT', status: 500, message: 'x' });
  let s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error.kind, 'server');
  assert.strictEqual(s.pending, 3);
  s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.pending, 0);
  assert.strictEqual(server.files.size, 3);
});

// --- 同時書き込み・競合 ---
test('409（同時に別の書き込み）は待ってやり直して送れる', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const date = today(dev);
  register(dev, { id: idFor(date), date });
  server.failNext.push({ method: 'PUT', status: 409, message: 'branch moved' });
  const s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error, null);
  assert.strictEqual(s.pending, 0);
  assert.strictEqual(server.requests('PUT').length, 2, '1回目は注入した 409、2回目で成功');
  assert.strictEqual(server.files.size, 1);
});

test('409 が続いたら、待ちに残して conflict として表示する', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const date = today(dev);
  register(dev, { id: idFor(date), date });
  for (let i = 0; i < 3; i++) server.failNext.push({ method: 'PUT', status: 409, message: 'branch moved' });
  const s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error.kind, 'conflict');
  assert.strictEqual(s.pending, 1);
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(dev.ctx.pendingIds().length, 0);
});

test('送信は通ったが返事が届かなかった場合、次の送信で重複せず成功扱いになる', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const date = today(dev);
  const r = register(dev, { id: idFor(date), date });
  server.dropResponseOnce = true;
  let s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error.kind, 'network');
  assert.strictEqual(s.pending, 1);
  assert.strictEqual(server.files.size, 1);
  s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error, null);
  assert.strictEqual(s.pending, 0);
  assert.strictEqual(server.files.size, 1);
  const p = `records/${date.slice(0, 7)}/${r.id}.json`;
  assert.strictEqual(dev.ctx.getMeta(r.id).sha, server.files.get(p).sha);
});

test('同じ記録を2台で直した：updatedAt が新しいほうが残る（両方向）', async () => {
  for (const aIsNewer of [true, false]) {
    const server = newWorld();
    const a = makeDevice(server, 'iPad');
    const b = makeDevice(server, 'Android');
    await connect(a, TOKEN_W);
    await connect(b, TOKEN_W2);
    const date = today(a);
    const r = register(a, { id: idFor(date), date });
    await a.ctx.syncNow({ force: true });
    await b.ctx.syncNow({ force: true });
    assert.strictEqual(b.ctx.findRecord(r.id).id, r.id);

    const edit = (minutes, at) =>
      Object.assign({}, r, { totalMinutes: minutes, fields: [{ id: 'f-en-word', label: '単語・熟語', minutes }], updatedAt: at });
    a.ctx.updateRecord(edit(25, aIsNewer ? '2099-01-01T12:00:00+09:00' : '2099-01-01T10:00:00+09:00'));
    b.ctx.updateRecord(edit(15, aIsNewer ? '2099-01-01T10:00:00+09:00' : '2099-01-01T12:00:00+09:00'));
    await a.ctx.syncNow({ force: true });
    const sb = await b.ctx.syncNow({ force: true });
    const winner = aIsNewer ? 25 : 15;
    const p = `records/${date.slice(0, 7)}/${r.id}.json`;
    assert.strictEqual(serverRecord(server, p).totalMinutes, winner);
    assert.strictEqual(b.ctx.findRecord(r.id).totalMinutes, winner);
    assert.strictEqual(b.ctx.pendingIds().length, 0);
    assert.strictEqual(sb.error, null);
    if (aIsNewer) assert.ok(sb.notice.includes('別の端末'));
    await a.ctx.syncNow({ force: true });
    assert.strictEqual(a.ctx.findRecord(r.id).totalMinutes, winner);
  }
});

// --- 2台での取り込み ---
test('2台：Aの登録がBの一覧に出る／Bの修正がAに反映される／Aの削除でBの一覧から消える', async () => {
  const server = newWorld();
  const a = makeDevice(server, 'iPad');
  const b = makeDevice(server, 'Android');
  await connect(a, TOKEN_W);
  await connect(b, TOKEN_W2);
  const date = today(a);
  const r = register(a, { id: idFor(date), date });
  await a.ctx.syncNow({ force: true });

  await b.ctx.syncNow({ force: true });
  eq(b.ctx.recentRecords().map((x) => x.id), [r.id]);

  b.ctx.updateRecord(Object.assign({}, b.ctx.findRecord(r.id), { totalMinutes: 25, fields: [{ id: 'f-en-word', label: '単語・熟語', minutes: 25 }], updatedAt: '2099-01-01T10:00:00+09:00' }));
  await b.ctx.syncNow({ force: true });
  await a.ctx.syncNow({ force: true });
  assert.strictEqual(a.ctx.findRecord(r.id).totalMinutes, 25);

  a.ctx.run("localIso = () => '2099-06-01T00:00:00+09:00'"); // 削除の時刻を、Bの修正より後にそろえる
  a.ctx.markRecordDeleted(r.id);
  await a.ctx.syncNow({ force: true });
  await b.ctx.syncNow({ force: true });
  assert.strictEqual(b.ctx.recentRecords().length, 0);
  assert.strictEqual(b.ctx.findRecord(r.id).deleted, true);
});

test('取り込みの範囲：63日より前の作成分は取りにいかない。変わっていないファイルは再取得しない', async () => {
  const server = newWorld();
  const a = makeDevice(server, 'iPad');
  const b = makeDevice(server, 'Android');
  await connect(a, TOKEN_W);
  await connect(b, TOKEN_W2);
  const recent = daysAgo(a, 10);
  const edge = daysAgo(a, 62);
  const old = daysAgo(a, 70);
  [recent, edge, old].forEach((d, i) => {
    const r = sampleRecord({ id: idFor(d, 'q' + i + 'zz'), date: d });
    server.putFile(`records/${d.slice(0, 7)}/${r.id}.json`, JSON.stringify(r, null, 2) + '\n');
  });
  await b.ctx.syncNow({ force: true });
  const ids = b.ctx.loadRecords().map((x) => x.id).sort();
  eq(ids, [idFor(edge, 'q1zz'), idFor(recent, 'q0zz')].sort());
  assert.ok(!server.requests('GET').some((x) => x.url.includes(idFor(old, 'q2zz'))));
  eq(b.ctx.recentRecords(14).map((x) => x.date), [recent]);

  const gets = server.requests('GET').filter((x) => x.url.includes('.json')).length;
  await b.ctx.syncNow({ force: true });
  assert.strictEqual(server.requests('GET').filter((x) => x.url.includes('.json')).length, gets, '2回目は再取得しない');
});

test('壊れた JSON・形が違う記録・ファイル名と id が違う記録は取り込まない（ほかは取り込む）', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const date = today(dev);
  const dir = `records/${date.slice(0, 7)}`;
  const good = sampleRecord({ id: idFor(date, 'good'), date });
  server.putFile(`${dir}/${good.id}.json`, JSON.stringify(good));
  server.putFile(`${dir}/${idFor(date, 'brok')}.json`, '{ not json');
  const bad = sampleRecord({ id: idFor(date, 'shap'), date });
  delete bad.fields;
  server.putFile(`${dir}/${bad.id}.json`, JSON.stringify(bad));
  const mismatch = sampleRecord({ id: idFor(date, 'othr'), date });
  server.putFile(`${dir}/${idFor(date, 'misx')}.json`, JSON.stringify(mismatch));
  server.putFile(`${dir}/memo.txt`, 'x');
  const s = await dev.ctx.syncNow({ force: true });
  assert.strictEqual(s.error, null);
  eq(dev.ctx.loadRecords().map((x) => x.id), [good.id]);
});

// --- 閲覧モード ---
test('見るだけ：取り込みだけ行い、書き込みの API を1回も呼ばない', async () => {
  const server = newWorld();
  const a = makeDevice(server, 'iPad');
  const mother = makeDevice(server, 'Android');
  await connect(a, TOKEN_W);
  await connect(mother, TOKEN_R, 'read');
  const date = today(a);
  const r = register(a, { id: idFor(date), date });
  await a.ctx.syncNow({ force: true });

  mother.ctx.markPending(sampleRecord({ id: idFor(date, 'mom1'), date })); // 万一送信待ちがあっても送らない
  const before = server.requests('PUT').length;
  const s = await mother.ctx.syncNow({ force: true });
  assert.strictEqual(s.error, null);
  assert.strictEqual(server.requests('PUT').length, before);
  eq(mother.ctx.recentRecords().map((x) => x.id), [r.id]);
  assert.strictEqual(s.mode, 'read');
});

// --- 鍵を消す ---
test('鍵を消す：送信済みの控えは消え、送信待ちは残り、ロックされる', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const date = today(dev);
  register(dev, { id: idFor(date, 'sent'), date });
  await dev.ctx.syncNow({ force: true });
  dev.offline = true;
  register(dev, { id: idFor(date, 'wait'), date });
  await dev.ctx.syncNow({ force: true });

  dev.ctx.disconnectSync();
  eq(dev.ctx.loadRecords().map((x) => x.id), [idFor(date, 'wait')]);
  assert.strictEqual(dev.ctx.getLockState().reason, 'nokey');
  assert.strictEqual(dev.ctx.loadSyncConfig(), null);
  dev.offline = false;
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(server.files.size, 1, 'ロック中は送らない');
  await connect(dev, TOKEN_W);
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(server.files.size, 2);
});

// --- 取り込みの間隔・サンプル ---
test('取り込みは force なしなら60秒に1回まで（送信があったときを除く）', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  await dev.ctx.syncNow({ force: true });
  const n = server.log.length;
  await dev.ctx.syncNow({});
  assert.strictEqual(server.log.length, n);
  register(dev, { id: idFor(today(dev)), date: today(dev) });
  await dev.ctx.syncNow({});
  assert.ok(server.log.length > n);
});

test('サンプルデータ（sample-）は送らない。モックの古い保存は捨てる', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  dev.store.set('study_mock_records_v5', '[{"id":"x"}]');
  dev.ctx.run('localStorage.removeItem("study_mock_records_v5")'); // 起動時の掃除と同じ
  await connect(dev, TOKEN_W);
  dev.ctx.seedSampleData();
  assert.ok(dev.ctx.recentRecords().length > 0);
  assert.strictEqual(dev.ctx.pendingIds().length, 0);
  await dev.ctx.syncNow({ force: true });
  assert.strictEqual(server.requests('PUT').length, 0);
});

test('起動時に、モック段階の保存キーが消える', () => {
  const server = newWorld();
  const store = new Map([['study_mock_records_v5', '[{"id":"x"}]']]);
  const vm = require('vm');
  const ctx = vm.createContext({
    localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    navigator: { userAgent: 'Android', maxTouchPoints: 5 },
  });
  ['config.js', 'master.js', 'data.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(APP_DIR, f), 'utf8'), ctx));
  assert.strictEqual(store.has('study_mock_records_v5'), false);
  assert.ok(server);
});

// --- 鍵の扱い ---
test('鍵は Authorization ヘッダーだけに入り、URL・本文・記録・保存データの他のキーには出ない。送信先は api.github.com だけ', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const date = today(dev);
  register(dev, { id: idFor(date), date });
  await dev.ctx.syncNow({ force: true });
  assert.ok(server.log.length > 3);
  server.log.forEach((req) => {
    assert.ok(req.url.startsWith('https://api.github.com/'), req.url);
    assert.ok(!req.url.includes(TOKEN_W));
    assert.ok(!JSON.stringify(req.body || {}).includes(TOKEN_W));
    assert.strictEqual(req.headers.Authorization, 'Bearer ' + TOKEN_W);
  });
  server.files.forEach((f) => assert.ok(!f.text.includes(TOKEN_W)));
  dev.store.forEach((v, k) => {
    if (k !== 'study_sync_v1') assert.ok(!String(v).includes(TOKEN_W), k);
  });
});

// --- 静的検査 ---
test('app/ の公開ファイルに、鍵・氏名・学校名らしき文字列が入っていない', () => {
  const files = fs.readdirSync(APP_DIR).filter((f) => /\.(js|html|css|json)$/.test(f));
  files.forEach((f) => {
    const text = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
    assert.ok(!/github_pat_[A-Za-z0-9_]{20,}/.test(text), f + ' に鍵らしき文字列');
    assert.ok(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(text), f + ' に鍵らしき文字列');
    assert.ok(!/(中学校|小学校|高校)/.test(text), f + ' に学校名らしき語');
  });
});

// --- 学習計画 ---
function makePlan(dev, o) {
  const p = plain(dev.ctx.newPlan());
  p.name = o.name || '後期中間';
  p.testDate = o.testDate || '2099-11-20';
  p.items = o.items || [{ materialId: 'm-sc-work', subject: '理科', label: 'ワーク', unit: 'ページ', amount: 40, laps: 3 }];
  return p;
}

test('計画：plans/<id>.json に保存され、別の端末に取り込まれる。修正・削除も届く', async () => {
  const server = newWorld();
  const a = makeDevice(server, 'iPad');
  const b = makeDevice(server, 'Android');
  await connect(a, TOKEN_W);
  await connect(b, TOKEN_W2);
  const p = makePlan(a, {});
  a.ctx.savePlan(p);
  eq(a.ctx.getSyncSummary().pending, 1);
  await a.ctx.syncNow({ force: true });
  const path = `plans/${p.id}.json`;
  assert.ok(server.files.has(path), '計画のファイルができる');
  eq(JSON.parse(server.files.get(path).text).items[0].amount, 40);
  eq(a.ctx.pendingPlanIds(), []);

  await b.ctx.syncNow({ force: true });
  eq(b.ctx.loadActivePlans().map((x) => x.id), [p.id]);

  const edited = plain(b.ctx.findPlan(p.id));
  edited.items[0].amount = 50;
  edited.updatedAt = '2099-01-01T00:00:00+09:00';
  b.ctx.putPlan(edited);
  b.ctx.markPlanPending(edited);
  await b.ctx.syncNow({ force: true });
  await a.ctx.syncNow({ force: true });
  eq(a.ctx.findPlan(p.id).items[0].amount, 50);

  a.ctx.markPlanDeleted(p.id);
  const del = plain(a.ctx.findPlan(p.id));
  del.updatedAt = '2099-01-02T00:00:00+09:00';
  a.ctx.putPlan(del);
  await a.ctx.syncNow({ force: true });
  await b.ctx.syncNow({ force: true });
  eq(b.ctx.loadActivePlans(), []);
  assert.ok(server.files.has(path), '削除は印だけでファイルは残る');
});

test('計画：同じ計画を2台で直したら updatedAt が新しいほうが残る。形が違う計画は取り込まない', async () => {
  const server = newWorld();
  const a = makeDevice(server, 'iPad');
  const b = makeDevice(server, 'Android');
  await connect(a, TOKEN_W);
  await connect(b, TOKEN_W2);
  const p = makePlan(a, {});
  p.updatedAt = '2099-01-01T00:00:00+09:00';
  a.ctx.putPlan(p);
  a.ctx.markPlanPending(p);
  await a.ctx.syncNow({ force: true });
  await b.ctx.syncNow({ force: true });

  const newer = plain(b.ctx.findPlan(p.id));
  newer.name = '新しいほう';
  newer.updatedAt = '2099-01-03T00:00:00+09:00';
  b.ctx.putPlan(newer);
  b.ctx.markPlanPending(newer);
  await b.ctx.syncNow({ force: true });

  const older = plain(a.ctx.findPlan(p.id));
  older.name = '古いほう';
  older.updatedAt = '2099-01-02T00:00:00+09:00';
  a.ctx.putPlan(older);
  a.ctx.markPlanPending(older);
  const r = await a.ctx.syncNow({ force: true });
  eq(a.ctx.findPlan(p.id).name, '新しいほう');
  assert.ok(/そろえました/.test(r.notice));

  const bad = makePlan(a, {});
  bad.id = 'plan-20990101-000000-badx';
  bad.months = 'x';
  server.putFile(`plans/${bad.id}.json`, JSON.stringify(bad));
  server.putFile('plans/README.md', 'x');
  await b.ctx.syncNow({ force: true });
  assert.ok(!b.ctx.findPlan(bad.id), '形が違う計画は取り込まない');
});

test('計画：鍵を消すと送信済みの計画の控えは消え、送信待ちの計画は残る', async () => {
  const server = newWorld();
  const dev = makeDevice(server, 'iPad');
  await connect(dev, TOKEN_W);
  const sent = makePlan(dev, {});
  dev.ctx.savePlan(sent);
  await dev.ctx.syncNow({ force: true });
  dev.offline = true;
  const waiting = makePlan(dev, {});
  waiting.id = 'plan-20990101-000000-wait';
  dev.ctx.savePlan(waiting);
  await dev.ctx.syncNow({ force: true });
  dev.ctx.disconnectSync();
  eq(dev.ctx.loadPlans().map((x) => x.id), [waiting.id]);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('OK   ' + t.name);
    } catch (e) {
      failed++;
      console.log('NG   ' + t.name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e));
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} 件 OK`);
  process.exit(failed ? 1 : 0);
})();
