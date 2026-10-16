// 取り込みの画面（/import。src/app/import/page.tsx）のテスト
//
// 画面名（h1）・ページのタイトルと、取り込み画面の本文（src/features/import/ImportScreen）を描くことを確かめる。
// 本文の振る舞い（貼り付け・解析・保存・確認・知らせ）は ImportScreen.test.tsx で確かめる。
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportPage, { metadata } from "@/app/import/page";
import { resetLatestDefinitionCache } from "@/lib/definition";
import { resetPlanDataCache } from "@/lib/plan";
import { resetShipMasterCache } from "@/lib/ship-master";
import { stubFetch } from "@/test/definition-fetch";
import { cleanupTestStorages, openTestStorage } from "@/test/plan-storage";
import { respondWithStaticData } from "@/test/static-data-fetch";

const TITLE = "艦娘の取り込み";

describe("取り込みの画面（/import）", () => {
  beforeEach(() => {
    resetShipMasterCache();
    resetLatestDefinitionCache();
    resetPlanDataCache({ storage: openTestStorage("fudawari-import-page-test").storage });
    respondWithStaticData(stubFetch());
  });

  afterEach(async () => {
    // 部品を外してから、共有の状態を捨て、差し替えを戻し、DB を消す
    cleanup();
    resetPlanDataCache();
    resetShipMasterCache();
    resetLatestDefinitionCache();
    vi.unstubAllGlobals();
    await cleanupTestStorages();
  });

  it("見出し（h1）「艦娘の取り込み」を出す", () => {
    // 準備・実行
    render(<ImportPage />);

    // 検証
    expect(screen.getByRole("heading", { level: 1, name: TITLE })).toBeInTheDocument();
  });

  it("ページのタイトルは「艦娘の取り込み」（全体の書式で「艦娘の取り込み | 札割りプランナー」になる）", () => {
    // 検証
    expect(metadata.title).toBe(TITLE);
  });

  it("取り込み画面の本文（貼り付け欄と「取り込む」ボタン）を出し、見出し（h1）は 1 つだけ", async () => {
    // 準備・実行
    render(<ImportPage />);

    // 検証
    expect(await screen.findByRole("textbox", { name: "艦娘の情報を貼り付け" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取り込む" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("中身の準備中の表示（ScreenPlaceholder）は出さない", async () => {
    // 準備・実行
    render(<ImportPage />);

    // 検証：本文が出たことを確かめてから、準備中の表示がないことを見る
    await waitFor(() => expect(screen.getByRole("button", { name: "取り込む" })).toBeInTheDocument());
    expect(screen.queryByText(/準備中/)).not.toBeInTheDocument();
  });
});
