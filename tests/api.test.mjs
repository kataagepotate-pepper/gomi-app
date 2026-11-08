// サーバーの動きを確かめるテスト（PCの中のデータベース PGlite を使う）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createLocalApi } from "../server/local.js";

const api = await createLocalApi({ dataDir: mkdtempSync(join(tmpdir(), "gomi-test-")) });
const call = async (method, path, body) => {
  const init = { method };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await api.fetchApi(new Request(`http://t${path}`, init));
  return { status: res.status, headers: res.headers, data: await res.json() };
};
// 書き込みには所属付きの記録者名が要る。テストでは指定がなければ施設管理の人として送る
const STAFF = "たなか（施設管理）";
const withStaff = (body) => (body && typeof body === "object" && !("staff" in body) ? { ...body, staff: STAFF } : body);
const add = (body) => call("POST", "/api/records", withStaff(body));
const cancelRec = (id, staff = STAFF) => call("POST", `/api/records/${id}/cancel`, { staff });
const patch = (path, body) => call("PATCH", path, withStaff(body));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("最初の状態：28店がそろっていて、記録は0件", async () => {
  const res = await call("GET", "/api/state?day=1");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.data.stores.length, 28);
  assert.deepEqual(res.data.stores[0], { no: 1, name: "売店1" });
  assert.deepEqual(res.data.stores[1], { no: 2, name: "売店2" });
  assert.deepEqual(res.data.stores[27], { no: 28, name: "売店28" });
  assert.deepEqual(res.data.records, []);
  assert.match(res.data.server_time, ISO);
});

test("記録を追加すると 201 で記録が返り、state に新しい順で出る", async () => {
  const a = await add({ store_no: 3, fes_day: 1, kind: "ok", staff: "  たなか（施設管理）  " });
  assert.equal(a.status, 201);
  const r = a.data.record;
  assert.equal(typeof r.id, "number");
  assert.deepEqual(
    { store_no: r.store_no, fes_day: r.fes_day, kind: r.kind, bags: r.bags, staff: r.staff, canceled_at: r.canceled_at },
    { store_no: 3, fes_day: 1, kind: "ok", bags: null, staff: "たなか（施設管理）", canceled_at: null },
  );
  assert.match(r.created_at, ISO);

  const b = await add({ store_no: 3, fes_day: 1, kind: "bags", bags: 5 });
  assert.equal(b.status, 201);
  assert.equal(b.data.record.bags, 5);
  assert.equal(b.data.record.staff, STAFF);

  const c = await add({ store_no: 3, fes_day: 1, kind: "returned", staff: "すずき（本部）" });
  assert.equal(c.data.record.staff, "すずき（本部）");
  const d = await add({ store_no: 3, fes_day: 1, kind: "finished", bags: null });
  assert.equal(d.status, 201);

  const { data } = await call("GET", "/api/state?day=1");
  const mine = data.records.filter((x) => x.store_no === 3).map((x) => x.id);
  assert.deepEqual(mine, [d.data.record.id, c.data.record.id, b.data.record.id, r.id], "新しい順");
});

test("入力のまちがいは 400 で、日本語のエラーが返る（記録は増えない）", async () => {
  const before = (await call("GET", "/api/state?day=2")).data.records.length;
  const bad = [
    {}, // 何もない
    { store_no: "1", fes_day: 2, kind: "ok" }, // 番号が文字列
    { store_no: 1.5, fes_day: 2, kind: "ok" },
    { store_no: 0, fes_day: 2, kind: "ok" },
    { store_no: -1, fes_day: 2, kind: "ok" },
    { store_no: 1, fes_day: 3, kind: "ok" }, // 日付が範囲外
    { store_no: 1, fes_day: "2", kind: "ok" },
    { store_no: 1, kind: "ok" },
    { store_no: 1, fes_day: 2, kind: "OK" }, // 種類が違う
    { store_no: 1, fes_day: 2 },
    { store_no: 1, fes_day: 2, kind: "bags" }, // 枚数なし
    { store_no: 1, fes_day: 2, kind: "bags", bags: 0 },
    { store_no: 1, fes_day: 2, kind: "bags", bags: 6 },
    { store_no: 1, fes_day: 2, kind: "bags", bags: 2.5 },
    { store_no: 1, fes_day: 2, kind: "bags", bags: "3" },
    { store_no: 1, fes_day: 2, kind: "ok", bags: 1 }, // bags 以外で枚数あり
    { store_no: 1, fes_day: 2, kind: "ok", staff: "あ".repeat(21) }, // 名前が長すぎ
    { store_no: 1, fes_day: 2, kind: "ok", staff: 123 },
  ];
  for (const body of bad) {
    const res = await add(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof res.data.error, "string");
  }
  // 20文字ちょうどはOK（絵文字も1文字と数える）
  assert.equal((await add({ store_no: 1, fes_day: 2, kind: "ok", staff: "😀".repeat(14) + "（施設管理）" })).status, 201);

  // JSONとして読めない・配列
  assert.equal((await add("{oops")).status, 400);
  assert.equal((await add("[1,2]")).status, 400);
  // 大きすぎる送信データ
  assert.equal((await add({ store_no: 1, fes_day: 2, kind: "ok", staff: "x".repeat(3000) })).status, 413);

  const after = (await call("GET", "/api/state?day=2")).data.records.length;
  assert.equal(after, before + 1);
});

test("存在しない店への記録は 404", async () => {
  const res = await add({ store_no: 29, fes_day: 1, kind: "ok" });
  assert.equal(res.status, 404);
  assert.equal(res.data.error, "店が見つかりません");
});

