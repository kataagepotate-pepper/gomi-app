// 画面全体：上部（ロゴ・日の切り替え）、中身（一覧／店／履歴）、下のタブ、お知らせ
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as api from "./api.js";
import Dialog from "./components/Dialog.jsx";
import Icon from "./components/Icon.jsx";
import StaffForm from "./components/StaffForm.jsx";
import { DAYS, displayStaff, parseStaff, practiceAvailable, roleOf, todayFesDay } from "./logic.js";
import { useFesData } from "./useFesData.js";
import Admin from "./pages/Admin.jsx";
import History from "./pages/History.jsx";
import Home from "./pages/Home.jsx";
import NameSetup from "./pages/NameSetup.jsx";
import Notes from "./pages/Notes.jsx";
import Report from "./pages/Report.jsx";
import Store from "./pages/Store.jsx";

// ---- このスマホに保存する設定（使えない環境でも動くように try で囲む） ----
const KEY_STAFF = "gomi.staff";
const KEY_ONLY_OPEN = "gomi.onlyOpen";
const KEY_DAY = "gomi.day"; // 手で切り替えた日（その日のうちだけ有効）
const KEY_DEVICE = "gomi.device"; // このスマホのランダムな番号（使った人数を数えるため）

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 保存できなくても画面は使える
  }
}

// このスマホの番号（英数字32文字）。保存できない環境では、開いている間だけ同じ番号を使う
let memoDevice = null;
function deviceId() {
  const saved = load(KEY_DEVICE);
  if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
  if (!memoDevice) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    memoDevice = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  save(KEY_DEVICE, memoDevice);
  return memoDevice;
}

function initialDay() {
  const auto = todayFesDay();
  // 「今日の日付:選んだ日」で保存してあるので、日付が変わったら自動に戻る
  const saved = load(KEY_DAY);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  if (saved && saved.startsWith(`${today}:`)) {
    const d = Number(saved.slice(-1));
    // 練習は本番前だけ。10/31 以降は前に練習を選んでいても無視して日付どおりにする
    if (d === 1 || d === 2 || (d === 0 && practiceAvailable())) return d;
  }
  return auto;
}

// ---- URL と画面の対応（/ , /store/5 , /history , /notes , /report?day=1 , /admin） ----
function parseRoute(path) {
  const url = new URL(path, location.origin);
  const pathname = url.pathname;
  const m = pathname.match(/^\/store\/(\d{1,3})\/?$/);
  if (m) return { name: "store", no: Number(m[1]) };
  if (/^\/history\/?$/.test(pathname)) return { name: "history" };
  if (/^\/notes\/?$/.test(pathname)) return { name: "notes" };
  if (/^\/admin\/?$/.test(pathname)) return { name: "admin" };
  if (/^\/report\/?$/.test(pathname)) {
    const d = url.searchParams.get("day");
    return { name: "report", day: d === "0" || d === "1" || d === "2" ? Number(d) : null };
  }
  return { name: "home" };
}

const here = () => location.pathname + location.search;

function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(here()));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(here()));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((path) => {
    if (path === here()) return;
    history.pushState({ inApp: true }, "", path);
    setRoute(parseRoute(path));
  }, []);
  return [route, go];
}

