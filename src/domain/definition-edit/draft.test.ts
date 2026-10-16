// 共有の下書きの検証（PR-09 のレビュー指摘：新規作成の直後などの、空のイベント名・開始日時・版の日付を通す）のテスト
//
// - イベント名・開始日時・版の日付の空文字だけを通し、それ以外は公開用の検証（validatePublicDefinition）と同じ規則で弾く
// - 結果の形は公開用の検証と同じ（{ ok: true, value } ／ { ok: false, errors }。errors は code・path・message）
// 公開の入口（@/domain/definition-edit）から読み込んで、公開されていることも確かめる。
import { describe, expect, it } from "vitest";
import type { DefinitionError, DefinitionValidationResult, EventInfo } from "@/domain/definition";
import { validatePublicDefinition } from "@/domain/definition";
import { createDefinition, type DefinitionDoc, validateDraftDefinition } from "@/domain/definition-edit";
import { type Mutable, summer2026Definition } from "@/test/fixtures";
import { editDoc, fudaOf, groupOf, stageOf } from "./test-helpers";

const def = summer2026Definition;

/** 新規作成の直後（元にするイベントなし）の文書：イベント名・開始日時・版の日付が空、E1 だけ、札も段階もない */
const emptyDraft = createDefinition({ eventId: "2026-autumn" });

/** 新規作成の直後（2026夏イベを元にした）の文書：イベント名・開始日時・版の日付が空、札と段階がある */
const draftFromBase = createDefinition({ eventId: "2026-autumn", base: def });

/** テストの準備：テスト用データのイベントの情報だけを変えた文書 */
function withEvent(fields: Partial<Mutable<EventInfo>>): DefinitionDoc {
  return editDoc(def, (d) => {
    Object.assign(d.event, fields);
  });
}

/** 検証が通ったことを確かめて、値を返す */
function expectValid(result: DefinitionValidationResult): DefinitionDoc {
  if (!result.ok) {
    throw new Error(`通るはずが弾かれました：${result.errors.map((e) => `${e.path} ${e.code}`).join("、")}`);
  }
  return result.value;
}

/** 弾かれたことを確かめて、エラーを [path, code] の組で返す */
function errorPairs(result: DefinitionValidationResult): [string, string][] {
  if (result.ok) throw new Error("弾かれるはずが通りました");
  return result.errors.map((e) => [e.path, e.code]);
}

/** 下書きでだけ通す欄（イベント名・開始日時・版の日付）のエラーを除く */
function withoutRelaxedFields(errors: readonly DefinitionError[]): DefinitionError[] {
  const relaxed = new Set(["event.name", "event.startAt", "event.versionDate"]);
  return errors.filter((e) => !relaxed.has(e.path));
}

