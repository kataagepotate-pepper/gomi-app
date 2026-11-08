// 報告書：その日の集計とメモを1枚にまとめ、印刷画面から PDF として保存する
import { useEffect, useMemo, useState } from "react";
import * as api from "../api.js";
import Icon from "../components/Icon.jsx";
import { DAYS, buildReport, canReport, toDateTime, toTime, displayStaff } from "../logic.js";

export default function Report({ day, staff, onBack }) {
  const allowed = canReport(staff);
  const [state, setState] = useState(null); // { stores, records, notes, at }
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const data = await api.getState(day);
      setState({
        stores: data.stores,
        records: data.records,
        notes: Array.isArray(data.notes) ? data.notes : [],
        at: new Date().toISOString(),
      });
    } catch (err) {
      setError(err.serverMessage || "読み込めませんでした。電波を確認して「最新にする」を押してください");
    }
  }

  useEffect(() => {
    if (allowed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, allowed]);

  const rep = useMemo(() => (state ? buildReport(state.stores, state.records, state.notes) : null), [state]);

  const back = (
    <button type="button" className="link-btn no-print" onClick={onBack}>
      <Icon name="back" size={20} />
      店舗一覧へ戻る
    </button>
  );

  if (!allowed) {
    return (
      <div className="report-denied">
        {back}
        <p>この画面は担当者だけが使えます。</p>
      </div>
    );
  }

  const dayText = DAYS[day].practice ? "練習" : `${DAYS[day].label} ${DAYS[day].date}`;

  return (
    <article className="report">
      <div className="report-tools no-print">
        {back}
        <div className="report-print">
          <button type="button" className="btn btn-ink" onClick={() => window.print()} disabled={!rep}>
            <Icon name="printer" size={20} />
            PDFとして保存
          </button>
          <button type="button" className="btn btn-quiet" onClick={load}>
            最新にする
          </button>
        </div>
        <p className="report-help">
          印刷画面で「PDFとして保存」を選んでください。iPhone は共有ボタン → プリント → もう一度共有ボタンで保存できます。
        </p>
      </div>

      {error && (
        <p className="field-help is-error" role="alert">
          {error}
        </p>
      )}
      {!rep && !error && <p className="empty">読み込んでいます…</p>}

      {rep && (
        <div className="report-sheet">
          <header className="report-head">
            <p className="report-kicker">施設管理</p>
            <h1 className="report-title">かまた祭2026 売店ゴミ回収 報告書</h1>
            <dl className="report-meta">
              <div>
                <dt>対象日</dt>
                <dd>{dayText}</dd>
              </div>
              <div>
                <dt>作成者</dt>
                <dd>{displayStaff(staff)}</dd>
              </div>
              <div>
                <dt>作成時刻</dt>
                <dd>{toDateTime(state.at)}</dd>
              </div>
            </dl>
          </header>

          <section className="report-sec">
            <h2 className="report-h2">集計</h2>
            <table className="report-table report-sum">
              <tbody>
                <tr>
                  <th scope="row">本日終了した店</th>
                  <td>
                    <b className="num">{rep.finished}</b> / {rep.total}店
                  </td>
                </tr>
                <tr>
                  <th scope="row">回収OK</th>
                  <td>
                    <b className="num">{rep.ok}</b>回
                  </td>
                </tr>
                <tr>
                  <th scope="row">差し戻し</th>
                  <td>
                    <b className="num">{rep.returned}</b>回（{rep.returnedStores}店）
                  </td>
                </tr>
                <tr>
                  <th scope="row">配ったゴミ袋</th>
                  <td>
                    <b className="num">{rep.bags}</b>枚
                  </td>
                </tr>
                <tr>
                  <th scope="row">最初の記録</th>
                  <td className="num">{rep.first ? toTime(rep.first) : "—"}</td>
                </tr>
                <tr>
                  <th scope="row">最後の記録</th>
                  <td className="num">{rep.last ? toTime(rep.last) : "—"}</td>
                </tr>
              </tbody>
            </table>
            <p className="report-note">取り消した記録は数えていません。</p>
          </section>

          <section className="report-sec">
            <h2 className="report-h2">
              まだ終了していない店<span className="report-count">{rep.open.length}店</span>
            </h2>
            {rep.open.length === 0 ? (
              <p>なし（全店が本日終了）</p>
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col" className="col-no">
                      番号
                    </th>
                    <th scope="col">店舗名</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.open.map((s) => (
                    <tr key={s.no}>
                      <td className="col-no num">{s.no}</td>
                      <td>{s.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="report-sec">
            <h2 className="report-h2">
              全体のメモ<span className="report-count">{rep.generalNotes.length}件</span>
            </h2>
            {rep.generalNotes.length === 0 ? <p>なし</p> : <NoteTable notes={rep.generalNotes} />}
          </section>

          <section className="report-sec">
            <h2 className="report-h2">
              店ごとのメモ<span className="report-count">{rep.storeNotes.length}件</span>
            </h2>
            {rep.storeNotes.length === 0 ? <p>なし</p> : <NoteTable notes={rep.storeNotes} grouped />}
          </section>
        </div>
      )}
    </article>
  );
}

// メモの表。grouped のときは店ごとに「12番 店舗名」の見出し行を入れる（notes は店番号順に並んでいる前提）
function NoteTable({ notes, grouped = false }) {
  const rows = [];
  let current = null;
  for (const n of notes) {
    if (grouped && n.store_no !== current) {
      current = n.store_no;
      rows.push(
        <tr key={`s${n.store_no}`} className="report-group">
          <th scope="rowgroup" colSpan={3}>
            <span className="num">{n.store_no}</span>番 {n.store_name}
          </th>
        </tr>,
      );
    }
    rows.push(
      <tr key={n.id}>
        <td className="col-time num">{toTime(n.created_at)}</td>
        <td className="col-staff">{displayStaff(n.staff)}</td>
        <td className="note-body">{n.body}</td>
      </tr>,
    );
  }
  return (
    <table className="report-table">
      <thead>
        <tr>
          <th scope="col" className="col-time">
            時刻
          </th>
          <th scope="col" className="col-staff">
            書いた人
          </th>
          <th scope="col">本文</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}
