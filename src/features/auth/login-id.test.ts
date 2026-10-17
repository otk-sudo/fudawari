import { describe, expect, it } from "vitest";
import { isValidLoginId, loginIdToEmail } from "@/features/auth";

// ログインの ID（U3、要件 3.8、docs/design/database.md 2.1.1）
// - 使える文字は英小文字・数字・ハイフン、長さは 3〜32 文字
// - Supabase Auth には「ID@fudawari.invalid」の形で渡す

describe("ログインの ID（@/features/auth の isValidLoginId・loginIdToEmail）", () => {
  describe("isValidLoginId：使える形か", () => {
    it.each([
      ["英小文字だけ", "abc"],
      ["英小文字・数字・ハイフンを混ぜたもの", "taro-01"],
      ["数字だけ", "123"],
      ["いちばん短い 3 文字", "a1-"],
      ["いちばん長い 32 文字", "a".repeat(32)],
    ])("%s（%s）は使える", (_label, loginId) => {
      // 準備・実行・検証
      expect(isValidLoginId(loginId)).toBe(true);
    });

    it.each([
      ["空", ""],
      ["2 文字（短すぎる）", "ab"],
      ["33 文字（長すぎる）", "a".repeat(33)],
      ["英大文字を含む", "Taro"],
      ["下線を含む", "taro_01"],
      ["点を含む", "taro.01"],
      ["空白を含む", "taro 01"],
      ["@ を含む（メールアドレスの形）", "taro@example.com"],
      ["日本語", "たろう"],
      ["全角の英数字", "ｔａｒｏ"],
    ])("%s（%j）は使えない", (_label, loginId) => {
      // 準備・実行・検証
      expect(isValidLoginId(loginId)).toBe(false);
    });
  });

  describe("loginIdToEmail：Supabase Auth に渡すメールアドレスの形", () => {
    it.each([
      ["taro-01", "taro-01@fudawari.invalid"],
      ["abc", "abc@fudawari.invalid"],
    ])("%s は %s になる", (loginId, email) => {
      // 準備・実行・検証
      expect(loginIdToEmail(loginId)).toBe(email);
    });
  });
});
