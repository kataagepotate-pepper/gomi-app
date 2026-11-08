// 最初に1回だけ出す「所属と名前」の入力（あとから上部の名前ボタンで変えられる）
import StaffForm from "../components/StaffForm.jsx";

export default function NameSetup({ onDone }) {
  return (
    <main className="setup">
      <img className="setup-logo" src="/fes/logo.webp" alt="2026 かまた祭" width="1200" height="523" />
      <h1 className="setup-title">売店ゴミ回収きろく</h1>
      <p className="setup-lead">
        どの売店がいつゴミを出しに来たかを共有します。所属によってできることが変わるので、所属と名前を選んでください。
      </p>
      <div className="setup-form">
        <StaffForm initial="" onSave={onDone} submitLabel="はじめる" idPrefix="setup" />
      </div>
      <button type="button" className="link-btn setup-skip" onClick={() => onDone("")}>
        所属を選ばずに見るだけで使う
      </button>
    </main>
  );
}
