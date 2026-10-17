import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSupabaseClient } from "@/lib/supabase";
import {
  failedQuery,
  type FakeSupabase,
  installFakeSupabase,
  networkFailure,
  postgrestFailure,
  profileRow,
  saveLogRow,
  stubSupabaseEnv,
  stubSupabaseEnvWithout,
} from "@/test/supabase-fake";
import { loadSaveLogs } from "./supabase-save-logs";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// 保存の記録を Supabase の save_logs 表から読む（loadSaveLogs。docs/design/database.md 2.6、roadmap T3-10）
// - 指定したイベントの記録だけを、新しい順（created_at の新しい順、同じ日時なら id の大きい順）にすべて返す
// - 列の対応：id → id、created_at → createdAt（同じ時刻の日本時間の「秒の小数のない時差つき」。定義の保管庫の日時と同じ形）、
//   kind → kind（'save'・'publish'）、map_label → mapLabel（公開は null）、summary → summary、保存した人の表示名 → userName
// - 失敗は、画面に出す理由の文（日本語）を message に持つ Error にする（言葉の要点だけを確かめる。定義の保管庫と同じ）
//
// テストで決めていないこと（親が決める）
// - userName を記録に複写した user_name から取るか、profiles の今の表示名から取るか（外された人の扱い）。
//   ここでは、どちらでも同じになるよう profiles の表示名と user_name をそろえた記録だけを使う

const SUMMER_ID = "2026-summer";
const AUTUMN_ID = "2025-autumn";

/**
 * 偽物のサーバーに人と記録を入れる。行は並び順に頼れないよう、わざと順不同に入れる
 * - 2026夏イベ：5 件（10/15 22:52 あかね E3、10/15 22:40 あかね E2、同じ 22:40 に提督の公開〔id が大きい〕、10/14 22:18 協力者B E3、
 *   08/04 19:55 あかね E1）
 * - 2025秋イベ：1 件（出さない）
 */
function seed(fake: FakeSupabase): void {
  fake.server.profiles.push(
    profileRow({ user_id: "user-akane", display_name: "あかね", role: "collab" }),
    profileRow({ user_id: "user-admiral", display_name: "提督", role: "admin" }),
    profileRow({ user_id: "user-b", display_name: "協力者B", role: "collab" }),
  );
  fake.server.saveLogs.push(
    saveLogRow({
      id: 9,
      event_id: SUMMER_ID,
      user_id: "user-b",
      user_name: "協力者B",
      kind: "save",
      map_label: "E3",
      summary: "E3 ゲージ3 の札を「ウルシー攻撃部隊」→「第六艦隊」",
      created_at: "2026-10-14T13:18:00.250000+00:00",
    }),
    saveLogRow({
      id: 12,
      event_id: SUMMER_ID,
      user_id: "user-akane",
      user_name: "あかね",
      kind: "save",
      map_label: "E3",
      summary: "E3 ゲージ4 の特効を追加（第二十七駆逐隊 ×1.20）",
      created_at: "2026-10-15T13:52:00.123456+00:00",
    }),
    saveLogRow({
      id: 3,
      event_id: SUMMER_ID,
      user_id: "user-akane",
      user_name: "あかね",
      kind: "save",
      map_label: "E1",
      summary: "E1〜E3 の札と段階を作成",
      created_at: "2026-08-04T10:55:00+00:00",
    }),
    saveLogRow({
      id: 10,
      event_id: SUMMER_ID,
      user_id: "user-akane",
      user_name: "あかね",
      kind: "save",
      map_label: "E2",
      summary: "E2 ゲージ3 の大事さを「難所」→「重要」",
      created_at: "2026-10-15T13:40:00.000000+00:00",
    }),
    saveLogRow({
      id: 7,
      event_id: AUTUMN_ID,
      user_id: "user-admiral",
      user_name: "提督",
      kind: "publish",
      map_label: null,
      summary: "公開（2025/11/20 版）",
      created_at: "2025-11-20T03:00:00+00:00",
    }),
    saveLogRow({
      id: 11,
      event_id: SUMMER_ID,
      user_id: "user-admiral",
      user_name: "提督",
      kind: "publish",
      map_label: null,
      summary: "公開（2026/10/15 版）",
      created_at: "2026-10-15T13:40:00.000000+00:00",
    }),
  );
}

