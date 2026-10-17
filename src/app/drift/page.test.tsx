// 差分のページ（/drift。要件 3.5、roadmap T2-11）のテスト
//
// 中身の表示と操作は src/features/drift/DriftPageContent.test.tsx で確かめる。ここではページがその中身
// （DriftPageContent）を使っていることだけを見る。ヘッダーの最新イベント名と公開定義の読み込みの失敗の表示は
// src/app/screen-headers.test.tsx で確かめている（取り込んでいない保存先なので、艦船マスタは取得しない前提）。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DriftPage from "@/app/drift/page";
import { resetLatestDefinitionCache } from "@/lib/definition";
import { resetPlanDataCache } from "@/lib/plan";
import { resetShipMasterCache } from "@/lib/ship-master";
import type { FudawariStorage } from "@/lib/storage";
import { stubFetch } from "@/test/definition-fetch";
import { getIssueCard, summaryCount } from "@/test/drift-screen";
import { summer2026Assignments, summer2026Definition, summer2026Ships } from "@/test/fixtures";
import { respondWithLatestData } from "@/test/latest-data-fetch";
import { cleanupTestStorages, importInput, openTestStorage } from "@/test/plan-storage";

/** 最新イベントの ID（"2026-summer"） */
const EVENT_ID = summer2026Definition.event.id;

/** このテストの保存先（beforeEach で開いて、共有の札割りのデータに渡す） */
let storage: FudawariStorage;

beforeEach(() => {
  resetLatestDefinitionCache();
  resetShipMasterCache();
  storage = openTestStorage("fudawari-drift-page-test").storage;
  resetPlanDataCache({ storage });
  respondWithLatestData(stubFetch());
});

afterEach(async () => {
  cleanup();
  resetLatestDefinitionCache();
  resetShipMasterCache();
  resetPlanDataCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanupTestStorages();
});

describe("差分のページ（/drift）", () => {
  it("取り込んだ艦があれば、中身（件数のまとめと対応が必要な一覧）を出す", async () => {
    // 準備：長波改二（計画 連合艦隊）に多号作戦部隊（札番号 2）の札が付いている
    const ships = summer2026Ships.map((ship) => ({ ...ship, sallyArea: ship.uid === "naganami" ? 2 : 0 }));
    await storage.saveImport(importInput(ships));
    await storage.saveAssignments(EVENT_ID, summer2026Assignments);

    // 実行
    render(<DriftPage />);

    // 検証
    expect(await screen.findByRole("list", { name: "件数のまとめ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "計画と実際の札" })).toBeInTheDocument();
    expect(summaryCount("計画と違う札が付いた")).toBe(1);
    expect(getIssueCard("長波改二")).toBeInTheDocument();
  });

  it("取り込んでいなければ「取り込んでいません」の案内を出す", async () => {
    // 準備：取り込みも割り当てもない保存先

    // 実行
    render(<DriftPage />);

    // 検証
    expect(await screen.findByText(/取り込んでいません/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "計画と実際の札" })).toBeInTheDocument();
  });
});
