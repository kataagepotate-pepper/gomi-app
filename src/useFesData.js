// その日の店舗と記録を5秒ごとに取り直し、押した操作はすぐ画面に反映する（あとからサーバーの結果で確定）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api.js";

const POLL_MS = 5000;

// サーバーの記録に、まだサーバーに反映されていない手元の記録（送信中・取り消し中）を重ねる
function mergeRecords(server, local) {
  const byId = new Map(server.map((r) => [r.id, r]));
  const extra = [];
  for (const rec of local.values()) {
    const s = byId.get(rec.id);
    if (!s) extra.push(rec);
    else if (rec.canceled_at && !s.canceled_at) byId.set(rec.id, rec);
  }
  const all = [...byId.values(), ...extra];
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
  return all;
}

// サーバー側が追いついた手元の記録は消す
function pruneLocal(local, server) {
  const byId = new Map(server.map((r) => [r.id, r]));
  const next = new Map();
  for (const [key, rec] of local) {
    const s = byId.get(rec.id);
    const caughtUp = s && (s.canceled_at || !rec.canceled_at);
    if (rec.pending || !caughtUp) next.set(key, rec);
  }
  return next.size === local.size ? local : next;
}

export function useFesData(day) {
  const [server, setServer] = useState(null); // { stores, records }
  const [local, setLocal] = useState(() => new Map());
  const [localNotes, setLocalNotes] = useState(() => new Map()); // メモも記録と同じ仕組みで、手元の分を重ねる
  const [connected, setConnected] = useState(true);
  const dayRef = useRef(day);
  dayRef.current = day;

  const load = useCallback(async () => {
    const asked = dayRef.current;
    try {
      const data = await api.getState(asked);
      if (dayRef.current !== asked) return; // 途中で日を切り替えた
      const notes = Array.isArray(data.notes) ? data.notes : [];
      setServer({ stores: data.stores, records: data.records, notes });
      setLocal((prev) => pruneLocal(prev, data.records));
      setLocalNotes((prev) => pruneLocal(prev, notes));
      setConnected(true);
    } catch {
      if (dayRef.current === asked) setConnected(false);
    }
  }, []);

  // 日を切り替えたら取り直し。タブが見えている間だけ5秒ごとに取る
  useEffect(() => {
    setServer(null);
    setLocal(new Map());
    setLocalNotes(new Map());
    let timer = null;
    const start = () => {
      if (timer) return;
      load();
      timer = setInterval(load, POLL_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const onVisible = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [day, load]);

  const records = useMemo(() => (server ? mergeRecords(server.records, local) : []), [server, local]);

  const setLocalEntry = (key, rec) =>
    setLocal((prev) => {
      const next = new Map(prev);
      if (rec) next.set(key, rec);
      else next.delete(key);
      return next;
    });

  // 記録を追加。成功なら true、失敗なら Error を投げる
  const addRecord = useCallback(async ({ store_no, kind, bags, staff }) => {
    const fes_day = dayRef.current;
    const tempKey = `t${Date.now()}${Math.random()}`;
    setLocalEntry(tempKey, {
      id: -Date.now(),
      store_no,
      fes_day,
      kind,
      bags: kind === "bags" ? bags : null,
      staff: staff || null,
      created_at: new Date().toISOString(),
      canceled_at: null,
      pending: true,
    });
    try {
      const { record } = await api.addRecord({ store_no, fes_day, kind, bags, staff });
      setLocal((prev) => {
        const next = new Map(prev);
        next.delete(tempKey);
        if (record.fes_day === dayRef.current) next.set(`r${record.id}`, record);
        return next;
      });
      setConnected(true);
      return record;
    } catch (err) {
      setLocalEntry(tempKey, null);
      if (err.network) setConnected(false);
      throw err;
    }
  }, []);

  const cancelRecord = useCallback(
    async (rec, staff) => {
      const key = `r${rec.id}`;
      const before = local.get(key);
      setLocalEntry(key, { ...rec, canceled_at: new Date().toISOString(), canceled_by: staff || null, pending: true });
      try {
        const { record } = await api.cancelRecord(rec.id, staff);
        setLocalEntry(key, record);
        setConnected(true);
      } catch (err) {
        setLocalEntry(key, before || null);
        if (err.network) setConnected(false);
        throw err;
      }
    },
    [local],
  );

  const renameStore = useCallback(async (no, name, staff) => {
    const { store } = await api.renameStore(no, name, staff);
    setServer((prev) => prev && { ...prev, stores: prev.stores.map((s) => (s.no === store.no ? store : s)) });
    return store;
  }, []);

  const notes = useMemo(() => (server ? mergeRecords(server.notes, localNotes) : []), [server, localNotes]);

  const setNoteEntry = (key, note) =>
    setLocalNotes((prev) => {
      const next = new Map(prev);
      if (note) next.set(key, note);
      else next.delete(key);
      return next;
    });

  // メモを残す。失敗したら Error を投げる
  const addNote = useCallback(async ({ body, staff, store_no = null }) => {
    const fes_day = dayRef.current;
    const tempKey = `t${Date.now()}${Math.random()}`;
    setNoteEntry(tempKey, {
      id: -Date.now(),
      fes_day,
      store_no,
      body,
      staff: staff || null,
      created_at: new Date().toISOString(),
      canceled_at: null,
      pending: true,
    });
    try {
      const { note } = await api.addNote({ fes_day, body, staff, store_no });
      setLocalNotes((prev) => {
        const next = new Map(prev);
        next.delete(tempKey);
        if (note.fes_day === dayRef.current) next.set(`n${note.id}`, note);
        return next;
      });
      setConnected(true);
      return note;
    } catch (err) {
      setNoteEntry(tempKey, null);
      if (err.network) setConnected(false);
      throw err;
    }
  }, []);

  const cancelNote = useCallback(
    async (note, staff) => {
      const key = `n${note.id}`;
      const before = localNotes.get(key);
      setNoteEntry(key, { ...note, canceled_at: new Date().toISOString(), canceled_by: staff || null, pending: true });
      try {
        const res = await api.cancelNote(note.id, staff);
        setNoteEntry(key, res.note);
        setConnected(true);
      } catch (err) {
        setNoteEntry(key, before || null);
        if (err.network) setConnected(false);
        throw err;
      }
    },
    [localNotes],
  );

  return {
    loading: !server,
    notes,
    addNote,
    cancelNote,
    stores: server ? server.stores : [],
    records,
    connected,
    reload: load,
    addRecord,
    cancelRecord,
    renameStore,
  };
}
