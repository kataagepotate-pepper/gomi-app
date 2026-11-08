// 確認・入力用のダイアログ。ブラウザ標準の <dialog> を使うので、Esc キーやフォーカスの閉じ込めは任せられる
import { useEffect, useRef } from "react";

export default function Dialog({ open, title, children, onClose, labelledBy = "dlg-title" }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // 外側（暗い所）を押したら閉じる
      }}
    >
      {open && (
        <div className="dlg-body">
          <h2 id={labelledBy} className="dlg-title">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

// 「本当に〜しますか？」用
export function ConfirmDialog({ open, title, message, confirmLabel, tone = "ink", busy, onConfirm, onClose }) {
  return (
    <Dialog open={open} title={title} onClose={busy ? () => {} : onClose}>
      {message && <p className="dlg-text">{message}</p>}
      <div className="dlg-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
          やめる
        </button>
        <button
          type="button"
          className={`btn btn-${tone}`}
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy || undefined}
          autoFocus
        >
          {busy ? "送信中…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