export default function App() {
  const [staff, setStaff] = useState(() => load(KEY_STAFF));
  const [day, setDay] = useState(initialDay);
  const [onlyOpen, setOnlyOpen] = useState(() => load(KEY_ONLY_OPEN) === "1");
  const [route, go] = useRoute();
  const [toast, setToast] = useState(null);
  const [nameOpen, setNameOpen] = useState(false);
  // 練習タブは本番前だけ出す（5秒ごとの取り直しで画面が描き直されるたびに判定し直す）
  const showPractice = practiceAvailable();
  const dayList = showPractice ? [0, 1, 2] : [1, 2];
  if (day === 0 && !showPractice) setDay(todayFesDay()); // 練習のまま日付が 10/31 になったら本番へ
  const data = useFesData(day);

  // ---- 「このスマホが今日開いた」をサーバーに残す ----
  // 日付か名前が変わったときだけ送る。失敗したら、次に画面を開いたときにもう一度送る
  const sentVisit = useRef("");
  useEffect(() => {
    if (staff === null) return;
    const send = () => {
      if (document.hidden) return;
      const key = `${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })}|${staff}`;
      if (sentVisit.current === key) return;
      sentVisit.current = key;
      api.addVisit(deviceId(), staff).catch(() => {
        if (sentVisit.current === key) sentVisit.current = "";
      });
    };
    send();
    document.addEventListener("visibilitychange", send);
    return () => document.removeEventListener("visibilitychange", send);
  }, [staff]);

  // ---- 一覧のスクロール位置を覚えて、店から戻ったときに元の位置へ ----
  const homeScroll = useRef(0);
  useLayoutEffect(() => {
    scrollTo(0, route.name === "home" ? homeScroll.current : 0);
  }, [route]);
  const openStore = (no) => {
    if (route.name === "home") homeScroll.current = scrollY;
    go(`/store/${no}`);
  };

  // ---- お知らせ（数秒で消える） ----
  const toastTimer = useRef(null);
  const notify = useCallback((text, tone = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ text, tone, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), tone === "error" ? 6000 : 3000);
  }, []);

  // 隠しページ（タブには出さない。URL を直接開いて合言葉を入れる）
  if (route.name === "admin") return <Admin onBack={() => go("/")} />;

  if (staff === null) {
    return (
      <NameSetup
        onDone={(name) => {
          save(KEY_STAFF, name);
          setStaff(name);
        }}
      />
    );
  }

  const chooseDay = (d) => {
    setDay(d);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
    save(KEY_DAY, `${today}:${d}`);
  };

  const backHome = () => {
    if (history.state && history.state.inApp) history.back();
    else go("/");
  };

  return (
    <div className={`app${route.name === "store" || route.name === "report" ? " is-store" : ""}${route.name === "report" ? " is-report" : ""}`}>
      {!data.connected && (
        <p className="offline" role="status">
          <Icon name="offline" size={16} />
          つながっていません（自動でつなぎ直します）
        </p>
      )}

      <header className="top">
        <div className="top-row">
          <button type="button" className="top-logo" onClick={() => go("/")} aria-label="店舗一覧へ">
            <img src="/fes/logo.webp" alt="2026 かまた祭" width="1200" height="523" />
          </button>
          <p className="top-title">
            <span>売店ゴミ回収</span>
            <span>きろく</span>
          </p>
          <button type="button" className="staff-btn" onClick={() => setNameOpen(true)}>
            <Icon name="user" size={18} />
            {/* 狭い画面でも所属が切れないよう、名前と所属を2段にする */}
            <span className="staff-text">
              <span className="staff-name">{parseStaff(staff).base || "名前なし"}</span>
              <span className="staff-role">{roleOf(staff) || "見るだけ"}</span>
            </span>
            <span className="sr-only">（名前を変える）</span>
          </button>
        </div>

        <div className={`days${showPractice ? "" : " days-2"}`} role="group" aria-label="記録する日">
          {dayList.map((d) => (
            <button
              key={d}
              type="button"
              className={`day-btn${DAYS[d].practice ? " day-practice" : ""}`}
              aria-pressed={day === d}
              onClick={() => chooseDay(d)}
            >
              <span className="day-label">{DAYS[d].label}</span>
              <span className="day-date num">{DAYS[d].date}</span>
            </button>
          ))}
        </div>
        {!roleOf(staff) && (
          <div className="viewer-note" role="note">
            <p>見るだけモードです。所属を選ぶと記録できます</p>
            <button type="button" className="small-btn" onClick={() => setNameOpen(true)}>
              所属を選ぶ
            </button>
          </div>
        )}
        {DAYS[day].practice && (
          <p className="practice-note" role="note">
            <b>練習中</b>練習の記録は本番（1日目・2日目）に混ざりません
          </p>
        )}
      </header>

      <main className="main" id="main">
        {route.name === "home" && (
          <Home
            day={day}
            stores={data.stores}
            records={data.records}
            notes={data.notes}
            loading={data.loading}
            onlyOpen={onlyOpen}
            setOnlyOpen={(v) => {
              setOnlyOpen(v);
              save(KEY_ONLY_OPEN, v ? "1" : "0");
            }}
            onOpenStore={openStore}
          />
        )}
        {route.name === "store" && (
          <Store
            key={`${route.no}-${day}`}
            no={route.no}
            day={day}
            stores={data.stores}
            records={data.records}
            notes={data.notes}
            loading={data.loading}
            staff={staff}
            actions={data}
            notify={notify}
            onBack={backHome}
          />
        )}
        {route.name === "notes" && (
          <Notes
            day={day}
            stores={data.stores}
            onOpenStore={openStore}
            notes={data.notes}
            loading={data.loading}
            staff={staff}
            actions={data}
            notify={notify}
            onReport={() => go(`/report?day=${day}`)}
          />
        )}
        {route.name === "report" && <Report day={route.day ?? day} staff={staff} onBack={() => go("/")} />}
        {route.name === "history" && (
          <History day={day} stores={data.stores} records={data.records} loading={data.loading} onOpenStore={openStore} />
        )}
      </main>

      <nav className="tabs" aria-label="画面の切り替え">
        <a
          href="/"
          className="tab"
          aria-current={route.name === "home" || route.name === "store" ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            go("/");
          }}
        >
          <Icon name="list" size={22} />
          店舗一覧
        </a>
        <a
          href="/history"
          className="tab"
          aria-current={route.name === "history" ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            go("/history");
          }}
        >
          <Icon name="clock" size={22} />
          履歴
        </a>
        <a
          href="/notes"
          className="tab"
          aria-current={route.name === "notes" ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            go("/notes");
          }}
        >
          <Icon name="note" size={22} />
          メモ
        </a>
      </nav>

      <div className="toast-area" aria-live="polite">
        {toast && (
          <p key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : undefined}>
            {toast.text}
          </p>
        )}
      </div>

      <NameDialog
        open={nameOpen}
        current={staff}
        onClose={() => setNameOpen(false)}
        onSave={(name) => {
          save(KEY_STAFF, name);
          setStaff(name);
          setNameOpen(false);
          notify(`「${displayStaff(name)}」で使います`);
        }}
      />
    </div>
  );
}

function NameDialog({ open, current, onClose, onSave }) {
  return (
    <Dialog open={open} title="所属と名前" onClose={onClose} labelledBy="name-dlg-title">
      {/* 開くたびに今の名前から作り直す */}
      <StaffForm key={String(open)} initial={current} onSave={onSave} onCancel={onClose} idPrefix="dlg" />
      <p className="dlg-foot">これからの記録・メモにだけ付きます。</p>
    </Dialog>
  );
}
