import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePassword } from "@/features/collaborators";

// 協力者に発行するパスワード（要件 3.8：画面が作る 16 文字の英数字。親の決定：crypto.getRandomValues を使う）

const ALPHANUMERIC_16 = /^[A-Za-z0-9]{16}$/;

describe("発行するパスワード（generatePassword）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("英数字（A–Z・a–z・0–9）だけの 16 文字", () => {
    // 準備・実行
    const password = generatePassword();

    // 検証
    expect(password).toMatch(ALPHANUMERIC_16);
  });

  it("乱数は crypto.getRandomValues から取り、Math.random は使わない", () => {
    // 準備
    const getRandomValues = vi.spyOn(crypto, "getRandomValues");
    const mathRandom = vi.spyOn(Math, "random");

    // 実行
    const password = generatePassword();

    // 検証
    expect(password).toMatch(ALPHANUMERIC_16);
    expect(getRandomValues).toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it("作るたびに違うパスワードになる（50 回作って重なりがない）", () => {
    // 準備・実行
    const passwords = Array.from({ length: 50 }, () => generatePassword());

    // 検証
    expect(passwords.every((password) => ALPHANUMERIC_16.test(password))).toBe(true);
    expect(new Set(passwords).size).toBe(passwords.length);
  });

  it("英大文字・英小文字・数字のどれも使う（200 回作ると、どの種類の文字も現れる）", () => {
    // 準備・実行：16 文字 × 200 回 = 3200 文字。62 種類から選べば、どれかの種類が 1 文字も出ないことはまずない
    const joined = Array.from({ length: 200 }, () => generatePassword()).join("");

    // 検証
    expect(joined).toHaveLength(16 * 200);
    expect(joined).toMatch(/[A-Z]/);
    expect(joined).toMatch(/[a-z]/);
    expect(joined).toMatch(/[0-9]/);
  });
});
