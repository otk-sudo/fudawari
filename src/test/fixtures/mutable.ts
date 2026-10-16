// 読み取り専用の型を、入れ子まで書き換えられる型にする（テスト用）
//
// 公開定義の型（PublicDefinition など）は深く読み取り専用にしてある。
// 壊した例・編集の例を作るテストは、複製（cloneSummer2026Definition の戻り値）をこの型で受け取って書き換える。
// 対象はテスト用データのような素のデータ（オブジェクト・配列・文字列・数・null）だけ。関数・Map・Set は考えない。

/** 入れ子のオブジェクト・配列まで readonly を外した型 */
export type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;