test("取り消し：canceled_at が入り、2回押しても同じ時刻のまま", async () => {
  const { data } = await add({ store_no: 7, fes_day: 1, kind: "finished" });
  const id = data.record.id;

  const first = await cancelRec(id);
  assert.equal(first.status, 200);
  assert.match(first.data.record.canceled_at, ISO);
  assert.equal(first.data.record.kind, "finished");

  const second = await cancelRec(id);
  assert.equal(second.status, 200);
  assert.equal(second.data.record.canceled_at, first.data.record.canceled_at);

  // 同時に何回押されても全部成功し、時刻は1つ
  const many = await Promise.all(Array.from({ length: 5 }, () => cancelRec(id)));
  for (const r of many) assert.equal(r.data.record.canceled_at, first.data.record.canceled_at);

  // 取り消した記録も state に残る（履歴に「取り消し」と出すため）
  const state = await call("GET", "/api/state?day=1");
  assert.equal(state.data.records.find((r) => r.id === id).canceled_at, first.data.record.canceled_at);
});

test("取り消し：存在しない・おかしい番号は 404", async () => {
  for (const id of ["999999", "0", "abc", "1.5", "-1", "99999999999"]) {
    assert.equal((await cancelRec(id)).status, 404, id);
  }
});

test("店舗名の変更", async () => {
  const res = await patch("/api/stores/15", { name: "  コラボ店舗 A  " });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.store, { no: 15, name: "コラボ店舗 A" });

  const { data } = await call("GET", "/api/state?day=1");
  assert.equal(data.stores.find((s) => s.no === 15).name, "コラボ店舗 A");

  // 40文字ちょうどはOK、41文字・空・空白だけ・文字列以外はダメ
  assert.equal((await patch("/api/stores/16", { name: "あ".repeat(40) })).status, 200);
  for (const name of ["あ".repeat(41), "", "   ", 123, null, undefined]) {
    assert.equal((await patch("/api/stores/16", { name })).status, 400, String(name));
  }
  assert.equal((await patch("/api/stores/29", { name: "新しい店" })).status, 404);
  assert.equal((await patch("/api/stores/abc", { name: "新しい店" })).status, 404);
});

test("day の絞り込み：その日の記録だけが返る", async () => {
  const one = await add({ store_no: 20, fes_day: 1, kind: "ok" });
  const two = await add({ store_no: 20, fes_day: 2, kind: "returned" });
  const d1 = (await call("GET", "/api/state?day=1")).data.records;
  const d2 = (await call("GET", "/api/state?day=2")).data.records;
  assert.ok(d1.every((r) => r.fes_day === 1));
  assert.ok(d2.every((r) => r.fes_day === 2));
  assert.ok(d1.some((r) => r.id === one.data.record.id) && !d1.some((r) => r.id === two.data.record.id));
  assert.ok(d2.some((r) => r.id === two.data.record.id) && !d2.some((r) => r.id === one.data.record.id));

  for (const q of ["", "?day=-1", "?day=3", "?day=01", "?day=1.0", "?day=abc"]) {
    assert.equal((await call("GET", `/api/state${q}`)).status, 400, q);
  }
});

test("知らないURL・メソッドは 404", async () => {
  assert.equal((await call("GET", "/api/records")).status, 404);
  assert.equal((await call("DELETE", "/api/records/1")).status, 404);
  assert.equal((await call("POST", "/api/stores/1", { name: "x" })).status, 404);
  assert.equal((await call("GET", "/api/games")).status, 404);
});

test("schema.sql は2回流しても壊れず、変えた店舗名や記録はそのまま", async () => {
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const pg = new PGlite();
  await pg.exec(schema);
  await pg.query("update gomi_stores set name = '変更後' where no = 1");
  await pg.query("insert into gomi_records (store_no, fes_day, kind) values (1, 1, 'ok')");
  await pg.exec(schema);
  const { rows: stores } = await pg.query("select count(*)::int as n from gomi_stores");
  assert.equal(stores[0].n, 28);
  const { rows: s1 } = await pg.query("select name from gomi_stores where no = 1");
  assert.equal(s1[0].name, "変更後");
  const { rows: rec } = await pg.query("select count(*)::int as n from gomi_records");
  assert.equal(rec[0].n, 1);
  // データベース側の決まり（チェック制約）も効いている
  await assert.rejects(pg.query("insert into gomi_records (store_no, fes_day, kind, bags) values (1, 1, 'ok', 2)"));
  await assert.rejects(pg.query("insert into gomi_records (store_no, fes_day, kind) values (1, 3, 'ok')"));
  await assert.rejects(pg.query("insert into gomi_records (store_no, fes_day, kind) values (99, 1, 'ok')"));
  await pg.close();
});

test("記録の上限：1店・1日150件まで（取り消しも数える）。別の店・別の日は影響なし", async () => {
  const body = { store_no: 10, fes_day: 1, kind: "ok" };
  for (let i = 1; i <= 150; i++) {
    const res = await add(body);
    assert.equal(res.status, 201, `${i}件目`);
    if (i === 1) assert.equal((await cancelRec(res.data.record.id)).status, 200);
  }
  const over = await add(body);
  assert.equal(over.status, 429);
  assert.equal(over.data.error, "この店の今日の記録が上限（150件）に達しました。施設管理の担当者に連絡してください");
  assert.equal((await add({ store_no: 10, fes_day: 1, kind: "bags", bags: 1 })).status, 429, "種類が違っても数える");

  assert.equal((await add({ store_no: 10, fes_day: 2, kind: "ok" })).status, 201, "別の日はOK");
  assert.equal((await add({ store_no: 11, fes_day: 1, kind: "ok" })).status, 201, "別の店はOK");
  assert.equal((await add({ store_no: 99, fes_day: 1, kind: "ok" })).status, 404, "存在しない店は404のまま");

  const { data } = await call("GET", "/api/state?day=1");
  assert.equal(data.records.filter((r) => r.store_no === 10).length, 150);
});

