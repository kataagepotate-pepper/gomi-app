// API本体。Request を受け取って Response を返すだけの作りにしてあるので、
// Netlify Functions でも、PCの中のテスト用サーバーでも同じものが動く。
//
//   GET   /api/state?day=0|1|2         その日（0=練習）の店舗一覧と記録（取り消しを含む全件・新しい順）
//   POST  /api/records                 記録を1件追加する（1店・1日150件まで。超えると 429）
//   POST  /api/records/:id/cancel      記録を取り消す（何度押しても同じ結果）
//   PATCH /api/stores/:no              店舗名を変える
//   POST  /api/notes                   メモを1件追加する（store_no を付けると店ごとのメモ。1日100件まで。超えると 429）
//   POST  /api/notes/:id/cancel        メモを取り消す（何度押しても同じ結果）
//   POST  /api/visits                  「このスマホが今日アプリを開いた」を残す（日はサーバーの日本時間で決める）
//   POST  /api/usage                   日ごとに使ったスマホの台数と名前を返す（本文の key が合言葉と同じときだけ）
//
// 店の状態（まだ来ていない／来た／差し戻し中／終了）はサーバーでは保存せず、画面側で records から計算する。
//
// 書き込みには本文の staff（記録者名）が必須で、名前の末尾の所属（server/roles.js）でできることが決まる。
//   記録の追加・記録の取り消し・店舗名の変更 … 本部・施設管理・教員だけ
//   メモの追加                               … 所属があれば誰でも（本部・施設管理・教員・売店部）
//   メモの取り消し                           … 本部・施設管理・教員は誰のメモでも、売店部は自分のメモ（staff が同じ）だけ
// 断る順番：URLの形がおかしい（404）→ 送られた値の形（400）→ 所属による権限（403）→ 対象が無い（404）
//           → 売店部が他人のメモを取り消そうとした（403。メモの持ち主は対象を読んで初めてわかるので最後）
// db は { query(text, params) => rows[], transaction(fn) } の形のものを渡す。
// options.adminKey は /api/usage の合言葉（空なら /api/usage は使えない）。options.now はテストで時刻を決めるため。

import { createHash, timingSafeEqual } from "node:crypto";
import { canRecord, canWriteNote, roleOf } from "./roles.js";

const MAX_BODY = 2048;
const MAX_NOTE_BODY = 8192; // メモは本文が最大500文字（改行を含む）あるので、送信データの上限を大きめにする
const KINDS = ["ok", "returned", "bags", "finished"];
const STAFF_MAX = 20;
const NAME_MAX = 40;
// 1店・1日あたりの記録の上限（取り消した記録も数える。取り消しで枠を空けていたずらを繰り返せないように）
const MAX_RECORDS_PER_STORE_DAY = 150;
const NOTE_MAX = 500;
// 1日あたりのメモの上限（取り消したメモも数える）
const MAX_NOTES_PER_DAY = 100;
// メモの上限を数えるときに使うロックの番号（同時に送られても上限を超えないよう、日ごとに1本ずつ順番待ちにする）
const NOTES_LOCK_KEY = 470301;
// 1日あたりに数えるスマホの上限（でたらめな番号を大量に送られても表が膨らまないように）
const MAX_VISITS_PER_DAY = 1000;
const DEVICE_RE = /^[0-9a-f]{32}$/;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req, max = MAX_BODY) {
  if (Number(req.headers.get("content-length") || 0) > max) throw new HttpError(413, "送信データが大きすぎます");
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "送信データが大きすぎます");
  if (!text) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "送信データの形式が正しくありません");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "送信データの形式が正しくありません");
  return body;
}

// 見えない制御文字・文字の向きを逆にする記号などを取り除き、前後の空白を消す
function normalizeText(value) {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
}

function cleanText(value, max, label) {
  const s = typeof value === "string" ? normalizeText(value) : "";
  if (!s) throw new HttpError(400, `${label}を入れてください`);
  if ([...s].length > max) throw new HttpError(400, `${label}は${max}文字までです`);
  return s;
}

// 記録した人の名前は任意。空・null・省略なら null として保存する
function cleanStaff(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "記録した人の名前が正しくありません");
  const s = normalizeText(value);
  if (!s) return null;
  if ([...s].length > STAFF_MAX) throw new HttpError(400, `記録した人の名前は${STAFF_MAX}文字までです`);
  return s;
}

