// 協力者に発行するパスワードを作る（要件 3.8：画面が作る英数字 16 文字。crypto.getRandomValues を使う）

/** 使う文字（英大文字・英小文字・数字の 62 種類） */
const PASSWORD_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** パスワードの長さ */
const PASSWORD_LENGTH = 16;

// 1 バイトの乱数（0〜255）のうち、62 の倍数に収まる 0〜247 だけを使う（248 以上を捨てて、どの文字も同じ確率にする）
const UNBIASED_LIMIT = 256 - (256 % PASSWORD_CHARACTERS.length);

/** 英大文字・英小文字・数字からなる 16 文字のパスワードを作る（Math.random は使わない） */
export function generatePassword(): string {
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