test("記録の上限：同時にたくさん送っても150件を超えない", async () => {
  const results = await Promise.all(Array.from({ length: 170 }, () => add({ store_no: 12, fes_day: 2, kind: "ok" })));
  assert.equal(results.filter((r) => r.status === 201).length, 150);
  assert.equal(results.filter((r) => r.status === 429).length, 20);
  const { data } = await call("GET", "/api/state?day=2");
  assert.equal(data.records.filter((r) => r.store_no === 12).length, 150);
});

test("練習（day=0）：記録・取得ができ、本番の日と混ざらない", async () => {
  const p = await add({ store_no: 4, fes_day: 0, kind: "ok", staff: "れんしゅう（施設管理）" });
  assert.equal(p.status, 201);
  assert.equal(p.data.record.fes_day, 0);
  const one = await add({ store_no: 4, fes_day: 1, kind: "returned" });

  const d0 = await call("GET", "/api/state?day=0");
  assert.equal(d0.status, 200);
  assert.equal(d0.data.stores.length, 28);
  assert.ok(d0.data.records.length > 0 && d0.data.records.every((r) => r.fes_day === 0));
  assert.ok(d0.data.records.some((r) => r.id === p.data.record.id));
  assert.ok(!d0.data.records.some((r) => r.id === one.data.record.id));
  const d1 = (await call("GET", "/api/state?day=1")).data.records;
  assert.ok(!d1.some((r) => r.id === p.data.record.id));

  assert.equal((await cancelRec(p.data.record.id)).status, 200);
  for (const fes_day of [3, -1, "0", null]) {
    assert.equal((await add({ store_no: 4, fes_day, kind: "ok" })).status, 400, String(fes_day));
  }
});

test("練習（day=0）にも1店150件の上限が効く", async () => {
  for (let i = 0; i < 150; i++) assert.equal((await add({ store_no: 13, fes_day: 0, kind: "ok" })).status, 201);
  assert.equal((await add({ store_no: 13, fes_day: 0, kind: "ok" })).status, 429);
  assert.equal((await add({ store_no: 13, fes_day: 1, kind: "ok" })).status, 201, "本番の日は別に数える");
});

test("古い決まり（1と2だけ）で作った表も、schema.sql を流せば0を受け付ける", async () => {
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const pg = new PGlite();
  // 前の版の schema.sql と同じ決まりの表を先に作っておく
  await pg.exec(schema.replace("check (fes_day in (0, 1, 2)),", "check (fes_day in (1, 2)),").split("-- 練習用の 0 を足したとき")[0]);
  await pg.exec("insert into gomi_stores (no, name) values (1, 'a') on conflict do nothing");
  await assert.rejects(pg.query("insert into gomi_records (store_no, fes_day, kind) values (1, 0, 'ok')"));
  await pg.exec(schema);
  await pg.exec(schema); // 2回流しても壊れない
  await pg.query("insert into gomi_records (store_no, fes_day, kind) values (1, 0, 'ok')");
  await assert.rejects(pg.query("insert into gomi_records (store_no, fes_day, kind) values (1, 3, 'ok')"));
  const { rows } = await pg.query(
    "select count(*)::int as n from pg_constraint where conname = 'gomi_records_day'",
  );
  assert.equal(rows[0].n, 1, "制約は1つだけ");
  await pg.close();
});

// ---- メモ（報告書用） ----
const addNote = (body) => call("POST", "/api/notes", withStaff(body));
const cancelNote = (id, staff = STAFF) => call("POST", `/api/notes/${id}/cancel`, { staff });

test("メモ：追加すると 201 で返り、state の notes に新しい順で出る（改行はそのまま）", async () => {
  const a = await addNote({ fes_day: 1, body: "  15時 3号館前の袋が満タン\r\n分別OK\n\n追加で2枚  ", staff: " たなか（本部） " });
  assert.equal(a.status, 201);
  const n = a.data.note;
  assert.equal(typeof n.id, "number");
  assert.equal(n.fes_day, 1);
  assert.equal(n.body, "15時 3号館前の袋が満タン\n分別OK\n\n追加で2枚");
  assert.equal(n.staff, "たなか（本部）");
  assert.match(n.created_at, ISO);
  assert.equal(n.canceled_at, null);

  const b = await addNote({ fes_day: 1, body: "<b>太字にならない</b>\t& タブは空白に​\u0007" });
  assert.equal(b.status, 201);
  assert.equal(b.data.note.body, "<b>太字にならない</b> & タブは空白に", "HTMLはそのまま文字として保存、見えない文字は除去");
  assert.equal(b.data.note.staff, STAFF);

  const { data } = await call("GET", "/api/state?day=1");
  assert.ok(Array.isArray(data.notes));
  const ids = data.notes.map((x) => x.id);
  assert.ok(ids.indexOf(b.data.note.id) < ids.indexOf(n.id), "新しい順");
  assert.ok("stores" in data && "records" in data && "server_time" in data, "既存のキーはそのまま");
});

