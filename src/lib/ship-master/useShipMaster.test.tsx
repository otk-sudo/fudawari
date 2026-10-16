// 艦船マスタのフック（useShipMaster）のテスト
//
// useLatestDefinition（src/lib/definition）と同じ作り：取得は 1 回にまとめ、状態を部品の間で共有する。
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupShip } from "@/domain/master";
import { resetShipMasterCache, useShipMaster } from "@/lib/ship-master";
import {
  type FetchMock,
  holdFetch,
  requestedPaths,
  stubFetch,
  textResponse,
} from "@/test/definition-fetch";
import { respondWithShipMaster, shipMasterFileOf } from "@/test/ship-master-fetch";

// フックの状態を文字で出す部品（複数の部品から同時に使う場面を作るため）。成功なら艦 ID 961 の艦名を出す
function ShipNameProbe({ label }: { label: string }): ReactNode {
  const state = useShipMaster();
  const text = state.status === "success" ? lookupShip(state.master, 961).name : state.status;
  return <p>{`${label}：${text}`}</p>;
}

describe("艦船マスタのフック（useShipMaster）", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    // 共有の読み込みの状態はモジュールに残るため、テストごとに初期に戻す
    resetShipMasterCache();
    fetchMock = stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetShipMasterCache();
  });

  describe("状態の移り変わり", () => {
    it("最初は読み込み中で、取得と確認が済むと成功（艦 ID から引ける索引つき）になる", async () => {
      // 準備
      const held = holdFetch(fetchMock);

      // 実行：応答を返す前
      const { result } = renderHook(() => useShipMaster());

      // 検証：読み込み中
      expect(result.current).toEqual({ status: "loading" });

      // 実行：応答を返す
      held.respond(() => textResponse(JSON.stringify(shipMasterFileOf())));

      // 検証：成功になり、艦 ID から艦の情報を引ける
      await waitFor(() => expect(result.current.status).toBe("success"));
      if (result.current.status === "success") {
        expect(lookupShip(result.current.master, 961)).toMatchObject({ known: true, name: "時雨改三" });
      }
    });

    it("艦船マスタの置き場所（/data/ship-master.json）だけを取得する", async () => {
      // 準備
      respondWithShipMaster(fetchMock);

      // 実行
      const { result } = renderHook(() => useShipMaster());

      // 検証
      await waitFor(() => expect(result.current.status).toBe("success"));
      expect(requestedPaths(fetchMock)).toEqual(["/data/ship-master.json"]);
    });

    it("読み込み中から、404 なら失敗（取得の失敗の理由つき）になる", async () => {
      // 準備
      const held = holdFetch(fetchMock);
      const { result } = renderHook(() => useShipMaster());
      expect(result.current).toEqual({ status: "loading" });

      // 実行
      held.respond(() => new Response("Not Found", { status: 404 }));

      // 検証
      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current).toMatchObject({
        status: "error",
        error: { kind: "fetch", status: 404, message: expect.stringContaining("404") },
      });
    });

    it("読み込み中から、通信の失敗なら失敗（状態コード null の取得の失敗）になる", async () => {
      // 準備
      const held = holdFetch(fetchMock);
      const { result } = renderHook(() => useShipMaster());
      expect(result.current).toEqual({ status: "loading" });

      // 実行
      held.fail(new TypeError("Failed to fetch"));

      // 検証
      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current).toMatchObject({
        status: "error",
        error: { kind: "fetch", status: null },
      });
    });

    it("読み込み中から、形の違うファイル（schemaVersion 2）なら失敗（形の誤りの理由つき）になる", async () => {
      // 準備
      const held = holdFetch(fetchMock);
      const { result } = renderHook(() => useShipMaster());
      expect(result.current).toEqual({ status: "loading" });

      // 実行
      held.respond(() => textResponse(JSON.stringify({ ...shipMasterFileOf(), schemaVersion: 2 })));

      // 検証
      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current).toMatchObject({
        status: "error",
        error: { kind: "invalid", reason: "unsupported_version" },
      });
    });
  });

  describe("取得は 1 回にまとめる", () => {
    it("同じ画面で 3 つの部品が同時に使っても、取得は 1 回で、全員が同じマスタを受け取る（StrictMode でも）", async () => {
      // 準備
      respondWithShipMaster(fetchMock);

      // 実行
      render(
        <StrictMode>
          <ShipNameProbe label="控え" />
          <ShipNameProbe label="札の列" />
          <ShipNameProbe label="右側" />
        </StrictMode>,
      );

      // 検証
      expect(await screen.findByText("控え：時雨改三")).toBeInTheDocument();
      expect(await screen.findByText("札の列：時雨改三")).toBeInTheDocument();
      expect(await screen.findByText("右側：時雨改三")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("読み込みが済んだ後から使い始めた部品にも、取り直さずに同じマスタを返す", async () => {
      // 準備：先に 1 つ目の部品で読み込みを済ませる
      respondWithShipMaster(fetchMock);
      const { rerender } = render(<ShipNameProbe label="先" />);
      expect(await screen.findByText("先：時雨改三")).toBeInTheDocument();

      // 実行：2 つ目の部品を足す
      rerender(
        <>
          <ShipNameProbe label="先" />
          <ShipNameProbe label="後" />
        </>,
      );

      // 検証
      expect(await screen.findByText("後：時雨改三")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("resetShipMasterCache の後に使うと、取り直す（テストの前準備が効くことの確認）", async () => {
      // 準備：1 回読み込む
      respondWithShipMaster(fetchMock);
      const first = render(<ShipNameProbe label="1 回目" />);
      expect(await screen.findByText("1 回目：時雨改三")).toBeInTheDocument();
      first.unmount();

      // 実行
      resetShipMasterCache();
      render(<ShipNameProbe label="2 回目" />);

      // 検証
      expect(await screen.findByText("2 回目：時雨改三")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
