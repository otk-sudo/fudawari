// テスト用データを凍結する（共有のデータを、あるテストが書き換えて別のテストを壊すのを防ぐ）
// 書き換えたいテストは、各ファイルの clone〜 関数で複製を受け取ってから変える
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