test("メモ：入力のまちがいは 400（メモは増えない）", async () => {
  const before = (await call("GET", "/api/state?day=2")).data.notes.length;
  const bad = [
    {},
    { fes_day: 2 }, // 本文なし
    { fes_day: 2, body: "" },
    { fes_day: 2, body: "  \n\n  " }, // 空白と改行だけ
    { fes_day: 2, body: 123 },
    { fes_day: 2, body: "あ".repeat(501) },
    { fes_day: 3, body: "x" },
    { fes_day: -1, body: "x" },
    { fes_day: "1", body: "x" },
    { body: "x" },
    { fes_day: 2, body: "x", staff: "あ".repeat(21) },
    { fes_day: 2, body: "x", staff: 1 },
  ];
  for (const body of bad) {
    const res = await addNote(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(typeof res.data.error, "string");
  }
  // 500文字ちょうど（日本語・改行入り）はOK
  const ok = await addNote({ fes_day: 2, body: ("あ".repeat(49) + "\n").repeat(10) });
  assert.equal(ok.status, 201);
  assert.equal([...ok.data.note.body].length, 499); // 最後の改行は前後の空白として消える
  assert.equal((await addNote({ fes_day: 2, body: "😀".repeat(500) })).status, 201, "絵文字500文字もOK");
  assert.equal((await addNote({ fes_day: 2, body: "x".repeat(9000) })).status, 413);

  const after = (await call("GET", "/api/state?day=2")).data.notes.length;
  assert.equal(after, before + 2);
});

test("メモ：取り消しは2回押しても同じ時刻。おかしい番号は 404", async () => {
  const { data } = await addNote({ fes_day: 0, body: "まちがい" });
  const id = data.note.id;
  const first = await cancelNote(id);
  assert.equal(first.status, 200);
  assert.match(first.data.note.canceled_at, ISO);
  const many = await Promise.all(Array.from({ length: 3 }, () => cancelNote(id)));
  for (const r of many) assert.equal(r.data.note.canceled_at, first.data.note.canceled_at);
  const st = await call("GET", "/api/state?day=0");
  assert.equal(st.data.notes.find((x) => x.id === id).canceled_at, first.data.note.canceled_at, "取り消しも残る");
  for (const bad of ["999999", "0", "abc", "-1"]) {
    assert.equal((await cancelNote(bad)).status, 404, bad);
  }
});

test("メモ：日ごとに分かれていて混ざらない", async () => {
  const d0 = await addNote({ fes_day: 0, body: "練習のメモ" });
  const d2 = await addNote({ fes_day: 2, body: "2日目のメモ" });
  for (const day of [0, 1, 2]) {
    const notes = (await call("GET", `/api/state?day=${day}`)).data.notes;
    assert.ok(notes.every((x) => x.fes_day === day));
  }
  assert.ok((await call("GET", "/api/state?day=0")).data.notes.some((x) => x.id === d0.data.note.id));
  assert.ok(!(await call("GET", "/api/state?day=1")).data.notes.some((x) => x.id === d2.data.note.id));
});

test("メモ：1日100件まで（取り消しも数える）。同時に送っても超えない・別の日は影響なし", async () => {
  // 練習日(0)はほかのテストでも使っているので、残りの枠を埋めてから確かめる
  const used = (await call("GET", "/api/state?day=0")).data.notes.length;
  const results = await Promise.all(Array.from({ length: 120 - used }, () => addNote({ fes_day: 0, body: "連投" })));
  assert.equal(results.filter((r) => r.status === 201).length, 100 - used);
  const over = results.filter((r) => r.status === 429);
  assert.equal(over.length, 20);
  assert.equal(over[0].data.error, "今日のメモが上限（100件）に達しました");
  assert.equal((await call("GET", "/api/state?day=0")).data.notes.length, 100);
  assert.equal((await addNote({ fes_day: 1, body: "別の日はOK" })).status, 201);
});

test("メモ：schema.sql も追加分（migrations）も2回流して壊れない", async () => {
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../db/migrations/2026-10-21_notes.sql", import.meta.url), "utf8");
  const oldSchema = schema.split("-- メモ（報告書用。")[0];
  assert.ok(!oldSchema.includes("gomi_notes"));

  // 本番と同じ流れ：前の schema.sql → 追加分を2回 → 新しい schema.sql を2回
  const pg = new PGlite();
  await pg.exec(oldSchema);
  await pg.query("insert into gomi_records (store_no, fes_day, kind) values (1, 1, 'ok')");
  await pg.exec(migration);
  await pg.query("insert into gomi_notes (fes_day, body) values (1, 'メモ')");
  await pg.exec(migration);
  await pg.exec(schema);
  await pg.exec(schema);
  const count = async (t) => (await pg.query(`select count(*)::int as n from ${t}`)).rows[0].n;
  assert.equal(await count("gomi_stores"), 28);
  assert.equal(await count("gomi_records"), 1);
  assert.equal(await count("gomi_notes"), 1);
  await assert.rejects(pg.query("insert into gomi_notes (fes_day, body) values (3, 'x')"));
  await assert.rejects(pg.query("insert into gomi_notes (fes_day, body) values (1, '')"));
  await assert.rejects(pg.query(`insert into gomi_notes (fes_day, body) values (1, '${"あ".repeat(501)}')`));
  const { rows } = await pg.query("select relrowsecurity from pg_class where relname = 'gomi_notes'");
  assert.equal(rows[0].relrowsecurity, true, "RLS が有効");
  await pg.close();
});

test("店ごとのメモ：store_no 付きで追加でき、全体のメモ（null）と区別できる", async () => {
  const shop = await addNote({ fes_day: 2, store_no: 8, body: "8番の袋が破れていた" });
  assert.equal(shop.status, 201);
  assert.equal(shop.data.note.store_no, 8);
  const all1 = await addNote({ fes_day: 2, body: "全体のメモ（省略）" });
  const all2 = await addNote({ fes_day: 2, store_no: null, body: "全体のメモ（null）" });
  assert.equal(all1.data.note.store_no, null);
  assert.equal(all2.data.note.store_no, null);

  const notes = (await call("GET", "/api/state?day=2")).data.notes;
  assert.ok(notes.every((x) => "store_no" in x), "全部のメモに store_no がある");
  assert.equal(notes.find((x) => x.id === shop.data.note.id).store_no, 8);
  assert.equal(notes.find((x) => x.id === all1.data.note.id).store_no, null);

  const c = await cancelNote(shop.data.note.id);
  assert.equal(c.data.note.store_no, 8, "取り消しの返り値にも store_no");
});

test("店ごとのメモ：存在しない店は404、番号の形がおかしいと400", async () => {
  const before = (await call("GET", "/api/state?day=1")).data.notes.length;
  const nf = await addNote({ fes_day: 1, store_no: 29, body: "x" });
  assert.equal(nf.status, 404);
  assert.equal(nf.data.error, "店が見つかりません");
  for (const store_no of ["8", 0, -1, 1.5, true, {}]) {
    assert.equal((await addNote({ fes_day: 1, store_no, body: "x" })).status, 400, JSON.stringify(store_no));
  }
  assert.equal((await call("GET", "/api/state?day=1")).data.notes.length, before, "増えていない");
});

test("店ごとのメモ：store_no の無い古い gomi_notes に追加分を流すと列が付く（2回流しても安全）", async () => {
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../db/migrations/2026-10-21_notes.sql", import.meta.url), "utf8");
  const pg = new PGlite();
  await pg.exec(schema.split("-- メモ（報告書用。")[0]);
  // 前の版の追加分と同じ形（store_no なし）の表
  await pg.exec(`
    create table gomi_notes (
      id bigserial primary key, fes_day smallint not null, body text not null, staff text,
      created_at timestamptz not null default now(), canceled_at timestamptz,
      constraint gomi_notes_day check (fes_day in (0, 1, 2)),
      constraint gomi_notes_body_len check (char_length(body) between 1 and 500),
      constraint gomi_notes_staff_len check (staff is null or char_length(staff) between 1 and 20));
    insert into gomi_notes (fes_day, body) values (1, '前からあるメモ');`);
  await pg.exec(migration);
  await pg.exec(migration);
  await pg.exec(schema);
  const { rows } = await pg.query("select store_no, body from gomi_notes");
  assert.deepEqual(rows, [{ store_no: null, body: "前からあるメモ" }], "前のメモは全体のメモとして残る");
  await pg.query("insert into gomi_notes (fes_day, store_no, body) values (1, 5, '店メモ')");
  await assert.rejects(pg.query("insert into gomi_notes (fes_day, store_no, body) values (1, 99, 'x')"), "無い店は入らない");
  const fk = await pg.query(
    "select count(*)::int as n from pg_constraint where conrelid = 'gomi_notes'::regclass and contype = 'f'",
  );
  assert.equal(fk.rows[0].n, 1, "店への参照は1つだけ（何度流しても増えない）");
  const idx = await pg.query("select count(*)::int as n from pg_indexes where indexname = 'gomi_notes_store_idx'");
  assert.equal(idx.rows[0].n, 1);
  await pg.close();
});

// ---- 所属による権限 ----
import { roleOf } from "../server/roles.js";

test("所属の判定：全角・半角かっこ、空白、所属なし", () => {
  assert.equal(roleOf("たなか（本部）"), "本部");
  assert.equal(roleOf("たなか(本部)"), "本部");
  assert.equal(roleOf("たなか （ 施設管理 ） "), "施設管理");
  assert.equal(roleOf("たなか　（売店部）　"), "売店部", "全角スペース");
  assert.equal(roleOf("たなか(施設管理）"), "施設管理", "半角と全角が混ざっていても読む");
  assert.equal(roleOf("（本部）"), "本部");
  assert.equal(roleOf("たなか"), null);
  assert.equal(roleOf("たなか（本部）さん"), null, "末尾でなければ所属なし");
  assert.equal(roleOf("（本部）たなか"), null);
  assert.equal(roleOf("たなか（本部"), null);
  assert.equal(roleOf("たなか【本部】"), null);
  assert.equal(roleOf("たなか（総務）"), null);
  assert.equal(roleOf("たなか（本部長）"), null);
  assert.equal(roleOf(""), null);
  assert.equal(roleOf(null), null);
  assert.equal(roleOf(undefined), null);
  assert.equal(roleOf(1), null);
});

const HQ = "すずき（本部）";
const FAC = "たなか（施設管理）";
const SHOP = "さとう（売店部）";
const SHOP2 = "やまだ(売店部)";
const NONE = "なまえだけ";

test("権限：記録の追加・記録の取り消し・店舗名の変更は本部と施設管理だけ", async () => {
  const msg = /^売店部・所属なしの名前では.+。所属を「本部」「施設管理」「教員」のどれかにしてください$/;
  for (const staff of [HQ, FAC, "おの (本部)", "かとう ( 施設管理 ) "]) {
    const r = await add({ store_no: 21, fes_day: 1, kind: "ok", staff });
    assert.equal(r.status, 201, staff);
    assert.equal((await cancelRec(r.data.record.id, staff)).status, 200, staff);
    assert.equal((await patch("/api/stores/21", { name: "名前を変えた店", staff })).status, 200, staff);
  }
  const target = (await add({ store_no: 21, fes_day: 1, kind: "ok" })).data.record;
  for (const staff of [SHOP, SHOP2, NONE, "", null, undefined]) {
    const label = String(staff);
    const body = staff === undefined ? { store_no: 21, fes_day: 1, kind: "ok" } : { store_no: 21, fes_day: 1, kind: "ok", staff };
    const a = await call("POST", "/api/records", body);
    assert.equal(a.status, 403, `追加 ${label}`);
    assert.equal(a.data.error, "売店部・所属なしの名前では記録できません。所属を「本部」「施設管理」「教員」のどれかにしてください");
    const c = await call("POST", `/api/records/${target.id}/cancel`, staff === undefined ? {} : { staff });
    assert.equal(c.status, 403, `取り消し ${label}`);
    assert.match(c.data.error, msg);
    const p = await call("PATCH", "/api/stores/21", staff === undefined ? { name: "いたずら" } : { name: "いたずら", staff });
    assert.equal(p.status, 403, `店舗名 ${label}`);
    assert.match(p.data.error, msg);
  }
  // 本文なしの取り消しも 403（名前が必須）
  assert.equal((await call("POST", `/api/records/${target.id}/cancel`)).status, 403);
  // 断られた操作は何も変えていない
  const st = (await call("GET", "/api/state?day=1")).data;
  assert.equal(st.records.find((r) => r.id === target.id).canceled_at, null);
  assert.equal(st.stores.find((s) => s.no === 21).name, "名前を変えた店");
});

test("権限：断る順番は 400（形）→ 403（所属）→ 404（対象なし）", async () => {
  // 形がおかしければ所属に関係なく 400
  assert.equal((await add({ store_no: "1", fes_day: 1, kind: "ok", staff: SHOP })).status, 400);
  assert.equal((await add({ store_no: 1, fes_day: 1, kind: "ok", staff: 5 })).status, 400);
  assert.equal((await call("POST", "/api/records/1/cancel", { staff: 5 })).status, 400);
  assert.equal((await call("PATCH", "/api/stores/1", { name: "", staff: SHOP })).status, 400);
  assert.equal((await addNote({ fes_day: 1, body: "", staff: NONE })).status, 400);
  // 所属がだめなら、無い店・無い記録でも 403
  assert.equal((await add({ store_no: 99, fes_day: 1, kind: "ok", staff: SHOP })).status, 403);
  assert.equal((await cancelRec(999999, SHOP)).status, 403);
  assert.equal((await patch("/api/stores/99", { name: "x", staff: NONE })).status, 403);
  assert.equal((await cancelNote(999999, NONE)).status, 403);
  // 所属がよければ 404
  assert.equal((await add({ store_no: 99, fes_day: 1, kind: "ok", staff: HQ })).status, 404);
  assert.equal((await cancelRec(999999, HQ)).status, 404);
  assert.equal((await patch("/api/stores/99", { name: "x", staff: FAC })).status, 404);
  assert.equal((await cancelNote(999999, SHOP)).status, 404, "売店部でも、無いメモは 404");
});

test("権限：メモは所属があれば誰でも書ける。所属なしは 403", async () => {
  for (const staff of [HQ, FAC, SHOP, SHOP2]) {
    const r = await addNote({ fes_day: 1, body: `${staff}のメモ`, staff });
    assert.equal(r.status, 201, staff);
    assert.equal(r.data.note.staff, staff);
  }
  for (const staff of [NONE, "", null]) {
    const r = await addNote({ fes_day: 1, body: "x", staff });
    assert.equal(r.status, 403, String(staff));
    assert.equal(r.data.error, "所属を選んでからメモを書いてください");
  }
  assert.equal((await call("POST", "/api/notes", { fes_day: 1, body: "名前なし" })).status, 403);
});

test("権限：メモの取り消しは、本部・施設管理は誰のでも、売店部は自分のだけ", async () => {
  const mk = async (staff) => (await addNote({ fes_day: 2, body: "取り消し用", staff })).data.note.id;

  // 売店部：自分のメモは OK（2回押しても OK）
  const own = await mk(SHOP);
  assert.equal((await cancelNote(own, SHOP)).status, 200);
  assert.equal((await cancelNote(own, `  ${SHOP}  `)).status, 200, "前後の空白は消してから比べる");

  // 売店部：他人のメモは 403（本部・施設管理・別の売店部の人のもの）
  for (const writer of [HQ, FAC, SHOP2]) {
    const id = await mk(writer);
    const r = await cancelNote(id, SHOP);
    assert.equal(r.status, 403, writer);
    assert.equal(r.data.error, "売店部は自分のメモだけ取り消せます");
    const st = (await call("GET", "/api/state?day=2")).data.notes.find((n) => n.id === id);
    assert.equal(st.canceled_at, null, "取り消されていない");
  }
  // 同じ名前でも所属の書き方（かっこ）が違えば別人として扱う
  const half = await mk("さとう(売店部)");
  assert.equal((await cancelNote(half, SHOP)).status, 403);

  // 本部・施設管理は誰のメモでも
  for (const canceler of [HQ, FAC]) {
    const id = await mk(SHOP);
    assert.equal((await cancelNote(id, canceler)).status, 200, canceler);
  }
  // 所属なしは自分のメモ（そもそも書けない）も含めて 403
  const id = await mk(HQ);
  for (const staff of [NONE, "", null]) {
    const r = await cancelNote(id, staff);
    assert.equal(r.status, 403);
  }
  assert.equal((await call("POST", `/api/notes/${id}/cancel`)).status, 403, "本文なし");
});

test("所属の判定：教員（全角・半角・空白）", () => {
  assert.equal(roleOf("やまだ（教員）"), "教員");
  assert.equal(roleOf("やまだ(教員)"), "教員");
  assert.equal(roleOf("やまだ （ 教員 ）　"), "教員");
  assert.equal(roleOf("やまだ（教員）さん"), null);
  assert.equal(roleOf("やまだ（教員長）"), null);
});

test("権限：教員は本部とまったく同じ結果になる", async () => {
  const TEACHER = "やまだ（教員）";
  const run = async (staff) => {
    const out = [];
    const r = await add({ store_no: 22, fes_day: 1, kind: "ok", staff });
    out.push(r.status);
    out.push((await cancelRec(r.data.record.id, staff)).status);
    out.push((await patch("/api/stores/22", { name: "ミャンマーの伝統料理", staff })).status);
    const n = await addNote({ fes_day: 1, store_no: 22, body: "教員テスト", staff });
    out.push(n.status);
    out.push((await cancelNote(n.data.note.id, staff)).status, "自分のメモ");
    // 他人（売店部・施設管理）のメモも取り消せる
    for (const writer of [SHOP, FAC]) {
      const other = (await addNote({ fes_day: 1, body: "他人のメモ", staff: writer })).data.note.id;
      out.push((await cancelNote(other, staff)).status);
    }
    // 無い対象は 404（所属が通ったあと）
    out.push((await add({ store_no: 99, fes_day: 1, kind: "ok", staff })).status);
    out.push((await cancelRec(999999, staff)).status);
    out.push((await patch("/api/stores/99", { name: "x", staff })).status);
    return out;
  };
  const hq = await run(HQ);
  assert.deepEqual(hq, [201, 200, 200, 201, 200, "自分のメモ", 200, 200, 404, 404, 404]);
  assert.deepEqual(await run(TEACHER), hq);
  assert.deepEqual(await run("いのうえ (教員)"), hq);
});

// ---- 誰が取り消したか ----
test("取り消した人：記録・メモに canceled_by が入り、二重取り消しでは最初の人のまま", async () => {
  const rec = (await add({ store_no: 23, fes_day: 1, kind: "ok", staff: FAC })).data.record;
  assert.equal(rec.canceled_by, null, "取り消す前は空");
  const c1 = await cancelRec(rec.id, "  すずき（本部）  ");
  assert.equal(c1.status, 200);
  assert.equal(c1.data.record.canceled_by, "すずき（本部）", "空白を消した名前で入る");
  const c2 = await cancelRec(rec.id, "やまだ（教員）");
  assert.equal(c2.data.record.canceled_by, "すずき（本部）", "2回目の人では上書きしない");
  assert.equal(c2.data.record.canceled_at, c1.data.record.canceled_at);
  const st = (await call("GET", "/api/state?day=1")).data;
  assert.equal(st.records.find((r) => r.id === rec.id).canceled_by, "すずき（本部）");
  assert.ok(st.records.every((r) => "canceled_by" in r));

  const note = (await addNote({ fes_day: 1, body: "取り消す人テスト", staff: SHOP })).data.note;
  assert.equal(note.canceled_by, null);
  const n1 = await cancelNote(note.id, SHOP);
  assert.equal(n1.data.note.canceled_by, SHOP, "売店部が自分のメモを取り消した");
  const n2 = await cancelNote(note.id, HQ);
  assert.equal(n2.status, 200);
  assert.equal(n2.data.note.canceled_by, SHOP, "あとから本部が押しても変わらない");
  const sn = (await call("GET", "/api/state?day=1")).data.notes;
  assert.equal(sn.find((n) => n.id === note.id).canceled_by, SHOP);
  assert.ok(sn.every((n) => "canceled_by" in n));

  // 断られた取り消しでは何も書かれない
  const other = (await addNote({ fes_day: 1, body: "他人のメモ", staff: HQ })).data.note;
  assert.equal((await cancelNote(other.id, SHOP)).status, 403);
  const after = (await call("GET", "/api/state?day=1")).data.notes.find((n) => n.id === other.id);
  assert.equal(after.canceled_by, null);
  assert.equal(after.canceled_at, null);
});

test("取り消した人：追加分（2026-10-22）を2回流しても安全。前からの取り消しは空のまま", async () => {
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const notesMig = readFileSync(new URL("../db/migrations/2026-10-21_notes.sql", import.meta.url), "utf8");
  const mig = readFileSync(new URL("../db/migrations/2026-10-22_canceled_by.sql", import.meta.url), "utf8");
  const pg = new PGlite();
  // 本番と同じ流れ：前の schema → メモの追加分 → 前からの取り消し → 今回の追加分を2回 → 新しい schema を2回
  await pg.exec(schema.split("-- メモ（報告書用。")[0]);
  await pg.exec(notesMig);
  await pg.exec(`
    insert into gomi_records (store_no, fes_day, kind, canceled_at) values (1, 1, 'ok', now());
    insert into gomi_notes (fes_day, body, canceled_at) values (1, 'メモ', now());`);
  await pg.exec(mig);
  await pg.exec(mig);
  await pg.exec(schema);
  await pg.exec(schema);
  const r = await pg.query("select canceled_by from gomi_records");
  const n = await pg.query("select canceled_by from gomi_notes");
  assert.deepEqual(r.rows, [{ canceled_by: null }]);
  assert.deepEqual(n.rows, [{ canceled_by: null }]);
  await assert.rejects(pg.query(`update gomi_records set canceled_by = '${"あ".repeat(21)}'`), "21文字は入らない");
  await assert.rejects(pg.query("update gomi_notes set canceled_by = ''"), "空文字は入らない");
  const c = await pg.query(
    "select count(*)::int as n from pg_constraint where conname in ('gomi_records_canceled_by_len', 'gomi_notes_canceled_by_len')",
  );
  assert.equal(c.rows[0].n, 2, "制約は1つずつ（何度流しても増えない）");
  await pg.close();

  // gomi_notes が無いまま流すと、エラーで止まる（順番まちがいに気づける。流し直せば直る）
  const pg2 = new PGlite();
  await pg2.exec(schema.split("-- メモ（報告書用。")[0]);
  await assert.rejects(pg2.exec(mig));
  await pg2.close();
});

// ---- 使った人数（2026-10-29 追加） ----
// 時刻を決められる別のサーバーを作る（日本時間の日付で何日目かが決まる）
let clock = new Date("2026-10-31T01:00:00Z"); // 日本時間 10/31 10:00 = 1日目
const usageApi = await createLocalApi({
  dataDir: mkdtempSync(join(tmpdir(), "gomi-usage-")),
  adminKey: "ひみつの合言葉",
  now: () => clock,
});
const ucall = async (path, body) => {
  const res = await usageApi.fetchApi(new Request(`http://t${path}`, { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
};
const DEV_A = "a".repeat(32);
const DEV_B = "0123456789abcdef".repeat(2);
const usageOf = async (d) => (await ucall("/api/usage", { key: "ひみつの合言葉" })).data.days.find((x) => x.fes_day === d);

test("使った人数：同じスマホは1日1人。名前は最後に開いたときのもの。日付で何日目かが決まる", async () => {
  assert.equal((await ucall("/api/visits", { device: DEV_A })).data.fes_day, 1);
  clock = new Date("2026-10-31T05:00:00Z");
  await ucall("/api/visits", { device: DEV_A, staff: "たなか（施設管理）" });
  await ucall("/api/visits", { device: DEV_B, staff: "すずき" });

  const day1 = await usageOf(1);
  assert.equal(day1.count, 2);
  assert.deepEqual(
    day1.people.map((p) => [p.staff, p.role]),
    [["たなか（施設管理）", "施設管理"], ["すずき", null]],
    "はじめて開いた順",
  );
  assert.match(day1.people[0].first_seen, ISO);
  assert.ok(day1.people[0].last_seen > day1.people[0].first_seen, "最後に開いた時刻が更新される");

  // 日本時間の 11/1 0:30（UTC ではまだ 10/31）は2日目
  clock = new Date("2026-10-31T15:30:00Z");
  assert.equal((await ucall("/api/visits", { device: DEV_A, staff: "たなか（施設管理）" })).data.fes_day, 2);
  assert.equal((await usageOf(2)).count, 1);
  assert.equal((await usageOf(1)).count, 2, "1日目は増えない");

  // 本番が終わった後は数えない。本番前は練習（0）
  clock = new Date("2026-11-02T03:00:00Z");
  assert.deepEqual((await ucall("/api/visits", { device: DEV_B })).data, { fes_day: null });
  clock = new Date("2026-10-29T03:00:00Z");
  assert.equal((await ucall("/api/visits", { device: DEV_B })).data.fes_day, 0);
  assert.equal((await usageOf(0)).count, 1);
  assert.equal((await usageOf(2)).count, 1);
});

test("使った人数：端末の番号・名前の形がおかしいと 400", async () => {
  for (const device of [undefined, "", "A".repeat(32), "a".repeat(31), "a".repeat(33), "g".repeat(32), 123]) {
    assert.equal((await ucall("/api/visits", { device })).status, 400, String(device));
  }
  assert.equal((await ucall("/api/visits", { device: DEV_A, staff: "あ".repeat(21) })).status, 400);
});

test("使った人数：合言葉が違うと 403、設定されていなければ 503（中身は返さない）", async () => {
  for (const key of [undefined, "", "ひみつ", "ひみつの合言葉 ", 1]) {
    const res = await ucall("/api/usage", { key });
    assert.equal(res.status, 403, String(key));
    assert.equal(res.data.days, undefined);
  }
  const res = await call("POST", "/api/usage", { key: "" });
  assert.equal(res.status, 503, "合言葉なしのサーバーでは使えない");
});

test("使った人数：1日1000台まで。上限に達しても、すでにあるスマホは更新される", async () => {
  clock = new Date("2026-10-28T03:00:00Z"); // 練習の日（ほかのテストと混ぜないため0日目を使う）
  await usageApi.pg.query("delete from gomi_visits where fes_day = 0");
  await usageApi.pg.query(
    `insert into gomi_visits (device, fes_day) select lpad(to_hex(i), 32, '0'), 0 from generate_series(1, 1000) i`,
  );
  await ucall("/api/visits", { device: DEV_A });
  assert.equal((await usageOf(0)).count, 1000, "新しいスマホは足されない");
  const first = "0".repeat(31) + "1";
  await ucall("/api/visits", { device: first, staff: "やまだ（本部）" });
  const p = (await usageOf(0)).people.find((x) => x.staff === "やまだ（本部）");
  assert.ok(p, "すでにあるスマホの名前は更新される");
});

test("使った人数：追加分（2026-10-29）を2回流しても安全", async () => {
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const mig = readFileSync(new URL("../db/migrations/2026-10-29_visits.sql", import.meta.url), "utf8");
  const pg = new PGlite();
  // 本番と同じ流れ：前の schema → 今回の追加分を2回 → 新しい schema を2回
  const oldSchema = schema.split("-- アプリを開いたスマホ")[0];
  assert.ok(!oldSchema.includes("gomi_visits"));
  await pg.exec(oldSchema);
  await pg.exec(mig);
  await pg.query(`insert into gomi_visits (device, fes_day) values ('${DEV_A}', 1)`);
  await pg.exec(mig);
  await pg.exec(schema);
  await pg.exec(schema);
  assert.equal((await pg.query("select count(*)::int as n from gomi_visits")).rows[0].n, 1);
  await assert.rejects(pg.query(`insert into gomi_visits (device, fes_day) values ('${DEV_A}', 1)`), "同じ日の同じスマホは1行");
  await assert.rejects(pg.query(`insert into gomi_visits (device, fes_day) values ('${DEV_B}', 3)`));
  await assert.rejects(pg.query("insert into gomi_visits (device, fes_day) values ('xyz', 1)"));
  const { rows } = await pg.query("select relrowsecurity from pg_class where relname = 'gomi_visits'");
  assert.equal(rows[0].relrowsecurity, true, "RLS が有効");
  await pg.close();
});
