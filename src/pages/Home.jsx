// 店舗一覧（ホーム）：28店の状態をひと目で見る
import { useMemo } from "react";
import Icon from "../components/Icon.jsx";
import StatusTag from "../components/StatusTag.jsx";
import { DAYS, groupByStore, summarize, toTime } from "../logic.js";

export default function Home({ day, stores, records, notes = [], loading, onlyOpen, setOnlyOpen, onOpenStore }) {
  const rows = useMemo(() => {
    const grouped = groupByStore(records);
    const noteCount = new Map();
    for (const n of notes) if (n.store_no != null && !n.canceled_at) noteCount.set(n.store_no, (noteCount.get(n.store_no) || 0) + 1);
    return stores.map((s) => ({ ...s, ...summarize(grouped.get(s.no) || []), notes: noteCount.get(s.no) || 0 }));
  }, [stores, records, notes]);

  const total = rows.length;
  const done = rows.filter((r) => r.status === "finished").length;
  const returned = rows.filter((r) => r.status === "returned").length;
  const shown = onlyOpen ? rows.filter((r) => r.status !== "finished") : rows;

  return (
    <>
      <section className="summary" aria-label="本日の進み具合">
        <div className="summary-main">
          <p className="summary-label">本日終了</p>
          <p className="summary-count">
            <span className="num">{loading ? "–" : done}</span>
            <span className="summary-of">/{loading ? "–" : total}店</span>
          </p>
        </div>
        <dl className="summary-side">
          <div>
            <dt>最終受付</dt>
            <dd className="num">{DAYS[day].last || "—"}</dd>
          </div>
          <div>
            <dt>差し戻し中</dt>
            <dd className="num">{loading ? "–" : `${returned}店`}</dd>
          </div>
        </dl>
        {/* 数字で読めるので、棒は見た目だけ */}
        <div className="meter" aria-hidden="true">
          {/* style は JS から設定されるので、CSP（インラインstyle禁止）には引っかからない */}
          <span className="meter-bar" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      </section>

      <div className="list-head">
        <h2 className="section-title">店舗一覧</h2>
        <label className="check">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          <span className="check-box" aria-hidden="true">
            <Icon name="check" size={16} />
          </span>
          未終了だけ表示
        </label>
      </div>

      {loading ? (
        <p className="empty">読み込んでいます…</p>
      ) : shown.length === 0 ? (
        <div className="empty empty-done">
          <img src="/fes/kokaton.webp" alt="" width="96" height="126" />
          <p>
            <strong>全{total}店が本日終了しました。</strong>
            <br />
            おつかれさまでした。
          </p>
        </div>
      ) : (
        <ol className="stores">
          {shown.map((s) => (
            <li key={s.no} className={`store st-${s.status}`}>
              <button type="button" className="store-btn" onClick={() => onOpenStore(s.no)}>
                <span className="store-no num" aria-label={`${s.no}番`}>
                  {s.no}
                </span>
                <span className="store-body">
                  <span className="store-name">{s.name}</span>
                  <span className="store-meta">
                    <StatusTag status={s.status} />
                    <span className="meta-item">
                      最後 <b className="num">{s.lastVisit ? toTime(s.lastVisit) : "--:--"}</b>
                    </span>
                    <span className="meta-item">
                      OK <b className="num">{s.okCount}</b>回
                    </span>
                    <span className="meta-item">
                      袋 <b className="num">{s.bags}</b>枚
                    </span>
                    {s.notes > 0 && <span className="memo-mark">メモ {s.notes}件</span>}
                  </span>
                </span>
                <Icon name="forward" className="store-arrow" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
