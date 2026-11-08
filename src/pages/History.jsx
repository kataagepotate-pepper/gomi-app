// 履歴：その日の全記録を新しい順に
import { useMemo } from "react";
import { DAYS, kindText, toTime, canceledText, displayStaff } from "../logic.js";

export default function History({ day, stores, records, loading, onOpenStore }) {
  const names = useMemo(() => new Map(stores.map((s) => [s.no, s.name])), [stores]);
  const canceled = records.filter((r) => r.canceled_at).length;

  if (loading) return <p className="empty">読み込んでいます…</p>;

  return (
    <section aria-labelledby="hist-title">
      <div className="list-head">
        <h1 id="hist-title" className="section-title">
          履歴<span className="section-sub">{DAYS[day].label}・新しい順</span>
        </h1>
        <p className="hist-count">
          全<b className="num">{records.length}</b>件
          {canceled > 0 && <>（取り消し {canceled}件）</>}
        </p>
      </div>

      {records.length === 0 ? (
        <p className="empty">{DAYS[day].label}の記録はまだありません。</p>
      ) : (
        <ul className="hist-list">
          {records.map((r) => (
            <li key={r.pending ? `p${r.created_at}` : r.id} className={`hist-row k-${r.kind}${r.canceled_at ? " is-canceled" : ""}`}>
              <button type="button" className="hist-btn" onClick={() => onOpenStore(r.store_no)}>
                <span className="log-time num">{toTime(r.created_at)}</span>
                <span className="hist-store">
                  <span className="hist-no num">{r.store_no}</span>
                  <span className="hist-name">{names.get(r.store_no) || "（不明な店）"}</span>
                </span>
                <span className="log-kind">
                  <span className="kind-mark" aria-hidden="true" />
                  <span className="log-kind-text">{kindText(r)}</span>
                  {r.canceled_at && <span className="canceled-label">{canceledText(r)}</span>}
                  {r.pending && !r.canceled_at && <span className="sending">送信中</span>}
                </span>
                <span className="log-staff">{displayStaff(r.staff)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
