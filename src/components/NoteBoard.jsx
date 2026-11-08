// メモの入力欄と一覧（メモタブと店の記録画面で使い回す）。本文は文字としてだけ表示する（HTMLとして扱わない）
import { useRef, useState } from "react";
import { failText } from "../api.js";
import { ConfirmDialog } from "./Dialog.jsx";
import { canCancelNote, toTime, canceledText, displayStaff } from "../logic.js";

const MAX = 500;

export function NoteForm({ storeNo = null, staff, actions, notify, label, placeholder }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  const rest = MAX - [...body].length;
  const canSend = [...body.trim()].length > 0 && rest >= 0 && !busy;
  const helpId = `note-help-${storeNo ?? "all"}`;

  async function submit(e) {
    e.preventDefault();
    if (!canSend || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await actions.addNote({ body: body.trim(), staff, store_no: storeNo });
      setBody("");
      notify("メモを残しました");
    } catch (err) {
      setError(failText(err));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="note-form" onSubmit={submit} noValidate>
      <label className="field">
        <span className="field-label">{label}</span>
        <textarea
          className="input textarea"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError("");
          }}
          rows={storeNo ? 3 : 4}
          placeholder={placeholder}
          aria-describedby={helpId}
          aria-invalid={rest < 0 || Boolean(error) || undefined}
        />
        <span id={helpId} className={`field-help note-help${rest < 0 || error ? " is-error" : ""}`} role={error ? "alert" : undefined}>
          <span>{error || "改行もそのまま残ります。"}</span>
          <span className="num">{rest >= 0 ? `残り ${rest}文字` : `${-rest}文字オーバー`}</span>
        </span>
      </label>
      <button type="submit" className="btn btn-ink btn-wide" disabled={!canSend} aria-busy={busy || undefined}>
        {busy ? "送信中…" : "メモを残す"}
      </button>
    </form>
  );
}

// storeNames を渡すと、店のメモに「12番 店舗名」のラベルを付ける（押すとその店へ）
export function NoteList({ notes, staff, actions, notify, emptyText, storeNames, onOpenStore }) {
  const [target, setTarget] = useState(null);
  const [canceling, setCanceling] = useState(false);
  const lock = useRef(false);

  async function cancel() {
    if (!target || lock.current) return;
    lock.current = true;
    setCanceling(true);
    try {
      await actions.cancelNote(target, staff);
      notify(`${toTime(target.created_at)} のメモを取り消しました`);
      setTarget(null);
    } catch (err) {
      notify(failText(err), "error");
    } finally {
      lock.current = false;
      setCanceling(false);
    }
  }

  if (notes.length === 0) return <p className="log-empty">{emptyText}</p>;

  return (
    <>
      <ul className="note-list">
        {notes.map((n) => (
          <li key={n.pending ? `p${n.created_at}` : n.id} className={`note${n.canceled_at ? " is-canceled" : ""}`}>
            <div className="note-head">
              <span className="log-time num">{toTime(n.created_at)}</span>
              <span className="log-staff">{displayStaff(n.staff)}</span>
              {n.canceled_at && <span className="canceled-label">{canceledText(n)}</span>}
              <span className="note-act">
                {n.pending && !n.canceled_at ? (
                  <span className="sending">送信中</span>
                ) : !n.canceled_at && canCancelNote(staff, n) ? (
                  <button
                    type="button"
                    className="small-btn"
                    onClick={() => setTarget(n)}
                    aria-label={`${toTime(n.created_at)} のメモを取り消す`}
                  >
                    取り消し
                  </button>
                ) : null}
              </span>
            </div>
            {storeNames && n.store_no != null && (
              <button type="button" className="note-store" onClick={() => onOpenStore(n.store_no)}>
                <span className="num">{n.store_no}</span>番 {storeNames.get(n.store_no) || ""}
              </button>
            )}
            <p className="note-body">{n.body}</p>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(target)}
        title="このメモを取り消しますか？"
        message={target ? `${toTime(target.created_at)}（${displayStaff(target.staff)}）のメモ。取り消したメモは打ち消し線で残ります。` : ""}
        confirmLabel="取り消す"
        tone="returned"
        busy={canceling}
        onConfirm={cancel}
        onClose={() => setTarget(null)}
      />
    </>
  );
}
