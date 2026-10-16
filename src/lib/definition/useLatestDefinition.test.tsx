import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLatestDefinitionCache, useLatestDefinition } from "@/lib/definition";
import {
  type FetchMock,
  holdFetch,
  respondWithDefinition,
  stubFetch,
  textResponse,
} from "@/test/definition-fetch";
import { cloneSummer2026Definition, summer2026Definition } from "@/test/fixtures";

// フックの状態を文字で出す部品（複数の部品から同時に使う場面を作るため）
function EventNameProbe({ label }: { label: string }): ReactNode {
  const state = useLatestDefinition();
  const text = state.status === "success" ? state.definition.event.name : state.status;
  return <p>{`${label}：${text}`}</p>;
}

describe("最新イベントの公開定義のフック（useLatestDefinition）", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    // 共有の読み込みの状態はモジュールに残るため、テストごとに初期に戻す
    resetLatestDefinitionCache();
    fetchMock = stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLatestDefinitionCache();
  });

  describe("状態の移り変わり", () => {
    it("最初は読み込み中で、取得と検証が済むと成功（定義つき）になる", async () => {
      // 準備
      const held = holdFetch(fetchMock);

      // 実行：応答を返す前
      const { result } = renderHook(() => useLatestDefinition());

      // 検証：読み込み中
      expect(result.current).toEqual({ status: "loading" });

      // 実行：応答を返す
      held.respond(() => textResponse(JSON.stringify(summer2026Definition)));

      // 検証：成功になり、検証済みの定義を受け取る
      await waitFor(() => expect(result.current.status).toBe("success"));
      expect(result.current).toEqual({ status: "success", definition: summer2026Definition });
    });

    it("読み込み中から、404 なら失敗（取得の失敗の理由つき）になる", async () => {
      // 準備
      const held = holdFetch(fetchMock);
      const { result } = renderHook(() => useLatestDefinition());
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

    it("読み込み中から、ネットワークの失敗なら失敗（状態コード null の取得の失敗）になる", async () => {
      // 準備
      const held = holdFetch(fetchMock);
      const { result } = renderHook(() => useLatestDefinition());
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

    it("読み込み中から、検証に通らない定義なら失敗（検証の失敗の理由つき）になる", async () => {
      // 準備
      const broken = cloneSummer2026Definition();
      broken.event.name = "";
      const held = holdFetch(fetchMock);
      const { result } = renderHook(() => useLatestDefinition());
      expect(result.current).toEqual({ status: "loading" });

      // 実行
      held.respond(() => textResponse(JSON.stringify(broken)));

      // 検証
      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current).toMatchObject({
        status: "error",
        error: {
          kind: "invalid",
          errors: expect.arrayContaining([
            expect.objectContaining({ code: "invalid_value", path: "event.name" }),
          ]),
        },
      });
    });
  });

  describe("取得は 1 回にまとめる", () => {
    it("同じ画面で 3 つの部品が同時に使っても、取得は 1 回で、全員が同じ定義を受け取る（StrictMode でも）", async () => {
      // 準備
      respondWithDefinition(fetchMock);

      // 実行
      render(
        <StrictMode>
          <EventNameProbe label="ヘッダー" />
          <EventNameProbe label="本文" />
          <EventNameProbe label="右側" />
        </StrictMode>,
      );

      // 検証
      expect(await screen.findByText("ヘッダー：2026夏イベ")).toBeInTheDocument();
      expect(await screen.findByText("本文：2026夏イベ")).toBeInTheDocument();
      expect(await screen.findByText("右側：2026夏イベ")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("読み込みが済んだ後から使い始めた部品にも、取り直さずに同じ定義を返す", async () => {
      // 準備：先に 1 つ目の部品で読み込みを済ませる
      respondWithDefinition(fetchMock);
      const { rerender } = render(<EventNameProbe label="先" />);
      expect(await screen.findByText("先：2026夏イベ")).toBeInTheDocument();

      // 実行：2 つ目の部品を足す
      rerender(
        <>
          <EventNameProbe label="先" />
          <EventNameProbe label="後" />
        </>,
      );

      // 検証
      expect(await screen.findByText("後：2026夏イベ")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("resetLatestDefinitionCache の後に使うと、取り直す（テストの前準備が効くことの確認）", async () => {
      // 準備：1 回読み込む
      respondWithDefinition(fetchMock);
      const first = render(<EventNameProbe label="1 回目" />);
      expect(await screen.findByText("1 回目：2026夏イベ")).toBeInTheDocument();
      first.unmount();

      // 実行
      resetLatestDefinitionCache();
      render(<EventNameProbe label="2 回目" />);

      // 検証
      expect(await screen.findByText("2 回目：2026夏イベ")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
