-- 「その日アプリを使った人数」の追加分（2026-10-29）
-- すでに schema.sql を流した Supabase に、この中身だけを「SQL Editor」に貼り付けて実行する。
-- 新しい表 gomi_visits を作るだけで、ほかの表（ビンゴの表や gomi_ で始まるほかの表）には触れない。
-- 何度実行しても壊れない（if not exists）。

-- アプリを開いたスマホ（1台・1日につき1行。開くたびに最後に開いた時刻と名前を更新する）
create table if not exists gomi_visits (
  device     text not null,                       -- スマホごとのランダムな番号（英数字32文字。個人は特定しない）
  fes_day    smallint not null,                   -- 本番の何日目か（1 または 2。0 は本番前の練習用）
  staff      text,                                -- 最後に開いたときの名前（所属なし・見るだけなら空）
  first_seen timestamptz not null default now(),  -- その日はじめて開いた時刻
  last_seen  timestamptz not null default now(),  -- その日最後に開いた時刻
  primary key (device, fes_day),
  constraint gomi_visits_day check (fes_day in (0, 1, 2)),
  constraint gomi_visits_device check (device ~ '^[0-9a-f]{32}$'),
  constraint gomi_visits_staff_len check (staff is null or char_length(staff) between 1 and 20)
);
alter table gomi_visits enable row level security;
