// 文書の問題の検出（PR-09 のレビュー指摘：マージの結果の問題を、文書単体にも使える判定として公開する）のテスト
//
// 保存ボタンを止める判定（PR-11）と 3 方向マージの結果（src/domain/merge/）で同じ判定を使う。
// 公開の入口（@/domain/definition-edit）から読み込んで、公開されていることも確かめる。
import { describe, expect, it } from "vitest";
import { createDefinition, findDocumentIssues } from "@/domain/definition-edit";
import { summer2026Definition } from "@/test/fixtures";
import { editDoc, fudaOf } from "./test-helpers";

const def = summer2026Definition;

const MSG_END_BEFORE_START = "終了日時は開始日時より後にしてください";

/** 問題の種類だけを並べる */
function codesOf(doc: Parameters<typeof findDocumentIssues>[0]): string[] {
  return findDocumentIssues(doc).map((i) => i.code);
}

describe("findDocumentIssues（文書の問題）", () => {
  describe("問題がない", () => {
    it("テスト用データ（2026夏イベ）には問題がない（空の配列）", () => {
      expect(findDocumentIssues(def)).toEqual([]);
    });

    it("元にするイベントから新規作成した直後（名前・開始日時が空）にも問題がない", () => {
      expect(findDocumentIssues(createDefinition({ eventId: "2026-autumn", base: def }))).toEqual([]);
    });
  });

  describe("段階が 1 つもない（no_stages）", () => {
    it("段階がなければ no_stages を 1 件返す（場所は空、文は空でない）", () => {
      const noStages = editDoc(def, (d) => {
        d.stages = [];
      });

      const issues = findDocumentIssues(noStages);

      expect(issues).toEqual([{ code: "no_stages", message: expect.any(String), locations: [] }]);
      expect(issues[0]?.message.trim()).not.toBe("");
    });

    it("段階が 1 つでもあれば no_stages にしない", () => {
      const oneStage = editDoc(def, (d) => {
        d.stages = d.stages.filter((s) => s.id === "E2-3");
      });

      expect(findDocumentIssues(oneStage)).toEqual([]);
    });
  });

  describe("終了日時が開始日時以前（end_before_start）", () => {
    it("終了日時が開始日時より前なら end_before_start（場所は開始日時と終了日時）", () => {
      const doc = editDoc(def, (d) => {
        d.event.endAt = "2026-08-01T12:00+09:00";
      });

      expect(findDocumentIssues(doc)).toEqual([
        {
          code: "end_before_start",
          message: MSG_END_BEFORE_START,
          locations: [
            { kind: "event", field: "startAt" },
            { kind: "event", field: "endAt" },
          ],
        },
      ]);
    });

    it("終了日時が開始日時とちょうど同じでも end_before_start（書き方が違っても時刻で比べる）", () => {
      // 開始日時は "2026-08-07T12:00:00+09:00"
      const same = editDoc(def, (d) => {
        d.event.endAt = "2026-08-07T03:00Z";
      });

      expect(codesOf(same)).toEqual(["end_before_start"]);
    });

    it("前後は時刻で比べる（文字列で比べると逆に見える値でも正しく判定する）", () => {
      const start = "2026-11-20T12:00+09:00";
      // 2026-11-20T04:00Z は 13:00 JST なので、開始より後（問題なし）
      const after = editDoc(def, (d) => {
        d.event.startAt = start;
        d.event.endAt = "2026-11-20T04:00:00Z";
      });
      // 2026-11-20T02:00Z は 11:00 JST なので、開始より前（問題あり）
      const before = editDoc(def, (d) => {
        d.event.startAt = start;
        d.event.endAt = "2026-11-20T02:00:00Z";
      });

      expect(findDocumentIssues(after)).toEqual([]);
      expect(codesOf(before)).toEqual(["end_before_start"]);
    });

    it("終了日時が未定（null）なら比べない", () => {
      const noEnd = editDoc(def, (d) => {
        d.event.endAt = null;
      });

      expect(findDocumentIssues(noEnd)).toEqual([]);
    });

    it("開始日時が空（新規作成の途中）なら比べない", () => {
      const doc = editDoc(def, (d) => {
        d.event.startAt = "";
        d.event.endAt = "2026-08-01T12:00+09:00";
      });

      expect(findDocumentIssues(doc)).toEqual([]);
    });

    it("日時の形式違いは、ここでは問題にしない（下書き・公開の検証の役目）", () => {
      const doc = editDoc(def, (d) => {
        d.event.endAt = "あした";
      });

      expect(findDocumentIssues(doc)).toEqual([]);
    });
  });

  describe("札番号の重複（duplicate_game_number）", () => {
    it("2 つの札に同じ札番号があれば 1 件返す（場所は 2 つの札の札番号を札の並び順で。文に札の名前を入れる）", () => {
      // 多号作戦部隊（2）とウルシー攻撃部隊（4）を、どちらも 7 にする
      const doc = editDoc(def, (d) => {
        fudaOf(d, "ulithi").gameNumber = 7;
        fudaOf(d, "tago").gameNumber = 7;
      });

      const issues = findDocumentIssues(doc);

      expect(issues).toEqual([
        {
          code: "duplicate_game_number",
          message: expect.any(String),
          locations: [
            { kind: "fuda", fudaId: "tago", field: "gameNumber" },
            { kind: "fuda", fudaId: "ulithi", field: "gameNumber" },
          ],
        },
      ]);
      expect(issues[0]?.message).toContain("多号作戦部隊");
      expect(issues[0]?.message).toContain("ウルシー攻撃部隊");
    });

    it("3 つの札が同じ番号なら、1 件にまとめて場所を 3 つ返す", () => {
      const doc = editDoc(def, (d) => {
        fudaOf(d, "tago").gameNumber = 1;
        fudaOf(d, "sixth").gameNumber = 1;
      });

      expect(findDocumentIssues(doc)).toEqual([
        {
          code: "duplicate_game_number",
          message: expect.any(String),
          locations: [
            { kind: "fuda", fudaId: "s31", field: "gameNumber" },
            { kind: "fuda", fudaId: "tago", field: "gameNumber" },
            { kind: "fuda", fudaId: "sixth", field: "gameNumber" },
          ],
        },
      ]);
    });

    it("重なる番号が 2 つあれば番号ごとに 1 件ずつ、札の並び順で先に出てくる番号から返す", () => {
      // 第三十一戦隊（1）＝第六艦隊、多号作戦部隊（2）＝連合艦隊
      const doc = editDoc(def, (d) => {
        fudaOf(d, "rengo").gameNumber = 2;
        fudaOf(d, "sixth").gameNumber = 1;
      });

      const issues = findDocumentIssues(doc);

      expect(issues.map((i) => i.locations.map((l) => (l.kind === "fuda" ? l.fudaId : "")))).toEqual([
        ["s31", "sixth"],
        ["tago", "rengo"],
      ]);
      expect(issues.map((i) => i.code)).toEqual(["duplicate_game_number", "duplicate_game_number"]);
    });

    it("札番号が未入力（null）の札が複数あっても重複にしない", () => {
      const doc = editDoc(def, (d) => {
        fudaOf(d, "tago").gameNumber = null;
        fudaOf(d, "ulithi").gameNumber = null;
      });

      expect(findDocumentIssues(doc)).toEqual([]);
    });
  });

  it("問題が複数あれば、イベント → 札 → 段階 の順に返す", () => {
    const doc = editDoc(def, (d) => {
      d.stages = [];
      fudaOf(d, "sixth").gameNumber = 1;
      d.event.endAt = "2026-08-01T12:00+09:00";
    });

    expect(codesOf(doc)).toEqual(["end_before_start", "duplicate_game_number", "no_stages"]);
  });
});
