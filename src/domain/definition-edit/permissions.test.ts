// 権限ごとの定義の編集の可否（要件 2.3、U18、roadmap T3-6）のテスト
import { describe, expect, it } from "vitest";
import type { EventInfo } from "@/domain/definition/types";
import { summer2026Definition } from "@/test/fixtures";
import { checkUpdatePermission, editPermissions } from "./permissions";
import type { EditPermissions } from "./types";

const NOW = new Date("2026-10-15T23:42:00+09:00");
const FUTURE_END = "2026-10-20T11:00+09:00";
const PAST_END = "2026-10-10T11:00+09:00";

/** 保存済みのイベント（開催中。終了日時は未来） */
const savedEvent: EventInfo = { ...summer2026Definition.event, endAt: FUTURE_END };

const NOTHING: EditPermissions = {
  canOpen: false,
  canEditContent: false,
  canPublish: false,
  canEditName: false,
  canEditStartAt: false,
  canEditEndAt: false,
  canCreate: false,
  ended: false,
};

describe("editPermissions（権限ごとに、定義画面で何ができるか）", () => {
  it("一般利用者は定義画面を開けず、何もできない", () => {
    expect(editPermissions({ role: "user", mode: "update", savedEndAt: FUTURE_END, now: NOW })).toEqual(NOTHING);
  });

  it("協力者：最新イベントの札・段階・特効の編集、下書きの保存、公開、終了日時の変更ができる。名前・開始日時・新規作成はできない", () => {
    expect(editPermissions({ role: "collab", mode: "update", savedEndAt: FUTURE_END, now: NOW })).toEqual({
      canOpen: true,
      canEditContent: true,
      canPublish: true,
      canEditName: false,
      canEditStartAt: false,
      canEditEndAt: true,
      canCreate: false,
      ended: false,
    });
  });

  it("管理者：すべてできる", () => {
    expect(editPermissions({ role: "admin", mode: "update", savedEndAt: FUTURE_END, now: NOW })).toEqual({
      canOpen: true,
      canEditContent: true,
      canPublish: true,
      canEditName: true,
      canEditStartAt: true,
      canEditEndAt: true,
      canCreate: true,
      ended: false,
    });
  });

  it("終了日時が未定なら終了していない", () => {
    const p = editPermissions({ role: "collab", mode: "update", savedEndAt: null, now: NOW });

    expect(p).toMatchObject({ ended: false, canEditContent: true });
  });

  it("終了したイベント：協力者は見るだけで、新規作成もできない", () => {
    expect(editPermissions({ role: "collab", mode: "update", savedEndAt: PAST_END, now: NOW })).toEqual({
      ...NOTHING,
      canOpen: true,
      ended: true,
    });
  });

  it("終了したイベント：管理者も更新できず見るだけ。新規作成はできる", () => {
    expect(editPermissions({ role: "admin", mode: "update", savedEndAt: PAST_END, now: NOW })).toEqual({
      ...NOTHING,
      canOpen: true,
      canCreate: true,
      ended: true,
    });
  });

  it("新規作成：管理者はすべての欄を編集・公開できる（前のイベントの終了日時は関係しない）", () => {
    expect(editPermissions({ role: "admin", mode: "create", savedEndAt: PAST_END, now: NOW })).toEqual({
      canOpen: true,
      canEditContent: true,
      canPublish: true,
      canEditName: true,
      canEditStartAt: true,
      canEditEndAt: true,
      canCreate: true,
      ended: false,
    });
  });

  it("新規作成：協力者は編集も公開もできない", () => {
    const p = editPermissions({ role: "collab", mode: "create", savedEndAt: null, now: NOW });

    expect(p).toMatchObject({
      canEditContent: false,
      canPublish: false,
      canEditName: false,
      canEditStartAt: false,
      canEditEndAt: false,
      canCreate: false,
    });
  });
});

