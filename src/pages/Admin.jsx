// 隠しページ（/admin）：合言葉を入れると、日ごとにアプリを使ったスマホの台数と名前が見られる
import { useEffect, useState } from "react";
import * as api from "../api.js";
import Icon from "../components/Icon.jsx";
import { DAYS, ROLES, parseStaff, toDateTime, toTime } from "../logic.js";

// 合言葉はこのタブを閉じるまでだけ覚える（使えない環境では毎回入れる）
const KEY_ADMIN = "gomi.adminKey";
function loadKey() {
  try {
    return sessionStorage.getItem(KEY_ADMIN) || "";
  } catch {
    return "";
  }
}
function saveKey(value) {
  try {
    if (value) sessionStorage.setItem(KEY_ADMIN, value);
    else sessionStorage.removeItem(KEY_ADMIN);
  } catch {
    // 覚えられなくても使える
  }
}

const VIEWER = "見るだけ";
const ORDER = [1, 2, 0]; // 本番を先に、練習は最後

export default function Admin({ onBack }) {
  const [key, setKey] = useState(loadKey);
  const [input, setInput] = useState("");
  const [usage, setUsage] = useState(null); // { days, at }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(k) {
    setBusy(true);
    setError("");
    try {
      const data = await api.getUsage(k);
      setUsage({ days: data.days, at: new Date().toISOString() });
      setKey(k);
      saveKey(k);
    } catch (err) {
      if (err.status === 403) {
        setKey("");
        saveKey("");
        setUsage(null);
      }
      setError(err.serverMessage || "読み込めませんでした。電波を確認してもう一度");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (key) load(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const back = (
    <button type="button" className="link-btn" onClick={onBack}>
      <Icon name="back" size={20} />
      店舗一覧へ戻る
    </button>
  );

  if (!key) {
    return (
      <main className="setup admin">
        {back}
        <h1 className="admin-title">使った人数</h1>
        <form
          className="staff-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) load(input.trim());
          }}
        >
          <label className="field">
            <span className="field-label">合言葉</span>
            <input
              className="input"
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
              enterKeyHint="go"
              aria-invalid={error ? true : undefined}
              aria-describedby="admin-help"
            />
            <span id="admin-help" className={`field-help${error ? " is-error" : ""}`} role={error ? "alert" : undefined}>
              {error || "管理者だけが見られるページです。"}
            </span>
          </label>
          <div className="staff-actions">
            <button type="submit" className="btn btn-ink btn-wide" disabled={busy} aria-busy={busy || undefined}>
              見る
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="setup admin">
      <div className="report-tools">
        {back}
        <div className="report-print">
          <button type="button" className="btn btn-quiet" onClick={() => load(key)} disabled={busy} aria-busy={busy || undefined}>
            最新にする
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setKey("");
              saveKey("");
              setUsage(null);
              setInput("");
            }}
          >
            合言葉を消す
          </button>
        </div>
      </div>

      <h1 className="admin-title">使った人数</h1>
      <p className="report-help">
        その日にアプリを開いたスマホの台数です（1台＝1人として数えています。同じ人が2台で開くと2人、1台を2人で使うと1人になります）。
        {usage && <> {toDateTime(usage.at)} 時点。</>}
      </p>

      {error && (
        <p className="field-help is-error" role="alert">
          {error}
        </p>
      )}
      {!usage && !error && <p className="empty">読み込んでいます…</p>}

      {usage &&
        ORDER.map((d) => {
          const day = usage.days.find((x) => x.fes_day === d) || { count: 0, people: [] };
          if (DAYS[d].practice && day.count === 0) return null;
          return <DayUsage key={d} d={d} day={day} />;
        })}
    </main>
  );
}

function DayUsage({ d, day }) {
  const byRole = Object.fromEntries([...ROLES, VIEWER].map((r) => [r, 0]));
  for (const p of day.people) byRole[p.role || VIEWER] += 1;
  const title = DAYS[d].practice ? "練習（本番前）" : `${DAYS[d].label} ${DAYS[d].date}`;

  return (
    <section className="report-sheet admin-day">
      <h2 className="report-h2">{title}</h2>
      <p className="admin-count">
        <b className="num">{day.count}</b>人
      </p>
      <table className="report-table report-sum">
        <tbody>
          {Object.entries(byRole).map(([role, n]) => (
            <tr key={role}>
              <th scope="row">{role}</th>
              <td>
                <b className="num">{n}</b>人
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {day.people.length > 0 && (
        <div className="admin-list">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">名前</th>
                <th scope="col">所属</th>
                <th scope="col">最初</th>
                <th scope="col">最後</th>
              </tr>
            </thead>
            <tbody>
              {day.people.map((p, i) => (
                <tr key={i}>
                  <td>{parseStaff(p.staff).base || "名前なし"}</td>
                  <td>{p.role || VIEWER}</td>
                  <td className="num">{toTime(p.first_seen)}</td>
                  <td className="num">{toTime(p.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
