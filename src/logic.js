// 画面で使う計算（通信はしない）。店の状態はサーバーに保存されていないので、ここで records から決める。

// 0 = 練習（本番前に操作を試す日。記録は本番の1日目・2日目に混ざらない）
export const DAYS = {
  0: { label: "練習", date: "本番前", last: null, practice: true },
  1: { label: "1日目", date: "10/31(土)", last: "18:00" },
  2: { label: "2日目", date: "11/1(日)", last: "17:30" },
};

export const KIND_LABEL = {
  ok: "回収OK",
  returned: "差し戻し",
  bags: "ゴミ袋",
  finished: "本日終了",
};

export const STATUS = {
  none: { label: "まだ来ていない" },
  came: { label: "来た" },
  returned: { label: "差し戻し中" },
  finished: { label: "本日終了" },
};

const jst = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const jstDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

// UTC の ISO 文字列 → 日本時間の HH:MM
export function toTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : jst.format(d);
}

// 練習タブを出すのは本番前（日本時間で 10/30 まで）だけ
export function practiceAvailable(now = new Date()) {
  return jstDate.format(now) < "2026-10-31";
}

// 今日（日本時間）で自動選択：10/30以前→練習、10/31→1日目、11/1以降→2日目
export function todayFesDay(now = new Date()) {
  const today = jstDate.format(now); // 例: 2026-10-31
  if (today < "2026-10-31") return 0;
  if (today === "2026-10-31") return 1;
  return 2;
}

// 1つの店の、その日の状態をまとめる。records は新しい順で渡す
export function summarize(records) {
  let latestCheck = null; // いちばん新しい「回収OK」か「差し戻し」
  let finished = false;
  let lastVisit = null; // ゴミを出しに来た最後の時刻（袋を渡しただけの記録は含めない）
  let okCount = 0;
  let bags = 0;
  for (const r of records) {
    if (r.canceled_at) continue;
    if (r.kind === "ok") okCount += 1;
    if (r.kind === "bags") bags += r.bags || 0;
    if (r.kind === "finished") finished = true;
    if (r.kind !== "bags" && !lastVisit) lastVisit = r.created_at;
    if (!latestCheck && (r.kind === "ok" || r.kind === "returned")) latestCheck = r.kind;
  }
  // 終了は最優先（終了の後に回収OKが足されても終了のまま）
  const status = finished ? "finished" : latestCheck === "ok" ? "came" : latestCheck === "returned" ? "returned" : "none";
  return { status, lastVisit, okCount, bags };
}

// 店番号ごとに記録を振り分ける（新しい順のまま）
export function groupByStore(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.store_no)) map.set(r.store_no, []);
    map.get(r.store_no).push(r);
  }
  return map;
}

// ---- 所属と権限 ----
// 記録者名は「名前（所属）」の1つの文字列で保存する。かっこは全角・半角どちらでもよく、空白は無視する
export const ROLES = ["本部", "教員", "施設管理", "売店部"];
const FULL = ["本部", "教員"]; // 何でもできる所属（教員は本部と同じ）
export const STAFF_MAX = 20; // サーバーの記録者名の上限
// 施設管理で報告書を保存できる人。実名は GitHub に載せないよう .env.local の VITE_REPORTERS（カンマ区切り）に書く
const REPORTERS = (import.meta.env?.VITE_REPORTERS || "担当者A,担当者B,担当者C").split(",").map((s) => s.replace(/\s/g, ""));
const squash = (s) => String(s || "").replace(/\s/g, ""); // \s は全角スペースも含む
const ROLE_RE = /[（(]\s*(本部|教員|施設管理|売店部)\s*[）)]\s*$/;

// 「山田花子（施設管理）」→ { base: "山田花子", role: "施設管理" }。所属が無ければ role は null
export function parseStaff(name) {
  const s = String(name || "").trim();
  const m = s.match(ROLE_RE);
  if (!m) return { base: s, role: null };
  return { base: s.slice(0, m.index).trim(), role: m[1] };
}

