// 記録者名の末尾の所属を読み取る（サーバーと画面の両方で使える）
//
//   roleOf("たなか（施設管理）") → "施設管理"
//   roleOf("すずき (本部) ")     → "本部"   （半角かっこ・かっこの前後や中の空白もOK）
//   roleOf("さとう（売店部）")   → "売店部"
//   roleOf("やまだ（教員）")     → "教員"
//   roleOf("たなか") / roleOf(null) → null（所属なし）
//
// 注意：名前は自己申告なので、これは「押し間違い・使い分けのための決まり」であって、本人確認（認証）ではない。

export const ROLES = ["本部", "施設管理", "教員", "売店部"];

const ROLE_RE = /[（(]\s*(売店部|本部|施設管理|教員)\s*[）)]\s*$/u;

export function roleOf(staff) {
  if (typeof staff !== "string") return null;
  const m = ROLE_RE.exec(staff);
  return m ? m[1] : null;
}

// 記録の追加・取り消し・店舗名の変更ができる所属（教員は本部と同じ権限）
export const canRecord = (role) => role === "本部" || role === "施設管理" || role === "教員";
// メモを書ける所属（所属があれば誰でも）
export const canWriteNote = (role) => role !== null;