// メモの本文：改行は残し、それ以外の見えない文字は取り除く（タブは空白に）。前後の空白・改行は消す
function cleanNoteBody(value) {
  if (typeof value !== "string") throw new HttpError(400, "メモを入れてください");
  const s = value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? c : ""))
    .trim();
  if (!s) throw new HttpError(400, "メモを入れてください");
  if ([...s].length > NOTE_MAX) throw new HttpError(400, `メモは${NOTE_MAX}文字までです`);
  return s;
}

// 所属による権限の確認（できなければ 403）
function requireRecorder(staff, action) {
  if (!canRecord(roleOf(staff))) {
    throw new HttpError(403, `売店部・所属なしの名前では${action}。所属を「本部」「施設管理」「教員」のどれかにしてください`);
  }
}
function requireNoteWriter(staff) {
  if (!canWriteNote(roleOf(staff))) throw new HttpError(403, "所属を選んでからメモを書いてください");
}

function parseDay(value) {
  if (value === 0 || value === 1 || value === 2) return value; // 0 は本番前の練習用
  throw new HttpError(400, "日付（練習・1日目・2日目）が正しくありません");
}

// URLの中の番号（/api/stores/5 の 5 など）。数字以外や大きすぎる値は「見つからない」扱い
function parseId(s, max) {
  if (!/^[1-9][0-9]{0,9}$/.test(s || "")) return null;
  const n = Number(s);
  return n <= max ? n : null;
}

// 時刻はどのデータベース（Supabase / PGlite）でも同じ形になるよう、UTC の ISO 形式の文字列にそろえる
// 例: 2026-10-31T06:42:00.123Z
const ts = (col) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// 記録1件をJSONにする式（gomi_records の列をそのまま参照する）
const RECORD_JSON = `json_build_object(
  'id', id::int, 'store_no', store_no, 'fes_day', fes_day, 'kind', kind, 'bags', bags, 'staff', staff,
  'created_at', ${ts("created_at")}, 'canceled_at', ${ts("canceled_at")}, 'canceled_by', canceled_by)`;

// メモ1件をJSONにする式（gomi_notes の列をそのまま参照する）
const NOTE_JSON = `json_build_object(
  'id', id::int, 'fes_day', fes_day, 'store_no', store_no, 'body', body, 'staff', staff,
  'created_at', ${ts("created_at")}, 'canceled_at', ${ts("canceled_at")}, 'canceled_by', canceled_by)`;

// 1回の問い合わせで店舗一覧と記録をまとめて取る（サーバーとデータベースの往復を減らすため）
const STATE_SQL = `
  select
    coalesce((select json_agg(json_build_object('no', no, 'name', name) order by no) from gomi_stores), '[]'::json) as stores,
    coalesce((select json_agg(${RECORD_JSON} order by created_at desc, id desc)
              from gomi_records where fes_day = $1), '[]'::json) as records,
    coalesce((select json_agg(${NOTE_JSON} order by created_at desc, id desc)
              from gomi_notes where fes_day = $1), '[]'::json) as notes,
    ${ts("now()")} as server_time`;

async function getState(db, url) {
  const raw = url.searchParams.get("day");
  if (raw !== "0" && raw !== "1" && raw !== "2") throw new HttpError(400, "日付（day=0・1・2 のどれか）を指定してください");
  const [row] = await db.query(STATE_SQL, [Number(raw)]);
  return json({ stores: row.stores, records: row.records, notes: row.notes, server_time: row.server_time });
}

async function addRecord(db, body) {
  const storeNo = body.store_no;
  if (!Number.isInteger(storeNo) || storeNo < 1) throw new HttpError(400, "店の番号が正しくありません");
  const fesDay = parseDay(body.fes_day);
  const kind = body.kind;
  if (!KINDS.includes(kind)) throw new HttpError(400, "記録の種類が正しくありません");

  let bags = null;
  if (kind === "bags") {
    if (!Number.isInteger(body.bags) || body.bags < 1 || body.bags > 5) {
      throw new HttpError(400, "ゴミ袋の枚数は1〜5で選んでください");
    }
    bags = body.bags;
  } else if (body.bags !== undefined && body.bags !== null) {
    throw new HttpError(400, "ゴミ袋の枚数は「ゴミ袋を渡した」のときだけ入れられます");
  }
  const staff = cleanStaff(body.staff);
  requireRecorder(staff, "記録できません");

  // 店の行をロック（for update）してから数えるので、同時に何件押されても上限を超えない
  const record = await db.transaction(async (tx) => {
    const [store] = await tx.query("select no from gomi_stores where no = $1 for update", [storeNo]);
    if (!store) throw new HttpError(404, "店が見つかりません");
    const [{ n }] = await tx.query(
      "select count(*)::int as n from gomi_records where store_no = $1 and fes_day = $2",
      [storeNo, fesDay],
    );
    if (n >= MAX_RECORDS_PER_STORE_DAY) {
      throw new HttpError(
        429,
        `この店の今日の記録が上限（${MAX_RECORDS_PER_STORE_DAY}件）に達しました。施設管理の担当者に連絡してください`,
      );
    }
    const [row] = await tx.query(
      `insert into gomi_records (store_no, fes_day, kind, bags, staff)
       values ($1, $2::smallint, $3, $4::smallint, $5)
       returning ${RECORD_JSON} as record`,
      [storeNo, fesDay, kind, bags, staff],
    );
    return row.record;
  });
  return json({ record }, 201);
}

