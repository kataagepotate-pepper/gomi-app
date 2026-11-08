-- かまた祭 売店ゴミ回収きろく のデータベース定義
-- Supabase では「SQL Editor」にこのファイルの中身を貼り付けて実行する。
-- ビンゴと同じプロジェクトに同居させるので、表の名前はすべて gomi_ で始める（ビンゴの表には触れない）。
-- 何度実行しても壊れないように if not exists / on conflict do nothing を付けている。
-- （店舗名をアプリで変えたあとに流し直しても、変えた名前は元に戻らない）

-- 店舗（出店番号ごとに1行）
create table if not exists gomi_stores (
  no         int primary key,                     -- 出店番号（1〜28）
  name       text not null,                       -- 店舗名（アプリから変えられる）
  updated_at timestamptz not null default now(),  -- 店舗名を最後に変えた時刻
  constraint gomi_stores_name_len check (char_length(name) between 1 and 40)
);

-- 記録（ボタンを1回押すごとに1行。削除はせず、取り消しは canceled_at を入れるだけ）
create table if not exists gomi_records (
  id          bigserial primary key,
  store_no    int not null references gomi_stores(no),
  fes_day     smallint not null,                  -- 本番の何日目か（1 または 2。0 は本番前の練習用）
  kind        text not null,                      -- ok=回収OK / returned=差し戻し / bags=ゴミ袋を渡した / finished=本日終了
  bags        smallint,                           -- 渡したゴミ袋の枚数（kind が bags のときだけ 1〜5）
  staff       text,                               -- 記録した人の名前（任意・20文字まで）
  created_at  timestamptz not null default now(),
  canceled_at timestamptz,                        -- 取り消した時刻（空なら有効）
  constraint gomi_records_day check (fes_day in (0, 1, 2)),
  constraint gomi_records_kind check (kind in ('ok', 'returned', 'bags', 'finished')),
  constraint gomi_records_bags check (
    (kind = 'bags' and bags between 1 and 5) or (kind <> 'bags' and bags is null)
  ),
  constraint gomi_records_staff_len check (staff is null or char_length(staff) between 1 and 20)
);
-- 練習用の 0 を足したとき（2026-10-21）、前の決まり（1 と 2 だけ）で作った表も新しい決まりに作り直す
alter table gomi_records drop constraint if exists gomi_records_day;
alter table gomi_records add constraint gomi_records_day check (fes_day in (0, 1, 2));

create index if not exists gomi_records_day_idx on gomi_records (fes_day, created_at);

-- 出店する28店（最初の1回だけ入る。すでにある番号はそのまま）
insert into gomi_stores (no, name) values
  (1, '売店1'),
  (2, '売店2'),
  (3, '売店3'),
  (4, '売店4'),
  (5, '売店5'),
  (6, '売店6'),
  (7, '売店7'),
  (8, '売店8'),
  (9, '売店9'),
  (10, '売店10'),
  (11, '売店11'),
  (12, '売店12'),
  (13, '売店13'),
  (14, '売店14'),
  (15, '売店15'),
  (16, '売店16'),
  (17, '売店17'),
  (18, '売店18'),
  (19, '売店19'),
  (20, '売店20'),
  (21, '売店21'),
  (22, '売店22'),
  (23, '売店23'),
  (24, '売店24'),
  (25, '売店25'),
  (26, '売店26'),
  (27, '売店27'),
  (28, '売店28')
on conflict (no) do nothing;

-- Supabase の公開API（anonキー）からは一切読めないようにする。
-- サーバー（Netlify Functions）はデータベースに直接つなぐのでこの制限を受けない。
alter table gomi_stores  enable row level security;
alter table gomi_records enable row level security;

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

-- 取り消した人の名前（2026-10-22 追加。取り消した時の記録者名。20文字まで。前からある取り消しは空のまま）
alter table gomi_records add column if not exists canceled_by text;
alter table gomi_records drop constraint if exists gomi_records_canceled_by_len;
alter table gomi_records add constraint gomi_records_canceled_by_len
  check (canceled_by is null or char_length(canceled_by) between 1 and 20);

alter table gomi_notes add column if not exists canceled_by text;
alter table gomi_notes drop constraint if exists gomi_notes_canceled_by_len;
alter table gomi_notes add constraint gomi_notes_canceled_by_len
  check (canceled_by is null or char_length(canceled_by) between 1 and 20);

-- アプリを開いたスマホ（2026-10-29 追加。1台・1日につき1行。隠しページ /admin で人数を見る）
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
