import { afterEach, describe, expect, it, vi } from "vitest";
import { readSupabaseConfig } from "@/lib/supabase";
import {
  FAKE_SUPABASE_PUBLISHABLE_KEY,
  FAKE_SUPABASE_URL,
  type SupabaseEnvName,
  stubSupabaseEnv,
  stubSupabaseEnvWithout,
} from "@/test/supabase-fake";

// Supabase の接続先は環境変数 NEXT_PUBLIC_SUPABASE_URL・NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY から読む。
// どちらかがなければ「設定がない」（画面は「ログインの設定がありません」と出し、通信しない）

describe("Supabase の接続先の設定（readSupabaseConfig）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("URL と公開キーの両方があれば、その値を返す", () => {
    // 準備
    stubSupabaseEnv();

    // 実行
    const config = readSupabaseConfig();

    // 検証
    expect(config).toEqual({ url: FAKE_SUPABASE_URL, publishableKey: FAKE_SUPABASE_PUBLISHABLE_KEY });
  });

  it.each<[string, SupabaseEnvName, "" | undefined]>([
    ["URL がない", "NEXT_PUBLIC_SUPABASE_URL", undefined],
    ["公開キーがない", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined],
    ["URL が空", "NEXT_PUBLIC_SUPABASE_URL", ""],
    ["公開キーが空", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ""],
  ])("%sときは null（設定がない）", (_label, name, value) => {
    // 準備
    stubSupabaseEnvWithout(name, value);

    // 実行・検証
    expect(readSupabaseConfig()).toBeNull();
  });

  it("呼ぶたびに今の環境変数を読む（前に読んだ値を使い回さない）", () => {
    // 準備：いったん設定がない状態で読む
    stubSupabaseEnvWithout("NEXT_PUBLIC_SUPABASE_URL");
    expect(readSupabaseConfig()).toBeNull();

    // 実行：設定を入れてから読み直す
    stubSupabaseEnv();

    // 検証
    expect(readSupabaseConfig()).toEqual({
      url: FAKE_SUPABASE_URL,
      publishableKey: FAKE_SUPABASE_PUBLISHABLE_KEY,
    });
  });
});