describe("validateDraftDefinition（共有の下書きの検証）", () => {
  describe("空のイベント名・開始日時・版の日付は通す", () => {
    it("新規作成の直後（元にするイベントなし：E1 だけ、札も段階もない）の文書は通る", () => {
      const value = expectValid(validateDraftDefinition(emptyDraft));

      expect(value).toEqual(emptyDraft);
    });

    it("新規作成の直後（元にするイベントあり）の文書は通る", () => {
      const value = expectValid(validateDraftDefinition(draftFromBase));

      expect(value).toEqual(draftFromBase);
      expect(value.event).toMatchObject({ name: "", startAt: "", versionDate: "" });
    });

    it("イベント名・開始日時・版の日付のどれか 1 つだけが空でも通る", () => {
      expectValid(validateDraftDefinition(withEvent({ name: "" })));
      expectValid(validateDraftDefinition(withEvent({ startAt: "" })));
      expectValid(validateDraftDefinition(withEvent({ versionDate: "" })));
    });

    it("開始日時が空のときは、終了日時の前後を比べない（終了日時が正しい形式なら通る）", () => {
      const doc = withEvent({ startAt: "", endAt: "2026-10-20T11:00+09:00" });

      expect(expectValid(validateDraftDefinition(doc)).event.endAt).toBe("2026-10-20T11:00+09:00");
    });

    it("公開できる文書（テスト用データ）は、下書きとしても通る", () => {
      expect(expectValid(validateDraftDefinition(def))).toEqual(def);
    });
  });

  describe("空でない値・ほかの欄は公開用と同じ規則で弾く", () => {
    it("イベント名・開始日時・版の日付の項目そのものがなければ missing_field（空文字だけを通す）", () => {
      const missingName = editDoc(def, (d) => {
        delete (d.event as Partial<Mutable<EventInfo>>).name;
      });

      expect(errorPairs(validateDraftDefinition(missingName))).toEqual([["event.name", "missing_field"]]);
    });

    it("空でない開始日時の形式違い・時差のない値は invalid_value", () => {
      const slash = withEvent({ startAt: "2026/11/20 12:00" });
      const noOffset = withEvent({ startAt: "2026-11-20T12:00" });

      expect(errorPairs(validateDraftDefinition(slash))).toEqual([["event.startAt", "invalid_value"]]);
      expect(errorPairs(validateDraftDefinition(noOffset))).toEqual([["event.startAt", "invalid_value"]]);
    });

    it("空でない版の日付が実在しなければ invalid_value", () => {
      const doc = withEvent({ versionDate: "2026-02-30" });

      expect(errorPairs(validateDraftDefinition(doc))).toEqual([["event.versionDate", "invalid_value"]]);
    });

    it("イベント ID の空は通さない（invalid_value）", () => {
      const doc = withEvent({ id: "" });

      expect(errorPairs(validateDraftDefinition(doc))).toEqual([["event.id", "invalid_value"]]);
    });

    it("終了日時の空文字は通さない（未定は null。updateEvent が空文字を null にそろえる）", () => {
      const doc = withEvent({ endAt: "" });

      expect(errorPairs(validateDraftDefinition(doc))).toEqual([["event.endAt", "invalid_value"]]);
    });

    it("終了日時が開始日時以前なら invalid_value（両方入っているとき）", () => {
      const doc = withEvent({ endAt: "2026-08-01T12:00+09:00" });

      expect(errorPairs(validateDraftDefinition(doc))).toEqual([["event.endAt", "invalid_value"]]);
    });

    it("オブジェクトでなければ invalid_type（path は空）", () => {
      expect(errorPairs(validateDraftDefinition(null))).toEqual([["", "invalid_type"]]);
      expect(errorPairs(validateDraftDefinition("下書き"))).toEqual([["", "invalid_type"]]);
    });

    it("参照・重複・倍率・札番号・空の名前の誤りは、公開用の検証と同じエラー（code・path・message）を返す", () => {
      const broken = editDoc(def, (d) => {
        stageOf(d, "E2-3").fudaId = "no-such-fuda";
        stageOf(d, "E3-4").id = "E3-3";
        groupOf(d, "E2-2-B").multiplier = 0.5;
        fudaOf(d, "tago").gameNumber = 1;
        fudaOf(d, "rengo").name = "";
        stageOf(d, "E1-1").name = "";
      });

      const draft = validateDraftDefinition(broken);
      const pub = validatePublicDefinition(broken);

      expect(draft.ok).toBe(false);
      expect(pub.ok).toBe(false);
      if (draft.ok || pub.ok) return;
      expect(draft.errors).toEqual(pub.errors);
      expect(draft.errors.map((e) => e.code)).toEqual(
        expect.arrayContaining(["unknown_reference", "duplicate_id", "invalid_value", "duplicate_value"]),
      );
    });

    it("イベント名・開始日時・版の日付が空の下書きでも、ほかの誤りは公開用と同じエラーを返す", () => {
      const broken = editDoc(draftFromBase, (d) => {
        stageOf(d, "E2-3").fudaId = "no-such-fuda";
        fudaOf(d, "s31").color = "blue";
      });

      const draft = validateDraftDefinition(broken);
      const pub = validatePublicDefinition(broken);

      expect(draft.ok).toBe(false);
      expect(pub.ok).toBe(false);
      if (draft.ok || pub.ok) return;
      expect(draft.errors).toEqual(withoutRelaxedFields(pub.errors));
      expect(draft.errors.map((e) => e.path)).toEqual(["fudas[0].color", "stages[4].fudaId"]);
    });
  });
});