export const roleOf = (name) => parseStaff(name).role;
export const roleSuffix = (role) => `（${role}）`;
export const formatStaff = (base, role) => `${base.trim()}${roleSuffix(role)}`;
// 名前の入力欄に入れられる文字数（所属の部分を含めて20文字に収める）
export const baseMax = (role) => STAFF_MAX - [...roleSuffix(role)].length;

// 上部のボタンなどに出す「山田花子・施設管理」
export function displayStaff(name) {
  const { base, role } = parseStaff(name);
  if (!role) return base || "名前なし";
  return `${base}・${role}`;
}

// 取り消し済みの印：「取り消し済み（山田花子・施設管理・10:31）」。取り消した人が分からない前のデータは時刻だけ
export function canceledText(item) {
  const by = item.canceled_by ? `${displayStaff(item.canceled_by)}・` : "";
  return `取り消し済み（${by}${toTime(item.canceled_at)}）`;
}

// 記録・記録の取り消し・店舗名の変更（本部・教員・施設管理）
export const canRecord = (name) => [...FULL, "施設管理"].includes(roleOf(name));
// メモを書く（所属があれば誰でも）
export const canWriteNote = (name) => roleOf(name) !== null;
// 同じ人か（空白とかっこの全角・半角の違いは無視）
function sameStaff(a, b) {
  const x = parseStaff(a);
  const y = parseStaff(b);
  return x.role !== null && x.role === y.role && squash(x.base) !== "" && squash(x.base) === squash(y.base);
}

// メモの取り消し（本部・教員・施設管理は誰のでも、売店部は自分のメモだけ）
export function canCancelNote(name, note) {
  const role = roleOf(name);
  if (FULL.includes(role) || role === "施設管理") return true;
  if (role === "売店部") return sameStaff(note.staff, name);
  return false;
}
// 報告書の保存（本部・教員は全員、施設管理は決まった3人だけ）
export function canReport(name) {
  const { base, role } = parseStaff(name);
  if (FULL.includes(role)) return true;
  return role === "施設管理" && REPORTERS.includes(squash(base));
}
export const isReporter = canReport;

// 日本時間の「10/31 18:05」
const jstDateTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function toDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : jstDateTime.format(d);
}

// 報告書のメモ：全体（時刻順）と店ごと（店番号順、同じ店の中は時刻順）に分ける。取り消し済みは除く
function splitNotes(notes, stores) {
  const names = new Map(stores.map((s) => [s.no, s.name]));
  const active = (notes || []).filter((n) => !n.canceled_at);
  const byTime = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id);
  return {
    generalNotes: active.filter((n) => n.store_no == null).sort(byTime),
    storeNotes: active
      .filter((n) => n.store_no != null)
      .sort((a, b) => a.store_no - b.store_no || byTime(a, b))
      .map((n) => ({ ...n, store_name: names.get(n.store_no) || "" })),
  };
}

// 報告書の集計（取り消し済みは数えない）
export function buildReport(stores, records, notes) {
  const active = records.filter((r) => !r.canceled_at);
  const grouped = groupByStore(active);
  const rows = stores.map((s) => ({ ...s, ...summarize(grouped.get(s.no) || []) }));
  const returnedStores = new Set(active.filter((r) => r.kind === "returned").map((r) => r.store_no));
  const times = active.map((r) => r.created_at).sort();
  return {
    total: stores.length,
    finished: rows.filter((r) => r.status === "finished").length,
    open: rows.filter((r) => r.status !== "finished"),
    ok: active.filter((r) => r.kind === "ok").length,
    returned: active.filter((r) => r.kind === "returned").length,
    returnedStores: returnedStores.size,
    bags: active.reduce((sum, r) => sum + (r.kind === "bags" ? r.bags || 0 : 0), 0),
    first: times[0] || null,
    last: times[times.length - 1] || null,
    ...splitNotes(notes, stores),
  };
}

export function kindText(r) {
  return r.kind === "bags" ? `ゴミ袋 ${r.bags}枚` : KIND_LABEL[r.kind] || r.kind;
}