// 取り消しの書き込み（$2 = 取り消した人）。右側の canceled_at は「書きかえる前の値」なので、
// まだ取り消されていないときだけ時刻と人を入れる
const CANCEL_SET = `canceled_at = coalesce(canceled_at, now()),
  canceled_by = case when canceled_at is null then $2 else canceled_by end`;

async function cancelRecord(db, id, body) {
  const staff = cleanStaff(body.staff);
  requireRecorder(staff, "記録を取り消せません");
  // すでに取り消し済みなら、時刻も取り消した人も最初のまま（二重に押しても壊れない）
  const [row] = await db.query(
    `update gomi_records set ${CANCEL_SET} where id = $1
     returning ${RECORD_JSON} as record`,
    [id, staff],
  );
  if (!row) throw new HttpError(404, "記録が見つかりません");
  return json({ record: row.record });
}

async function addNote(db, body) {
  const fesDay = parseDay(body.fes_day);
  // 店の番号は任意。省略・null なら全体のメモ
  const storeNo = body.store_no ?? null;
  if (storeNo !== null && (!Number.isInteger(storeNo) || storeNo < 1)) throw new HttpError(400, "店の番号が正しくありません");
  const text = cleanNoteBody(body.body);
  const staff = cleanStaff(body.staff);
  requireNoteWriter(staff);

  // 日ごとのロック（トランザクションが終わると自動で外れる）を取ってから数えるので、同時に送られても上限を超えない
  const note = await db.transaction(async (tx) => {
    if (storeNo !== null) {
      const [store] = await tx.query("select no from gomi_stores where no = $1", [storeNo]);
      if (!store) throw new HttpError(404, "店が見つかりません");
    }
    await tx.query("select pg_advisory_xact_lock($1::int, $2::int)", [NOTES_LOCK_KEY, fesDay]);
    const [{ n }] = await tx.query("select count(*)::int as n from gomi_notes where fes_day = $1", [fesDay]);
    if (n >= MAX_NOTES_PER_DAY) throw new HttpError(429, `今日のメモが上限（${MAX_NOTES_PER_DAY}件）に達しました`);
    const [row] = await tx.query(
      `insert into gomi_notes (fes_day, store_no, body, staff) values ($1::smallint, $2::int, $3, $4)
       returning ${NOTE_JSON} as note`,
      [fesDay, storeNo, text, staff],
    );
    return row.note;
  });
  return json({ note }, 201);
}

async function cancelNote(db, id, body) {
  const staff = cleanStaff(body.staff);
  const role = roleOf(staff);
  if (!canWriteNote(role)) throw new HttpError(403, "所属を選んでからメモを取り消してください");
  // 売店部は自分のメモ（書いた人の名前が同じ）だけ。本部・施設管理・教員は誰のメモでも
  const ownOnly = !canRecord(role);
  // すでに取り消し済みなら、時刻も取り消した人も最初のまま（二重に押しても壊れない）
  const [row] = await db.query(
    `update gomi_notes set ${CANCEL_SET}
     where id = $1 and (not $3::boolean or staff = $2)
     returning ${NOTE_JSON} as note`,
    [id, staff, ownOnly],
  );
  if (!row) {
    const [exists] = await db.query("select 1 as x from gomi_notes where id = $1", [id]);
    if (!exists) throw new HttpError(404, "メモが見つかりません");
    throw new HttpError(403, "売店部は自分のメモだけ取り消せます");
  }
  return json({ note: row.note });
}

async function renameStore(db, no, body) {
  const name = cleanText(body.name, NAME_MAX, "店舗名");
  const staff = cleanStaff(body.staff);
  requireRecorder(staff, "店舗名を変えられません");
  const [row] = await db.query(
    `update gomi_stores set name = $2, updated_at = now() where no = $1
     returning json_build_object('no', no, 'name', name) as store`,
    [no, name],
  );
  if (!row) throw new HttpError(404, "店が見つかりません");
  return json({ store: row.store });
}

