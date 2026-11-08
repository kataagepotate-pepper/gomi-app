// 所属（3つから選ぶ）と名前の入力。保存するのは「名前（所属）」の1つの文字列
import { useState } from "react";
import { ROLES, baseMax, formatStaff, parseStaff } from "../logic.js";

const ROLE_HINT = {
  本部: "記録・報告書",
  教員: "記録・報告書",
  施設管理: "記録（報告書は担当3人）",
  売店部: "見る・メモ",
};

export default function StaffForm({ initial, onSave, onCancel, submitLabel = "保存する", idPrefix = "staff" }) {
  const start = parseStaff(initial);
  const [role, setRole] = useState(start.role);
  const [base, setBase] = useState(start.base);
  const [touched, setTouched] = useState(false);

  const max = role ? baseMax(role) : 14;
  const length = [...base.trim()].length;
  const errors = [];
  if (!role) errors.push("所属を選んでください");
  if (length === 0) errors.push("名前を入れてください");
  if (length > max) errors.push(`名前は${max}文字までです（いま ${length}文字）`);
  const showError = touched && errors.length > 0;

  return (
    <form
      className="staff-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (errors.length === 0) onSave(formatStaff(base, role));
      }}
    >
      <fieldset className="role-set">
        <legend className="field-label">所属</legend>
        <div className="role-grid">
          {ROLES.map((r) => (
            <label key={r} className="role-opt">
              <input type="radio" name={`${idPrefix}-role`} value={r} checked={role === r} onChange={() => setRole(r)} />
              <span className="role-box">
                <span className="role-name">{r}</span>
                <span className="role-hint">{ROLE_HINT[r]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span className="field-label">名前</span>
        <input
          className="input"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="例：たなか"
          autoComplete="nickname"
          enterKeyHint="done"
          aria-invalid={(touched && (length === 0 || length > max)) || undefined}
          aria-describedby={`${idPrefix}-help`}
        />
        <span id={`${idPrefix}-help`} className={`field-help${showError ? " is-error" : ""}`} role={showError ? "alert" : undefined}>
          {showError ? errors.join("。") : `${max}文字まで。記録には「${base.trim() || "名前"}（${role || "所属"}）」と付きます。`}
        </span>
      </label>

      <div className={onCancel ? "dlg-actions" : "staff-actions"}>
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            やめる
          </button>
        )}
        <button type="submit" className="btn btn-ink btn-wide">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
