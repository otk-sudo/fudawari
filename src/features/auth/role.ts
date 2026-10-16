// 権限の入口（PR-03 では仮の値を持つストア。PR-10 で中身だけをログイン状態に差し替える）
// 画面は必ず `@/features/auth` から権限を受け取る。レイアウトや画面は中身を知らない作りにする

/** 権限：一般利用者（user）／協力者（collab）／管理者（admin） */
export type Role = "user" | "collab" | "admin";

/**
 * 今の権限を返す。既定（ログインしていない状態）は "user"。
 * setRole で変わったら、使っている部品は新しい権限で描き直される。
 *
 * TODO(PR-03 実装)：空の入れ物。いまは常に "user" を返す
 */
export function useRole(): Role {
  return "user";
}

/**
 * 権限を切り替える（PR-03 ではテストと仮の切り替え用。PR-10 ではログイン処理から呼ぶ）。
 *
 * TODO(PR-03 実装)：空の入れ物。いまは何もしない
 */
export function setRole(role: Role): void {
  void role;
}
