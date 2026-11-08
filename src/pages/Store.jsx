// 店の記録画面：屋外で片手で押せる大きなボタンと、その店のその日の記録
import { useMemo, useRef, useState } from "react";
import Dialog, { ConfirmDialog } from "../components/Dialog.jsx";
import Icon from "../components/Icon.jsx";
import { NoteForm, NoteList } from "../components/NoteBoard.jsx";
import StatusTag from "../components/StatusTag.jsx";
import { failText } from "../api.js";
import { DAYS, canRecord, canWriteNote, kindText, roleOf, summarize, toTime, canceledText, displayStaff } from "../logic.js";

const BAG_COUNTS = [1, 2, 3, 4, 5];

export default function Store({ no, day, stores, records, notes = [], loading, staff, actions, notify, onBack }) {
  const store = stores.find((s) => s.no === no);
  const mine = useMemo(() => records.filter((r) => r.store_no === no), [records, no]);
  const sum = useMemo(() => summarize(mine), [mine]);
  const myNotes = useMemo(() => notes.filter((n) => n.store_no === no), [notes, no]);

  const [busy, setBusy] = useState(null); // 送信中のボタン（表示用）
  const lock = useRef(false); // 二重押し防止（画面の更新を待たずに効く）
  const [bagsOpen, setBagsOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // { type: 'finish' } | { type: 'cancel', rec }
  const [renameOpen, setRenameOpen] = useState(false);

  if (loading) return <p className="empty">読み込んでいます…</p>;
  if (!store) {
    return (
      <div className="empty">
        <p>{no}番の店は見つかりませんでした。</p>
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          店舗一覧へ戻る
        </button>
      </div>
    );
  }

  async function record(kind, bags) {
    if (lock.current) return;
    lock.current = true;
    setBusy(kind);
    try {
      await actions.addRecord({ store_no: no, kind, bags, staff });
      notify(`${no}番 ${kind === "bags" ? `ゴミ袋 ${bags}枚` : kindText({ kind })} を記録しました`);
      if (navigator.vibrate) navigator.vibrate(20);
      setBagsOpen(false);
    } catch (err) {
      notify(failText(err), "error");
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    if (confirm.type === "finish") {
      await record("finished");
      setConfirm(null);
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy("cancel");
    try {
      await actions.cancelRecord(confirm.rec, staff);
      notify(`${toTime(confirm.rec.created_at)} の「${kindText(confirm.rec)}」を取り消しました`);
      setConfirm(null);
    } catch (err) {
      notify(failText(err), "error");
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  const finished = sum.status === "finished";
  const disabled = Boolean(busy);

  return (
    <article className="store-page">
      <div className="crumb">
        <button type="button" className="link-btn" onClick={onBack}>
          <Icon name="back" size={20} />
          店舗一覧
        </button>
        <span className="crumb-day">
          {DAYS[day].label} {DAYS[day].date}
        </span>
      </div>

      <header className={`store-head st-${sum.status}`}>
        <p className="store-head-no">
          <span className="num">{no}</span>番
        </p>
        <h1 className="store-head-name">{store.name}</h1>
        <div className="store-head-meta">
          <StatusTag status={sum.status} large />
          <span className="meta-item">
            最後 <b className="num">{sum.lastVisit ? toTime(sum.lastVisit) : "--:--"}</b>
          </span>
          <span className="meta-item">
            回収OK <b className="num">{sum.okCount}</b>回
          </span>
          <span className="meta-item">
            ゴミ袋 <b className="num">{sum.bags}</b>枚
          </span>
        </div>
      </header>

      {!canRecord(staff) && (
        <p className="notice notice-viewer">
          {roleOf(staff) ? `${roleOf(staff)}の人は見るだけです。` : "見るだけモードです。"}
          記録・取り消し・店舗名の変更は、本部・教員・施設管理の人ができます。
        </p>
      )}

      {canRecord(staff) && (
      <section className="actions" aria-label="記録する">
        {finished && (
          <p className="notice">
            この店は本日終了しています。回収OKなどを追加しても、状態は「本日終了」のままです。
          </p>
        )}
        <div className="action-grid">
          <button type="button" className="act act-ok" disabled={disabled} aria-busy={busy === "ok" || undefined} onClick={() => record("ok")}>
            <Icon name="check" size={28} />
            {busy === "ok" ? "送信中…" : "回収OK"}
          </button>
          <button
            type="button"
            className="act act-returned"
            disabled={disabled}
            aria-busy={busy === "returned" || undefined}
            onClick={() => record("returned")}
          >
            <Icon name="undo" size={28} />
            {busy === "returned" ? "送信中…" : "差し戻し"}
          </button>
        </div>

        <button
          type="button"
          className="act act-bags"
          disabled={disabled}
          aria-expanded={bagsOpen}
          aria-controls="bag-picker"
          onClick={() => setBagsOpen((v) => !v)}
        >
          <Icon name="bag" size={26} />
          {busy === "bags" ? "送信中…" : "ゴミ袋を渡した"}
          <span className="act-hint">{bagsOpen ? "閉じる" : "枚数を選ぶ"}</span>
        </button>
        {bagsOpen && (
          <fieldset id="bag-picker" className="bag-picker">
            <legend>何枚渡しましたか？</legend>
            <div className="bag-row">
              {BAG_COUNTS.map((n) => (
                <button key={n} type="button" className="bag-btn" disabled={disabled} onClick={() => record("bags", n)}>
                  <span className="num">{n}</span>枚
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <button
          type="button"
          className="act act-finished"
          disabled={disabled || finished}
          onClick={() => setConfirm({ type: "finish" })}
        >
          <Icon name="flag" size={26} />
          {finished ? "本日終了 記録済み" : "本日終了"}
          <span className="act-hint">クリアファイル回収</span>
        </button>
      </section>
      )}

      <section className="log" aria-labelledby="log-title">
        <h2 id="log-title" className="section-title">
          この店の記録<span className="section-sub">{DAYS[day].label}・新しい順</span>
        </h2>
        {mine.length === 0 ? (
          <p className="log-empty">まだ記録はありません。</p>
        ) : (
          <ul className="log-list">
            {mine.map((r) => (
              <li key={r.pending ? `p${r.created_at}` : r.id} className={`log-row k-${r.kind}${r.canceled_at ? " is-canceled" : ""}`}>
                <span className="log-time num">{toTime(r.created_at)}</span>
                <span className="log-kind">
                  <span className="kind-mark" aria-hidden="true" />
                  <span className="log-kind-text">{kindText(r)}</span>
                  {r.canceled_at && <span className="canceled-label">{canceledText(r)}</span>}
                </span>
                <span className="log-staff">{displayStaff(r.staff)}</span>
                <span className="log-act">
                  {r.pending && !r.canceled_at ? (
                    <span className="sending">送信中</span>
                  ) : !r.canceled_at && canRecord(staff) ? (
                    <button
                      type="button"
                      className="small-btn"
                      disabled={disabled}
                      onClick={() => setConfirm({ type: "cancel", rec: r })}
                      aria-label={`${toTime(r.created_at)} の${kindText(r)}を取り消す`}
                    >
                      取り消し
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWriteNote(staff) && (
      <section className="log store-notes" aria-labelledby="store-notes-title">
        <h2 id="store-notes-title" className="section-title">
          この店のメモ<span className="section-sub">{DAYS[day].label}・新しい順</span>
        </h2>
        <NoteForm
          storeNo={no}
          staff={staff}
          actions={actions}
          notify={notify}
          label={`${no}番へのメモ`}
          placeholder="例：分別が不十分。15時にもう一度来るとのこと"
        />
        <NoteList notes={myNotes} staff={staff} actions={actions} notify={notify} emptyText="この店のメモはまだありません。" />
      </section>
      )}

      {canRecord(staff) && (
        <div className="rename-area">
          <button type="button" className="btn btn-quiet btn-wide" onClick={() => setRenameOpen(true)}>
            <Icon name="pencil" size={20} />
            店舗名を変える
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirm?.type === "finish"}
        title={`${no}番を本日終了にしますか？`}
        message={`「${store.name}」からクリアファイルを回収しましたか？ 終了にすると一覧で「本日終了」になります。`}
        confirmLabel="本日終了にする"
        tone="finished"
        busy={busy === "finished"}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.type === "cancel"}
        title="この記録を取り消しますか？"
        message={confirm?.rec ? `${toTime(confirm.rec.created_at)}「${kindText(confirm.rec)}」（${displayStaff(confirm.rec.staff)}）。取り消した記録は打ち消し線で残ります。` : ""}
        confirmLabel="取り消す"
        tone="returned"
        busy={busy === "cancel"}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
      <RenameDialog
        open={renameOpen}
        store={store}
        onClose={() => setRenameOpen(false)}
        onSave={async (name) => {
          await actions.renameStore(no, name, staff);
          notify(`${no}番の店舗名を「${name}」に変えました`);
          setRenameOpen(false);
        }}
      />
    </article>
  );
}

function RenameDialog({ open, store, onClose, onSave }) {
  const [name, setName] = useState(store.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);

  // 開くたびに今の名前を入れ直す
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(store.name);
      setError("");
    }
  }

  const length = [...name.trim()].length;

  async function submit(e) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return setError("店舗名を入れてください");
    if (length > 40) return setError("店舗名は40文字までです");
    setSaving(true);
    setError("");
    try {
      await onSave(value);
    } catch (err) {
      setError(failText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} title={`${store.no}番の店舗名を変える`} onClose={saving ? () => {} : onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span className="field-label">新しい店舗名</span>
          <input
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            maxLength={60}
            autoComplete="off"
            aria-invalid={Boolean(error) || undefined}
            aria-describedby="rename-help"
          />
          <span id="rename-help" className={`field-help${error ? " is-error" : ""}`} role={error ? "alert" : undefined}>
            {error || `1〜40文字（いま ${length}文字）。全員の画面で名前が変わります。`}
          </span>
        </label>
        <div className="dlg-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={saving}>
            やめる
          </button>
          <button type="submit" className="btn btn-ink" disabled={saving} aria-busy={saving || undefined}>
            {saving ? "保存中…" : "保存する"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