// 日本時間の日付から本番の何日目かを決める（画面の todayFesDay と同じ決まり）。本番が終わった後は null
const jstDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
function fesDayAt(date) {
  const today = jstDate.format(date);
  if (today < "2026-10-31") return 0;
  if (today === "2026-10-31") return 1;
  if (today === "2026-11-01") return 2;
  return null;
}

// その日の台数が上限に達していたら新しいスマホは足さない（すでにある行の更新はする）
async function addVisit(db, body, now) {
  if (typeof body.device !== "string" || !DEVICE_RE.test(body.device)) throw new HttpError(400, "端末の番号が正しくありません");
  const staff = cleanStaff(body.staff);
  const fesDay = fesDayAt(now());
  if (fesDay === null) return json({ fes_day: null });
  await db.query(
    `insert into gomi_visits (device, fes_day, staff)
     select $1, $2::smallint, $3
     where exists (select 1 from gomi_visits where device = $1 and fes_day = $2)
        or (select count(*) from gomi_visits where fes_day = $2) < $4
     on conflict (device, fes_day) do update set staff = excluded.staff, last_seen = now()`,
    [body.device, fesDay, staff, MAX_VISITS_PER_DAY],
  );
  return json({ fes_day: fesDay });
}

// 合言葉は長さが違っても時間で見分けられないよう、ハッシュにしてから比べる
const digest = (s) => createHash("sha256").update(s).digest();
function checkAdminKey(adminKey, given) {
  if (!adminKey) throw new HttpError(503, "合言葉がまだ設定されていません");
  if (typeof given !== "string" || !timingSafeEqual(digest(adminKey), digest(given))) {
    throw new HttpError(403, "合言葉が違います");
  }
}

const USAGE_SQL = `
  select fes_day, coalesce(json_agg(json_build_object(
    'staff', staff, 'first_seen', ${ts("first_seen")}, 'last_seen', ${ts("last_seen")}
  ) order by first_seen, device), '[]'::json) as people
  from gomi_visits group by fes_day`;

async function getUsage(db, body, adminKey) {
  checkAdminKey(adminKey, body.key);
  const rows = await db.query(USAGE_SQL);
  const days = [0, 1, 2].map((d) => {
    const people = (rows.find((r) => r.fes_day === d) || { people: [] }).people.map((p) => ({
      ...p,
      role: roleOf(p.staff),
    }));
    return { fes_day: d, count: people.length, people };
  });
  return json({ days });
}

export function createHandler(db, { adminKey = "", now = () => new Date() } = {}) {
  return async function handle(req) {
    try {
      const url = new URL(req.url);
      const m = url.pathname.match(/\/api\/(.*)$/);
      const parts = (m ? m[1] : "").split("/").filter(Boolean);
      const method = req.method.toUpperCase();

      if (parts[0] === "state" && parts.length === 1 && method === "GET") return await getState(db, url);

      if (parts[0] === "records") {
        if (parts.length === 1 && method === "POST") return await addRecord(db, await readBody(req));
        if (parts.length === 3 && parts[2] === "cancel" && method === "POST") {
          const id = parseId(parts[1], 2 ** 31 - 1);
          if (!id) throw new HttpError(404, "記録が見つかりません");
          return await cancelRecord(db, id, await readBody(req));
        }
      }

      if (parts[0] === "notes") {
        if (parts.length === 1 && method === "POST") return await addNote(db, await readBody(req, MAX_NOTE_BODY));
        if (parts.length === 3 && parts[2] === "cancel" && method === "POST") {
          const id = parseId(parts[1], 2 ** 31 - 1);
          if (!id) throw new HttpError(404, "メモが見つかりません");
          return await cancelNote(db, id, await readBody(req));
        }
      }

      if (parts[0] === "visits" && parts.length === 1 && method === "POST") return await addVisit(db, await readBody(req), now);
      if (parts[0] === "usage" && parts.length === 1 && method === "POST") return await getUsage(db, await readBody(req), adminKey);

      if (parts[0] === "stores" && parts.length === 2 && method === "PATCH") {
        const no = parseId(parts[1], 2 ** 31 - 1);
        if (!no) throw new HttpError(404, "店が見つかりません");
        return await renameStore(db, no, await readBody(req));
      }

      throw new HttpError(404, "見つかりません");
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "サーバーでエラーが起きました。少し待ってもう一度お試しください" }, 500);
    }
  };
}
