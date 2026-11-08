// メモタブ：全体のメモと店ごとのメモをまとめて見る。ここから書くメモは「全体のメモ」
import { useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { NoteForm, NoteList } from "../components/NoteBoard.jsx";
import { DAYS, canReport, canWriteNote } from "../logic.js";

const FILTERS = [
  { key: "all", label: "すべて" },
  { key: "general", label: "全体" },
  { key: "store", label: "店ごと" },
];

export default function Notes({ day, stores, notes, loading, staff, actions, notify, onReport, onOpenStore }) {
  const [filter, setFilter] = useState("all");
  const storeNames = useMemo(() => new Map(stores.map((s) => [s.no, s.name])), [stores]);
  const shown = notes.filter((n) =>
    filter === "all" ? true : filter === "general" ? n.store_no == null : n.store_no != null,
  );

  return (
    <section aria-labelledby="notes-title">
      <div className="list-head">
        <h1 id="notes-title" className="section-title">
          メモ<span className="section-sub">{DAYS[day].label}・新しい順</span>
        </h1>
        {canReport(staff) && (
          <button type="button" className="btn btn-quiet btn-report" onClick={onReport}>
            <Icon name="printer" size={20} />
            報告書を保存
          </button>
        )}
      </div>

      {canWriteNote(staff) ? (
        <NoteForm
          staff={staff}
          actions={actions}
          notify={notify}
          label="全員に共有するメモ（全体）"
          placeholder="例：ゴミ袋の在庫が残り20枚。本部に追加を依頼済み"
        />
      ) : (
        <p className="notice notice-viewer note-viewer">見るだけモードです。所属を選ぶとメモを書けます。</p>
      )}

      <div className="filter" role="group" aria-label="メモの絞り込み">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="filter-btn" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="empty">読み込んでいます…</p>
      ) : (
        <NoteList
          notes={shown}
          staff={staff}
          actions={actions}
          notify={notify}
          storeNames={storeNames}
          onOpenStore={onOpenStore}
          emptyText={`${DAYS[day].label}の${filter === "general" ? "全体の" : filter === "store" ? "店ごとの" : ""}メモはまだありません。`}
        />
      )}
    </section>
  );
}