describe("checkUpdatePermission（最新イベントの更新を保存してよいか）", () => {
  it("協力者は終了日時を変えられる", () => {
    const next = { ...savedEvent, endAt: "2026-10-25T11:00+09:00" };

    expect(checkUpdatePermission({ role: "collab", saved: savedEvent, next, now: NOW })).toEqual({ ok: true });
  });

  it("協力者は終了日時を消せる（未定に戻す）", () => {
    const next = { ...savedEvent, endAt: null };

    expect(checkUpdatePermission({ role: "collab", saved: savedEvent, next, now: NOW })).toEqual({ ok: true });
  });

  it("協力者はイベント名を変えられない（forbidden_field）", () => {
    const result = checkUpdatePermission({
      role: "collab",
      saved: savedEvent,
      next: { ...savedEvent, name: "2026夏イベ（後段）" },
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, code: "forbidden_field", fields: ["name"] });
  });

  it("協力者は開始日時を変えられない（forbidden_field）", () => {
    const result = checkUpdatePermission({
      role: "collab",
      saved: savedEvent,
      next: { ...savedEvent, startAt: "2026-08-08T12:00:00+09:00" },
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, code: "forbidden_field", fields: ["startAt"] });
  });

  it("協力者がイベント名と開始日時の両方を変えたら、両方を返す", () => {
    const result = checkUpdatePermission({
      role: "collab",
      saved: savedEvent,
      next: { ...savedEvent, name: "改名", startAt: "2026-08-08T12:00:00+09:00" },
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.code !== "forbidden_field") throw new Error("forbidden_field のはず");
    expect([...result.fields].sort()).toEqual(["name", "startAt"]);
    expect(result.message.trim()).not.toBe("");
  });

  it("開始日時は時刻で比べる（秒の有無など書き方の違いだけなら変更とみなさない）", () => {
    // 保存済みは "2026-08-07T12:00:00+09:00"
    const next = { ...savedEvent, startAt: "2026-08-07T12:00+09:00" };

    expect(checkUpdatePermission({ role: "collab", saved: savedEvent, next, now: NOW })).toEqual({ ok: true });
  });

  it("管理者はイベント名・開始日時・終了日時を変えられる", () => {
    const next = { ...savedEvent, name: "改名", startAt: "2026-08-08T12:00+09:00", endAt: "2026-10-25T11:00+09:00" };

    expect(checkUpdatePermission({ role: "admin", saved: savedEvent, next, now: NOW })).toEqual({ ok: true });
  });

  it("一般利用者は保存できない（forbidden_role）", () => {
    const result = checkUpdatePermission({ role: "user", saved: savedEvent, next: savedEvent, now: NOW });

    expect(result).toMatchObject({ ok: false, code: "forbidden_role" });
  });

  it("保存済みの終了日時を過ぎたイベントは、管理者も協力者も更新できない（event_ended）", () => {
    const ended = { ...savedEvent, endAt: PAST_END };
    // 延長しようとして未来の終了日時を入れても、保存済みの値で判定する（U18：延長は管理者が DB で直す）
    const next = { ...ended, endAt: FUTURE_END };

    for (const role of ["admin", "collab"] as const) {
      expect(checkUpdatePermission({ role, saved: ended, next, now: NOW })).toMatchObject({
        ok: false,
        code: "event_ended",
      });
    }
  });

  it("終了の判定は保存済みの終了日時で行う（編集中の終了日時が過去でも、ここでは止めない）", () => {
    const next = { ...savedEvent, endAt: PAST_END };

    expect(checkUpdatePermission({ role: "admin", saved: savedEvent, next, now: NOW })).toEqual({ ok: true });
  });

  it("開始前でも、最新のイベントなら協力者は更新できる（U18）", () => {
    const notStarted = { ...savedEvent, startAt: "2026-11-20T12:00+09:00", endAt: null };
    const next = { ...notStarted, endAt: "2026-12-26T11:00+09:00" };

    expect(checkUpdatePermission({ role: "collab", saved: notStarted, next, now: NOW })).toEqual({ ok: true });
  });
});
