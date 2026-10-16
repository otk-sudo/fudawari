// 値を入れ子まで凍結する（検証して作り直した公開定義を、実行時にも書き換えられない値にする）
//
// - 特効の計算（boost.ts）は定義・段階のオブジェクトをキーに索引を覚えるため、定義は不変の値でなければならない。
//   型（readonly）は書き換えをコンパイル時に禁じ、この関数は実行時に禁じる（strict モードでは代入が TypeError になる）。
// - 渡した値そのものを凍結して返す（複製しない）。呼び出し元の入力を凍結しないよう、作り直した値にだけ使う。
// - 対象は JSON から作り直した素のデータ（オブジェクト・配列・文字列・数・null）で、循環のない木の形であること。
//   すでに凍結されたオブジェクトの中も、取りこぼしのないようにたどって凍結する。

/** 値を入れ子のオブジェクト・配列まで凍結して、同じ値を返す */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
