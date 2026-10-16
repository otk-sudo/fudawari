// 協力者に発行するパスワードを作る（要件 3.8：画面が作る英数字 16 文字。crypto.getRandomValues を使う）。
// Supabase の設定でパスワードの条件（英大文字・英小文字・数字を含む）を付けても通るよう、3 種類の文字を必ず含める

/** 使う文字（英大文字・英小文字・数字の 62 種類） */
const PASSWORD_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** パスワードの長さ */
const PASSWORD_LENGTH = 16;

// 1 バイトの乱数（0〜255）のうち、62 の倍数に収まる 0〜247 だけを使う（248 以上を捨てて、どの文字も同じ確率にする）
const UNBIASED_LIMIT = 256 - (256 % PASSWORD_CHARACTERS.length);

/** 必ず 1 文字以上含める文字の種類（英大文字・英小文字・数字） */
const REQUIRED_CHARACTER_KINDS: readonly RegExp[] = [/[A-Z]/, /[a-z]/, /[0-9]/];

/** 62 種類の文字から 1 文字ずつ同じ確率で選び、16 文字にする（3 種類の文字を含むとは限らない） */
function drawPassword(): string {
  let password = "";
  while (password.length < PASSWORD_LENGTH) {
    // 捨てる分を見込んで多めに取る
    const bytes = crypto.getRandomValues(new Uint8Array(PASSWORD_LENGTH * 2));
    for (const byte of bytes) {
      if (byte >= UNBIASED_LIMIT) continue;
      password += PASSWORD_CHARACTERS[byte % PASSWORD_CHARACTERS.length];
      if (password.length === PASSWORD_LENGTH) break;
    }
  }
  return password;
}

/**
 * 英大文字・英小文字・数字を 1 文字以上ずつ含む、16 文字のパスワードを作る（Math.random は使わない）。
 * 3 種類がそろわなければ作り直す（約 6% の確率）。決まった位置に決まった種類を入れないので、
 * 条件を満たすパスワードのどれもが同じ確率で選ばれる
 */
export function generatePassword(): string {
  for (;;) {
    const password = drawPassword();
    if (REQUIRED_CHARACTER_KINDS.every((kind) => kind.test(password))) return password;
  }
}
