-- 「誰が取り消したか」の追加分（2026-10-22）
-- すでに schema.sql を流した Supabase に、この中身だけを「SQL Editor」に貼り付けて実行する。
-- gomi_notes を使うので、先に 2026-10-21_notes.sql を実行しておくこと（まだなら「gomi_notes が無い」というエラーで止まる。そのときは 2026-10-21_notes.sql を流してから、もう一度これを流せばよい）。
-- gomi_records / gomi_notes に列を1つ足すだけで、中身やほかの表（ビンゴの表）には触れない。何度実行しても壊れない。

-- 取り消した人の名前（取り消した時の記録者名。20文字まで。前からある取り消しは空のまま）
alter table gomi_records add column if not exists canceled_by text;
alter table gomi_records drop constraint if exists gomi_records_canceled_by_len;
alter table gomi_records add constraint gomi_records_canceled_by_len
  check (canceled_by is null or char_length(canceled_by) between 1 and 20);

alter table gomi_notes add column if not exists canceled_by text;
alter table gomi_notes drop constraint if exists gomi_notes_canceled_by_len;
alter table gomi_notes add constraint gomi_notes_canceled_by_len
  check (canceled_by is null or char_length(canceled_by) between 1 and 20);
