import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSupabaseClient } from "@/lib/supabase";
import {
  failedQuery,
  type FakeQuery,
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
import type { SaveLogEntry } from "./types";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// 保存の記録を Supabase の save_logs 表から読む（loadSaveLogs。docs/design/database.md 2.6、roadmap T3-10）
// - 指定したイベントの記録だけを、新しい順（created_at の新しい順、同じ日時なら id の大きい順）にすべて返す
// - 列の対応：id → id、created_at → createdAt（同じ時刻の日本時間の「秒の小数のない時差つき」。定義の保管庫の日時と同じ形）、
//   kind → kind（'save'・'publish'）、map_label → mapLabel（公開は null）、summary → summary、保存した人の表示名 → userName、
//   user_id → userId（PR-12b。「誰が」を ID で見分けるため。null はそのまま null）
// - PR-12b（レビュー M1・Codex #21-4301315075）：PostgREST は 1 回に返す行数に上限（max_rows。既定 1000）があるため、
//   .range(from, from + 999) を、返った件数が 1000 未満になるまでくり返して連結する（偽物は max_rows をまねないので、range の呼び方で確かめる）
// - PR-14（PR-12b のレビュー P3・PR-14 のレビュー P1）：サーバーの max_rows が 1000 より小さくても、読む間に記録が足されても全部読む。
//   続きは読む位置（offset）ではなくキーで読む：前に読んだ最後の行（created_at・id）より古いものを
//   .or("created_at.lt.X,and(created_at.eq.X,id.lt.Y)") で取り、0 件が返ったら終える（偽物の or は src/test/postgrest-or.ts）。
//   そのため、読む位置（range の呼び方）を確かめていたテストは、読み取りの回数（余分な読み取りは 1 回まで）と結果で確かめる形に変えた。
//   max_rows のまねは、偽物の読み取りの limit を抑えて作る（capSaveLogRows）
//
// PR-12b で変えたこと：最初のテストの期待値に userId を足した（記録に利用者の ID を持たせる仕様にしたため）
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
        userId: "user-akane",
        userName: "あかね",
        kind: "save",
        mapLabel: "E3",
        summary: "E3 ゲージ4 の特効を追加（第二十七駆逐隊 ×1.20）",
      },
      {
        id: 11,
        createdAt: "2026-10-15T22:40:00+09:00",
        userId: "user-admiral",
        userName: "提督",
        kind: "publish",
        mapLabel: null,
        summary: "公開（2026/10/15 版）",
      },
      {
        id: 10,
        createdAt: "2026-10-15T22:40:00+09:00",
        userId: "user-akane",
        userName: "あかね",
        kind: "save",
        mapLabel: "E2",
        summary: "E2 ゲージ3 の大事さを「難所」→「重要」",
      },
      {
        id: 9,
        createdAt: "2026-10-14T22:18:00+09:00",
        userId: "user-b",
        userName: "協力者B",
        kind: "save",
        mapLabel: "E3",
        summary: "E3 ゲージ3 の札を「ウルシー攻撃部隊」→「第六艦隊」",
      },
      {
        id: 3,
        createdAt: "2026-08-04T19:55:00+09:00",
        userId: "user-akane",
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

  it("user_id が null の記録（古い記録など）は userId を null にする", async () => {
    // 準備
    fake.server.saveLogs.push(
      saveLogRow({
        id: 30,
        event_id: "2026-winter",
        user_id: null,
        user_name: "旧協力者",
        summary: "E1 の段階を追加",
        created_at: "2026-10-16T00:00:00+00:00",
      }),
    );

    // 実行
    const logs = await loadSaveLogs("2026-winter");

    // 検証
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ id: 30, userId: null, userName: "旧協力者" });
  });

  describe("1000 件を超える記録も全部読む（PR-12b：レビュー M1・Codex #21-4301315075）", () => {
    const MANY_ID = "2026-many";

    /** MANY_ID の記録を n 件入れる（id は 1〜n。id が大きいほど新しい。並び順に頼れないよう逆順に入れる） */
    function seedMany(n: number): void {
      for (let id = n; id >= 1; id -= 1) {
        const seconds = String(id % 60).padStart(2, "0");
        const minutes = String(Math.floor(id / 60) % 60).padStart(2, "0");
        const hours = String(Math.floor(id / 3600)).padStart(2, "0");
        fake.server.saveLogs.push(
          saveLogRow({
            id,
            event_id: MANY_ID,
            user_id: "user-akane",
            user_name: "あかね",
            summary: `記録 ${String(id)}`,
            created_at: `2026-10-01T${hours}:${minutes}:${seconds}+00:00`,
          }),
        );
      }
    }

    /** save_logs の読み取りの回数（from("save_logs") を呼んだ回数） */
    function saveLogReads(): number {
      return fake.main.from.mock.calls.filter(([table]) => table === "save_logs").length;
    }

    /**
     * MANY_ID の記録を n 件入れる。id は 1〜n（id が大きいほど新しい）で、created_at は 7 件ずつ同じ時刻にする
     * （1000 件目などのページの境目が、同じ時刻の記録の途中に来るようにする。並び順に頼れないよう逆順に入れる）
     */
    function seedManyWithTies(n: number): void {
      for (let id = n; id >= 1; id -= 1) {
        const second = Math.floor(id / 7);
        const seconds = String(second % 60).padStart(2, "0");
        const minutes = String(Math.floor(second / 60) % 60).padStart(2, "0");
        const hours = String(Math.floor(second / 3600)).padStart(2, "0");
        fake.server.saveLogs.push(
          saveLogRow({
            id,
            event_id: MANY_ID,
            user_id: "user-akane",
            user_name: "あかね",
            summary: `記録 ${String(id)}`,
            created_at: `2026-10-01T${hours}:${minutes}:${seconds}+00:00`,
          }),
        );
      }
    }

    /**
     * save_logs の読み取りが 1 回に max 件までしか返さないようにする（サーバーの max_rows のまね）。
     * 読み取りの limit を max に抑える（実装が limit で頼んでも range で頼んでも、max 件を超えて返さない）
     */
    function capSaveLogRows(max: number): void {
      const original = fake.main.from.getMockImplementation();
      if (original === undefined) throw new Error("偽物の from に返し方がありません");
      fake.main.from.mockImplementation((table: string): FakeQuery => {
        const query = original(table);
        if (table !== "save_logs") return query;
        const limit = query.limit.bind(query);
        limit(max);
        query.limit = (count: number) => limit(Math.min(count, max));
        return query;
      });
    }

    /** 新しい順（created_at の新しい順、同じ時刻なら id の大きい順）に並んでいるか */
    function expectNewestFirst(logs: readonly SaveLogEntry[]): void {
      for (let index = 1; index < logs.length; index += 1) {
        const previous = logs[index - 1];
        const current = logs[index];
        if (previous === undefined || current === undefined) continue;
        const order = Date.parse(previous.createdAt) - Date.parse(current.createdAt) || previous.id - current.id;
        expect(order, `${String(index)} 件目の並び`).toBeGreaterThan(0);
      }
    }

    it("2345 件なら、新しい順に連結して 2345 件を返す（読み取りは 3〜4 回。0 件が返るまで読む形でも、余分な読み取りは 1 回まで）", async () => {
      // 準備
      seedMany(2345);

      // 実行
      const logs = await loadSaveLogs(MANY_ID);

      // 検証（PR-14 で、読む位置〔range〕ではなく回数と結果で確かめる形に変えた）
      expect(logs).toHaveLength(2345);
      expect(logs.map((log) => log.id)).toEqual(Array.from({ length: 2345 }, (_, index) => 2345 - index));
      expect(saveLogReads()).toBeGreaterThanOrEqual(3);
      expect(saveLogReads()).toBeLessThanOrEqual(4);
    });

    it("ちょうど 1000 件なら、2 回目が 0 件で終わり、1000 件を返す（境界）", async () => {
      // 準備
      seedMany(1000);

      // 実行
      const logs = await loadSaveLogs(MANY_ID);

      // 検証
      expect(saveLogReads()).toBe(2);
      expect(logs).toHaveLength(1000);
      expect(logs[0]?.id).toBe(1000);
      expect(logs.at(-1)?.id).toBe(1);
    });

    it("999 件なら 999 件を返し、読み取りは 2 回まで（999 件で終える形でも、0 件が返るまで読む形でもよい。境界）", async () => {
      // 準備
      seedMany(999);

      // 実行
      const logs = await loadSaveLogs(MANY_ID);

      // 検証
      expect(logs).toHaveLength(999);
      expect(saveLogReads()).toBeGreaterThanOrEqual(1);
      expect(saveLogReads()).toBeLessThanOrEqual(2);
    });

    it("サーバーの max_rows が 500 でも、0 件になるまで続きを読み、1234 件を新しい順にすべて返す（PR-14：PR-12b のレビュー P3）", async () => {
      // 準備：save_logs の読み取りは 1 回に 500 件までしか返さない（max_rows のまね）
      seedMany(1234);
      capSaveLogRows(500);

      // 実行
      const logs = await loadSaveLogs(MANY_ID);

      // 検証：抜けも重なりもなく全部読む
      expect(logs.map((log) => log.id)).toEqual(Array.from({ length: 1234 }, (_, index) => 1234 - index));
    });

    it("同じ時刻の記録がページの境目をまたいでも（max_rows 500・7 件ずつ同じ時刻）、抜けも重なりもなく 2345 件を新しい順に返す（PR-14：レビュー P1）", async () => {
      // 準備
      seedManyWithTies(2345);
      capSaveLogRows(500);

      // 実行
      const logs = await loadSaveLogs(MANY_ID);

      // 検証
      expect(logs.map((log) => log.id)).toEqual(Array.from({ length: 2345 }, (_, index) => 2345 - index));
      expectNewestFirst(logs);
    });

    it("読んでいる間に max_rows（1000）以上の新しい記録が足されても、読み始めにあった記録を欠かさず、重ねずに新しい順で返す（PR-14：レビュー P1）", async () => {
      // 準備：2345 件。2 回目の save_logs の読み取りの前に、より新しい記録を 1000 件足す
      seedManyWithTies(2345);
      const original = fake.main.from.getMockImplementation();
      if (original === undefined) throw new Error("偽物の from に返し方がありません");
      let reads = 0;
      fake.main.from.mockImplementation((table: string): FakeQuery => {
        if (table === "save_logs") {
          reads += 1;
          if (reads === 2) {
            for (let id = 3001; id <= 4000; id += 1) {
              fake.server.saveLogs.push(
                saveLogRow({
                  id,
                  event_id: MANY_ID,
                  user_id: "user-akane",
                  user_name: "あかね",
                  summary: `足した記録 ${String(id)}`,
                  created_at: `2026-10-02T00:00:${String(id % 60).padStart(2, "0")}+00:00`,
                }),
              );
            }
          }
        }
        return original(table);
      });

      // 実行
      const logs = await loadSaveLogs(MANY_ID);

      // 検証：読み始めにあった 2345 件がすべて 1 回ずつある。重なりはなく、新しい順（足した記録は入っても入らなくてもよい）
      const ids = logs.map((log) => log.id);
      expect(new Set(ids).size, "重なり").toBe(ids.length);
      const original2345 = ids.filter((id) => id <= 2345);
      expect(original2345).toEqual(Array.from({ length: 2345 }, (_, index) => 2345 - index));
      expectNewestFirst(logs);
    });

    it("2 回目の読み取りが通信に失敗したら、途中までの記録を返さず「通信に失敗しました」の理由で失敗する", async () => {
      // 準備：1 回目はふだんどおり、2 回目の save_logs の読み取りだけ失敗する
      seedMany(1500);
      const original = fake.main.from.getMockImplementation();
      if (original === undefined) throw new Error("偽物の from に返し方がありません");
      let saveLogReads = 0;
      fake.main.from.mockImplementation((table: string): FakeQuery => {
        if (table !== "save_logs") return original(table);
        saveLogReads += 1;
        return saveLogReads === 2 ? failedQuery(networkFailure()) : original(table);
      });

      // 実行・検証
      await expect(loadSaveLogs(MANY_ID)).rejects.toThrow(/通信に失敗しました/);
      expect(saveLogReads).toBe(2);
    });
  });
});
