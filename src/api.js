// サーバーとのやりとり。失敗したら Error を投げる（err.network が true なら電波・接続の問題）

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      cache: "no-store",
    });
  } catch {
    const err = new Error("通信できませんでした");
    err.network = true;
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 中身が JSON でない（途中の機器が返したエラーページなど）
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || "サーバーでエラーが起きました");
    err.status = res.status;
    err.network = res.status >= 500;
    // サーバーが理由を返した（4xx の {error}）ときは、その文言をそのまま見せる
    if (res.status < 500 && data && typeof data.error === "string") err.serverMessage = data.error;
    throw err;
  }
  return data;
}

// 失敗したときに画面に出す文言。サーバーの理由があればそれ、通信できなかったときだけ電波の案内
export function failText(err) {
  return (err && err.serverMessage) || "保存できませんでした。電波を確認してもう一度";
}

export const getState = (day) => request(`/api/state?day=${day}`);

export const addRecord = ({ store_no, fes_day, kind, bags, staff }) =>
  request("/api/records", {
    method: "POST",
    body: JSON.stringify({ store_no, fes_day, kind, ...(kind === "bags" ? { bags } : {}), ...(staff ? { staff } : {}) }),
  });

// 取り消し・店舗名変更も、誰が操作したかを送る（サーバーが所属で権限を確かめる）
const who = (staff) => (staff ? { staff } : {});

export const cancelRecord = (id, staff) =>
  request(`/api/records/${id}/cancel`, { method: "POST", body: JSON.stringify(who(staff)) });

// store_no を付けると店のメモ、省略すると全体のメモ
export const addNote = ({ fes_day, body, staff, store_no }) =>
  request("/api/notes", {
    method: "POST",
    body: JSON.stringify({ fes_day, body, ...(Number.isInteger(store_no) ? { store_no } : {}), ...(staff ? { staff } : {}) }),
  });

export const cancelNote = (id, staff) =>
  request(`/api/notes/${id}/cancel`, { method: "POST", body: JSON.stringify(who(staff)) });

export const renameStore = (no, name, staff) =>
  request(`/api/stores/${no}`, { method: "PATCH", body: JSON.stringify({ name, ...who(staff) }) });

// 「このスマホが今日アプリを開いた」を残す（何日目かはサーバーが決める）
export const addVisit = (device, staff) =>
  request("/api/visits", { method: "POST", body: JSON.stringify({ device, ...who(staff) }) });

// 隠しページ用：日ごとに使ったスマホの台数と名前（合言葉が違うと 403）
export const getUsage = (key) => request("/api/usage", { method: "POST", body: JSON.stringify({ key }) });