describe("保存の記録の読み取り（loadSaveLogs）", () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = installFakeSupabase();
    stubSupabaseEnv();
    resetSupabaseClient();
    seed(fake);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("指定したイベントの記録だけを、新しい順（同じ日時なら id の大きい順）に、日本時間の日時で返す", async () => {
    // 実行
    const logs = await loadSaveLogs(SUMMER_ID);

    // 検証
    expect(logs).toEqual([
      {
        id: 12,
        createdAt: "2026-10-15T22:52:00+09:00",
        userName: "あかね",
        kind: "save",
        mapLabel: "E3",
        summary: "E3 ゲージ4 の特効を追加（第二十七駆逐隊 ×1.20）",
      },
      {
        id: 11,
        createdAt: "2026-10-15T22:40:00+09:00",
        userName: "提督",
        kind: "publish",
        mapLabel: null,
        summary: "公開（2026/10/15 版）",
      },
      {
        id: 10,
        createdAt: "2026-10-15T22:40:00+09:00",
        userName: "あかね",
        kind: "save",
        mapLabel: "E2",
        summary: "E2 ゲージ3 の大事さを「難所」→「重要」",
      },
      {
        id: 9,
        createdAt: "2026-10-14T22:18:00+09:00",
        userName: "協力者B",
        kind: "save",
        mapLabel: "E3",
        summary: "E3 ゲージ3 の札を「ウルシー攻撃部隊」→「第六艦隊」",
      },
      {
        id: 3,
        createdAt: "2026-08-04T19:55:00+09:00",
        userName: "あかね",
        kind: "save",
        mapLabel: "E1",
        summary: "E1〜E3 の札と段階を作成",
      },
    ]);
  });

  it("save_logs 表から読む（表へは書き込まず、RPC も呼ばない）", async () => {
    // 実行
    await loadSaveLogs(SUMMER_ID);

    // 検証
    expect(fake.main.from).toHaveBeenCalledWith("save_logs");
    expect(fake.main.rpc).not.toHaveBeenCalled();
  });

  it("記録がまだないイベントなら空の一覧を返す", async () => {
    // 実行
    const logs = await loadSaveLogs("2026-autumn");

    // 検証
    expect(logs).toEqual([]);
  });

  it("読み取りが通信に失敗したら、「通信に失敗しました」の理由で失敗する", async () => {
    // 準備
    fake.main.from.mockImplementation(() => failedQuery(networkFailure()));

    // 実行・検証
    await expect(loadSaveLogs(SUMMER_ID)).rejects.toThrow(/通信に失敗しました/);
  });

  it("権限がない（42501）と断られたら、「権限がありません」の理由で失敗する", async () => {
    // 準備
    fake.main.from.mockImplementation(() => failedQuery(postgrestFailure("42501", 403)));

    // 実行・検証
    await expect(loadSaveLogs(SUMMER_ID)).rejects.toThrow(/権限がありません/);
  });

  it("接続先の設定（環境変数）がなければ、「設定がありません」の理由で失敗し、クライアントを作らない", async () => {
    // 準備
    stubSupabaseEnvWithout("NEXT_PUBLIC_SUPABASE_URL");
    resetSupabaseClient();

    // 実行・検証
    await expect(loadSaveLogs(SUMMER_ID)).rejects.toThrow(/設定がありません/);
    expect(fake.createClient).not.toHaveBeenCalled();
  });

  it("記録の種類が 'save'・'publish' 以外なら、「形が正しくありません」の理由で失敗する", async () => {
    // 準備
    fake.server.saveLogs.push({
      ...saveLogRow({
        id: 20,
        event_id: SUMMER_ID,
        user_name: "あかね",
        summary: "おかしな記録",
        created_at: "2026-10-16T00:00:00+00:00",
      }),
      kind: "delete" as "save",
    });

    // 実行・検証
    await expect(loadSaveLogs(SUMMER_ID)).rejects.toThrow(/形が正しくありません/);
  });
});
