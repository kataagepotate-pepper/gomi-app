-- メモ機能の追加分（2026-10-21）
-- すでに schema.sql を流した Supabase に、この中身だけを「SQL Editor」に貼り付けて実行する。
-- 新しい表 gomi_notes を作るだけで、ほかの表（ビンゴの表や gomi_stores / gomi_records）の中身には触れない（店の番号を参照するだけ）。
-- 何度実行しても壊れない（if not exists）。

-- メモ（報告書用。その日の出来事を自由に書く。削除はせず、取り消しは canceled_at を入れるだけ）（2026-10-21 追加）
create table if not exists gomi_notes (
  id          bigserial primary key,
  fes_day     smallint not null,                  -- 本番の何日目か（1 または 2。0 は本番前の練習用）
  store_no    int references gomi_stores(no),     -- どの店のメモか（空なら全体のメモ）
  body        text not null,                      -- 本文（改行あり・1〜500文字）
  staff       text,                               -- 書いた人の名前（任意・20文字まで）
  created_at  timestamptz not null default now(),
  canceled_at timestamptz,                        -- 取り消した時刻（空なら有効）
  constraint gomi_notes_day check (fes_day in (0, 1, 2)),
  constraint gomi_notes_body_len check (char_length(body) between 1 and 500),
  constraint gomi_notes_staff_len check (staff is null or char_length(staff) between 1 and 20)
);
create index if not exists gomi_notes_day_idx on gomi_notes (fes_day, created_at);
-- 店ごとのメモ（2026-10-21 追加）。store_no の無い前の形で作った表にも列を足す
alter table gomi_notes add column if not exists store_no int references gomi_stores(no);
create index if not exists gomi_notes_store_idx on gomi_notes (fes_day, store_no);
alter table gomi_notes enable row level security;
