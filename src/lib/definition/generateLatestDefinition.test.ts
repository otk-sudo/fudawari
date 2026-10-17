// ビルド時の最新イベントの公開定義の取得（roadmap T3-11、docs/design/database.md 6 章、PR-13a）のテスト
// 取得（fetch）・書き出し（writeFile）・削除（removeFile）を差し替えて、Supabase の REST（PostgREST）の読み方、
// 書き出し、まだ公開されたイベントがないとき、失敗時の振る舞いを確かめる（通信もファイルの操作もしない）
//
// - 取得の差し替えは、URL の表の名前（app_state／published_definitions）ごとに、呼ばれるたびの結果を順に返す
// - 取得の失敗は再試行する（既定 3 回・待ち 2000 ミリ秒）。待ち時間を確かめるテスト以外は retryDelayMs: 0 を渡して待たない
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePublicDefinition, validatePublicDefinition } from "@/domain/definition";
import { cloneSummer2026Definition } from "@/test/fixtures";
import {
  type FetchResponseLike,
  type GenerateLatestDefinitionDeps,
  generateLatestDefinition,
  LATEST_DEFINITION_OUTPUT_PATH,
  type SupabaseFetchInit,
} from "./generateLatestDefinition";
import { LATEST_DEFINITION_PATH } from "./load";

// ---- テスト用の値 ----

/** Supabase のプロジェクトの URL（テスト用。通信はしない） */
const SUPABASE_URL = "https://example-project.supabase.co";
/** publishable key（テスト用の値） */
const PUBLISHABLE_KEY = "sb_publishable_test-only-key";
/** 最新のイベントの ID（DB の events.id は uuid） */
const EVENT_ID = "0b6f0c1e-6a7d-4c6e-9d0a-2f6c1e7b9a10";
/** 取得の失敗の Error の文に入れる案内（無料プランは約 7 日アクセスがないと停止する） */
const PAUSED_HINT = "Supabase のプロジェクトが停止していないか確かめてください";
/** 最新のイベント・公開版がないときの結果の文 */
const NONE_MESSAGE = "まだ公開されたイベントがありません";

/** 読む表 */
type Table = "app_state" | "published_definitions";

/** 公開版の定義（2026夏イベの定義の event.id を DB のイベント ID にしたもの。公開の RPC は event.id に events.id を入れる） */
function publishedContent() {
  const definition = cloneSummer2026Definition();
  definition.event.id = EVENT_ID;
  return definition;
}

/** app_state の応答（最新のイベントあり） */
const latestEventRows = [{ latest_event_id: EVENT_ID }];
/** app_state の応答（最新のイベントなし） */
const noLatestEventRows = [{ latest_event_id: null }];

/** published_definitions の応答（公開版 1 件） */
function publishedRows(content: unknown = publishedContent()) {
  return [{ content, version_label: "2026/08/04 版", published_at: "2026-08-04T03:00:00+00:00" }];
}

// ---- 取得の差し替え ----

/** 取得の 1 回ごとの結果。Error は例外を投げる（通信の失敗）。それ以外はその HTTP の状態と本文で応答する */
type FetchStep = Error | { status: number; body: string };

/** 成功（200）の応答で、value を JSON にした本文を返す */
function okJson(value: unknown): FetchStep {
  return { status: 200, body: JSON.stringify(value) };
}

/** その HTTP の状態の応答 */
function respondStatus(status: number, body = "error"): FetchStep {
  return { status, body };
}

/** 表ごとの取得の結果（呼ばれるたびに順に返す。使い切ったら最後の結果をくり返す） */
interface SupabaseRoutes {
  appState: readonly FetchStep[];
  published?: readonly FetchStep[];
}

/** URL の最後の区切りの名前（/rest/v1/app_state なら app_state） */
function tableOf(url: string): string {
  const { pathname } = new URL(url);
  return pathname.slice(pathname.lastIndexOf("/") + 1);
}

/** 表の名前ごとに routes の結果を返す取得の差し替え（用意していない取得先は例外にする） */
function supabaseFetch(routes: SupabaseRoutes) {
  const counts = new Map<string, number>();
  return vi.fn(async (url: string, init: SupabaseFetchInit): Promise<FetchResponseLike> => {
    void init;
    const table = tableOf(url);
    const steps =
      table === "app_state" ? routes.appState : table === "published_definitions" ? routes.published : undefined;
    if (steps === undefined || steps.length === 0) {
      throw new Error(`テストで用意していない取得先：${url}`);
    }
    const index = counts.get(table) ?? 0;
    counts.set(table, index + 1);
    const step = steps[Math.min(index, steps.length - 1)];
    if (step instanceof Error) throw step;
    return { ok: step.status >= 200 && step.status < 300, status: step.status, text: async () => step.body };
  });
}

type SupabaseFetchMock = ReturnType<typeof supabaseFetch>;

/** その表への取得の呼び出し */
function callsTo(fetch: SupabaseFetchMock, table: Table) {
  return fetch.mock.calls.filter(([url]) => tableOf(url) === table);
}

/** 書き出しの差し替え（呼ばれた内容を記録する） */
function recordingWriteFile() {
  return vi.fn(async (path: string, content: string): Promise<void> => {
    void path;
    void content;
  });
}

/** 削除の差し替え（呼ばれた内容を記録する） */
function recordingRemoveFile() {
  return vi.fn(async (path: string): Promise<void> => {
    void path;
  });
}

/** 差し替えた取得・書き出し・削除と、待たない設定（retryDelayMs: 0）の引数を作る */
function setup(routes: SupabaseRoutes, overrides: Partial<Omit<GenerateLatestDefinitionDeps, "fetch">> = {}) {
  const fetch = supabaseFetch(routes);
  const writeFile = recordingWriteFile();
  const removeFile = recordingRemoveFile();
  const deps: GenerateLatestDefinitionDeps = {
    fetch,
    writeFile,
    removeFile,
    supabaseUrl: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    retryDelayMs: 0,
    ...overrides,
  };
  return { deps, fetch, writeFile, removeFile };
}

/** 最新のイベントの公開版がそろった取得の結果 */
function publishedRoutes(content: unknown = publishedContent()): SupabaseRoutes {
  return { appState: [okJson(latestEventRows)], published: [okJson(publishedRows(content))] };
}

/** 失敗するはずの処理の Error の文を返す（成功したら、その時点でテストを失敗させる） */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  const [result] = await Promise.allSettled([promise]);
  expect(result.status, "失敗するはずが、成功した").toBe("rejected");
  if (result.status !== "rejected") return "";
  const reason: unknown = result.reason;
  return reason instanceof Error ? reason.message : String(reason);
}

/** 文に、数 n が（ほかの数字の一部ではなく）そのままの数として入っているか */
function containsNumber(message: string, n: number): boolean {
  return new RegExp(`(^|\\D)${n}(\\D|$)`).test(message);
}

describe("generateLatestDefinition（最新イベントの公開版を取得して静的 JSON に書き出す）", () => {
  it("書き出し先は public/data/latest-definition.json（一般の画面が読む LATEST_DEFINITION_PATH と同じファイル）", () => {
    expect(LATEST_DEFINITION_OUTPUT_PATH).toBe("public/data/latest-definition.json");
    expect(`public${LATEST_DEFINITION_PATH}`).toBe(LATEST_DEFINITION_OUTPUT_PATH);
  });

  it("最新イベントの公開版があれば、その定義を JSON で書き出し、イベントの ID・名前・版の日付を返す（ファイルは消さない）", async () => {
    // 準備
    const content = publishedContent();
    const { deps, writeFile, removeFile } = setup(publishedRoutes(content));

    // 実行
    const result = await generateLatestDefinition(deps);

    // 検証：書き出し（一般の画面の読み込みと同じ検証を通り、中身は公開版の定義と同じ。DB の列〔版の表示など〕は入れない）
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, written] = writeFile.mock.calls[0];
    expect(path).toBe(LATEST_DEFINITION_OUTPUT_PATH);
    const parsed = parsePublicDefinition(written);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    expect(JSON.parse(written)).toEqual(content);
    expect(removeFile).not.toHaveBeenCalled();
    // 検証：結果
    expect(result).toEqual({
      kind: "written",
      outputPath: LATEST_DEFINITION_OUTPUT_PATH,
      eventId: EVENT_ID,
      eventName: "2026夏イベ",
      versionDate: "2026-08-04",
    });
  });

  it("最新イベントの ID は、app_state の行（id=eq.true）から latest_event_id だけを読む", async () => {
    const { deps, fetch } = setup(publishedRoutes());

    await generateLatestDefinition(deps);

    const calls = callsTo(fetch, "app_state");
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0][0]);
    expect(`${url.origin}${url.pathname}`).toBe(`${SUPABASE_URL}/rest/v1/app_state`);
    expect(url.searchParams.get("select")).toBe("latest_event_id");
    expect(url.searchParams.get("id")).toBe("eq.true");
  });

  it("公開版は、最新イベントの行を公開日時の新しい順に 1 件だけ読む（content を含める）", async () => {
    const { deps, fetch } = setup(publishedRoutes());

    await generateLatestDefinition(deps);

    const calls = callsTo(fetch, "published_definitions");
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0][0]);
    expect(`${url.origin}${url.pathname}`).toBe(`${SUPABASE_URL}/rest/v1/published_definitions`);
    expect(url.searchParams.get("event_id")).toBe(`eq.${EVENT_ID}`);
    expect(url.searchParams.get("order")).toBe("published_at.desc");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("select")?.split(",")).toContain("content");
  });

  // publishable key は JWT ではないため Authorization: Bearer に入れない（入れると Invalid JWT で 401 になりうる。Supabase の API キーの説明）
  it("どちらの取得にも、publishable key を apikey だけで付け、Authorization は付けない", async () => {
    const { deps, fetch } = setup(publishedRoutes());

    await generateLatestDefinition(deps);

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      const headers = new Headers(init.headers);
      expect(headers.get("apikey"), `apikey（${url}）`).toBe(PUBLISHABLE_KEY);
      expect(headers.get("authorization"), `Authorization（${url}）`).toBeNull();
    }
  });

  it("URL の末尾に / があっても、/ を重ねずに /rest/v1/ を付ける", async () => {
    const { deps, fetch } = setup(publishedRoutes(), { supabaseUrl: `${SUPABASE_URL}/` });

    await generateLatestDefinition(deps);

    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/rest/v1/app_state",
      "/rest/v1/published_definitions",
    ]);
  });

  it("書き出し先を指定すると、そこへ書き出す", async () => {
    const { deps, writeFile } = setup(publishedRoutes(), { outputPath: "out/data/latest-definition.json" });

    const result = await generateLatestDefinition(deps);

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith("out/data/latest-definition.json", expect.any(String));
    expect(result.outputPath).toBe("out/data/latest-definition.json");
  });
});

describe("generateLatestDefinition：まだ公開されたイベントがない（latest_event_id が null のときだけ、ファイルを消して成功する。テスト用の定義を本番に出さない）", () => {
  it("latest_event_id が null なら、公開版を読まずに書き出し先のファイルを消し、「まだ公開されたイベントがありません」の結果で成功する", async () => {
    // 準備
    const { deps, fetch, writeFile, removeFile } = setup({ appState: [okJson(noLatestEventRows)] });

    // 実行
    const result = await generateLatestDefinition(deps);

    // 検証
    expect(callsTo(fetch, "app_state")).toHaveLength(1);
    expect(callsTo(fetch, "published_definitions")).toHaveLength(0);
    expect(removeFile).toHaveBeenCalledTimes(1);
    expect(removeFile).toHaveBeenCalledWith(LATEST_DEFINITION_OUTPUT_PATH);
    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "none", outputPath: LATEST_DEFINITION_OUTPUT_PATH });
    expect(result.kind === "none" ? result.message : "").toContain(NONE_MESSAGE);
  });

  // 最新のイベントは公開して最新にしたもの（U18）なので、正常な DB では公開版が 0 件にならない。
  // 0 件は RLS の設定の誤り・データの不整合とみなし、ファイルを消さずに失敗する（本番を空のサイトにしない。PR-13a のレビュー M1）
  it("最新のイベントに公開版がない（published_definitions が空の配列）なら、表の名前と RLS・データの確認の案内を入れた Error で失敗し、書き出さず消さない", async () => {
    const { deps, fetch, writeFile, removeFile } = setup({ appState: [okJson(latestEventRows)], published: [okJson([])] });

    const message = await rejectionMessage(generateLatestDefinition(deps));

    expect(callsTo(fetch, "published_definitions")).toHaveLength(1);
    expect(message).toContain("published_definitions");
    expect(message).toContain(EVENT_ID);
    expect(message).toContain("RLS");
    expect(writeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("書き出し先を指定していれば、そのファイルを消す", async () => {
    const { deps, removeFile } = setup(
      { appState: [okJson(noLatestEventRows)] },
      { outputPath: "out/data/latest-definition.json" },
    );

    await generateLatestDefinition(deps);

    expect(removeFile).toHaveBeenCalledTimes(1);
    expect(removeFile).toHaveBeenCalledWith("out/data/latest-definition.json");
  });
});

describe("generateLatestDefinition：取得の失敗（理由つきで失敗し、書き出さず消さない。古い JSON・仮の定義のまま公開しない）", () => {
  it("app_state の取得で通信に失敗したら、表の名前・元の理由・停止の確認の案内を入れた Error で失敗する", async () => {
    const { deps, writeFile, removeFile } = setup({
      appState: [new Error("getaddrinfo ENOTFOUND example-project.supabase.co")],
    });

    const message = await rejectionMessage(generateLatestDefinition(deps));

    expect(message).toContain("app_state");
    expect(message).toContain("getaddrinfo ENOTFOUND example-project.supabase.co");
    expect(message).toContain(PAUSED_HINT);
    expect(writeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("公開版の取得で通信に失敗したら、表の名前・元の理由・停止の確認の案内を入れた Error で失敗する", async () => {
    const { deps, writeFile, removeFile } = setup({
      appState: [okJson(latestEventRows)],
      published: [new Error("read ECONNRESET")],
    });

    const message = await rejectionMessage(generateLatestDefinition(deps));

    expect(message).toContain("published_definitions");
    expect(message).toContain("read ECONNRESET");
    expect(message).toContain(PAUSED_HINT);
    expect(writeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it.each<[Table, number]>([
    ["app_state", 503],
    ["app_state", 401],
    ["published_definitions", 500],
    ["published_definitions", 403],
  ])("%s の応答が HTTP の状態 %i なら、表の名前・状態の番号・停止の確認の案内を入れた Error で失敗する", async (table, status) => {
    // 準備
    const routes: SupabaseRoutes =
      table === "app_state"
        ? { appState: [respondStatus(status)] }
        : { appState: [okJson(latestEventRows)], published: [respondStatus(status)] };
    const { deps, writeFile, removeFile } = setup(routes);

    // 実行
    const message = await rejectionMessage(generateLatestDefinition(deps));

    // 検証
    expect(message).toContain(table);
    expect(containsNumber(message, status), `状態の番号 ${status} が入っていない：${message}`).toBe(true);
    expect(message).toContain(PAUSED_HINT);
    expect(writeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("ok でない応答の本文が PostgREST の誤り（JSON の message）なら、その文も入れる（権限の誤りなどの手がかり）", async () => {
    const errorBody = JSON.stringify({
      code: "42501",
      details: null,
      hint: null,
      message: "permission denied for table app_state",
    });
    const { deps, writeFile } = setup({ appState: [respondStatus(401, errorBody)] });

    const message = await rejectionMessage(generateLatestDefinition(deps));

    expect(message).toContain("permission denied for table app_state");
    expect(containsNumber(message, 401), `状態の番号 401 が入っていない：${message}`).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each<[Table]>([["app_state"], ["published_definitions"]])(
    "%s の応答が JSON として読めなければ、再試行せずに、表の名前と停止の確認の案内を入れた Error で失敗する",
    async (table) => {
      const html: FetchStep = { status: 200, body: "<!DOCTYPE html><html><body>Project paused</body></html>" };
      const routes: SupabaseRoutes =
        table === "app_state" ? { appState: [html] } : { appState: [okJson(latestEventRows)], published: [html] };
      const { deps, fetch, writeFile, removeFile } = setup(routes);

      const message = await rejectionMessage(generateLatestDefinition(deps));

      expect(message).toContain(table);
      expect(message).toContain(PAUSED_HINT);
      expect(callsTo(fetch, table)).toHaveLength(1);
      expect(writeFile).not.toHaveBeenCalled();
      expect(removeFile).not.toHaveBeenCalled();
    },
  );

  it.each<[string, SupabaseRoutes, Table]>([
    ["app_state の応答が配列でない", { appState: [okJson({ latest_event_id: EVENT_ID })] }, "app_state"],
    ["app_state の行がない（空の配列。RLS の設定の誤り・別のプロジェクトなど）", { appState: [okJson([])] }, "app_state"],
    ["app_state の行に latest_event_id がない", { appState: [okJson([{}])] }, "app_state"],
    ["latest_event_id が文字列でも null でもない", { appState: [okJson([{ latest_event_id: 123 }])] }, "app_state"],
    [
      "published_definitions の応答が配列でない",
      { appState: [okJson(latestEventRows)], published: [okJson(publishedRows()[0])] },
      "published_definitions",
    ],
    [
      "published_definitions の行に content がない",
      { appState: [okJson(latestEventRows)], published: [okJson([{ published_at: "2026-08-04T03:00:00+00:00" }])] },
      "published_definitions",
    ],
  ])("%s なら、表の名前を入れた Error で失敗する（「公開されたイベントがない」とみなしてファイルを消さない）", async (_label, routes, table) => {
    const { deps, writeFile, removeFile } = setup(routes);

    const message = await rejectionMessage(generateLatestDefinition(deps));

    expect(message).toContain(table);
    expect(writeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });
});

describe("generateLatestDefinition：公開版が検証に通らない（壊れた定義を配らない）", () => {
  /** event をなくした公開版 */
  function withoutEvent(): unknown {
    const { event, ...rest } = publishedContent();
    void event;
    return rest;
  }

  /** E2 ゲージ3（stages[4]）の最初の特効グループの倍率を 1 未満にした公開版 */
  function withLowMultiplier(): unknown {
    const content = publishedContent();
    content.stages[4].boosts[0].multiplier = 0.5;
    return content;
  }

  it.each<[string, () => unknown]>([
    ["event がない", withoutEvent],
    ["倍率が 1 未満", withLowMultiplier],
    ["content が null", () => null],
  ])("公開版の定義で %s なら、検証の誤りの文を入れた Error で失敗し、書き出さず消さない", async (_label, makeContent) => {
    // 準備：検証の誤りの文は、一般の画面と同じ検証（validatePublicDefinition）の結果から取る
    const content = makeContent();
    const validation = validatePublicDefinition(content);
    expect(validation.ok, "前提：壊した定義は検証に通らない").toBe(false);
    const firstErrorMessage = validation.ok ? "" : validation.errors[0].message;
    const { deps, writeFile, removeFile } = setup(publishedRoutes(content));

    // 実行
    const message = await rejectionMessage(generateLatestDefinition(deps));

    // 検証
    expect(message).toContain(firstErrorMessage);
    expect(writeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });
});

describe("generateLatestDefinition：公開版のイベント ID が最新のイベントと違う（別のイベントの定義を配らない）", () => {
  it("公開版の event.id が latest_event_id と違えば、両方の ID を入れた Error で失敗し、書き出さず消さない", async () => {
    // 準備：検証には通るが、event.id が最新のイベントの ID と違う公開版（publish_definition は event.id をイベント ID に書き直すので、ふつうは一致する）
    const otherEventId = "5d2a9e47-1c3b-4f80-8e6d-7a9b0c1d2e3f";
    const content = publishedContent();
    content.event.id = otherEventId;
    expect(validatePublicDefinition(content).ok, "前提：ID を変えた定義も検証には通る").toBe(true);
    const { deps, writeFile, removeFile } = setup(publishedRoutes(content));

    // 実行
    const message = await rejectionMessage(generateLatestDefinition(deps));

    // 検証
    expect(message).toContain(EVENT_ID);
    expect(message).toContain(otherEventId);
    expect(writeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });
});

describe("generateLatestDefinition：接続先がない", () => {
  it.each<[string, Partial<Omit<GenerateLatestDefinitionDeps, "fetch">>]>([
    ["URL が空", { supabaseUrl: "" }],
    ["publishable key が空", { publishableKey: "" }],
    ["URL が空白だけ", { supabaseUrl: "  \t " }],
    ["publishable key が空白だけ", { publishableKey: "   " }],
    ["URL として読めない", { supabaseUrl: "not a url" }],
  ])("%s なら、取得せずに Error で失敗し、書き出さず消さない", async (_label, overrides) => {
    const { deps, fetch, writeFile, removeFile } = setup(publishedRoutes(), overrides);

    await rejectionMessage(generateLatestDefinition(deps));

    expect(fetch).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("URL・publishable key の前後の空白は除いて使う", async () => {
    const { deps, fetch, writeFile } = setup(publishedRoutes(), {
      supabaseUrl: `  ${SUPABASE_URL}/ \n`,
      publishableKey: ` ${PUBLISHABLE_KEY}\n`,
    });

    await generateLatestDefinition(deps);

    expect(fetch.mock.calls.map(([url]) => new URL(url).origin)).toEqual([SUPABASE_URL, SUPABASE_URL]);
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init.headers).get("apikey")).toBe(PUBLISHABLE_KEY);
    }
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("generateLatestDefinition：取得の再試行（一時的な失敗で止めない）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("app_state の通信の失敗が 2 回続いても、3 回目で取得できれば書き出して成功する", async () => {
    // 準備
    const { deps, fetch, writeFile } = setup({
      appState: [new Error("ECONNRESET 1 回目"), new Error("ECONNRESET 2 回目"), okJson(latestEventRows)],
      published: [okJson(publishedRows())],
    });

    // 実行
    const [result] = await Promise.allSettled([generateLatestDefinition(deps)]);

    // 検証
    expect(result.status).toBe("fulfilled");
    expect(callsTo(fetch, "app_state")).toHaveLength(3);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("公開版の ok でない応答（503）が 2 回続いても、3 回目で取得できれば書き出して成功する", async () => {
    const { deps, fetch, writeFile } = setup({
      appState: [okJson(latestEventRows)],
      published: [respondStatus(503), respondStatus(503), okJson(publishedRows())],
    });

    const [result] = await Promise.allSettled([generateLatestDefinition(deps)]);

    expect(result.status).toBe("fulfilled");
    expect(callsTo(fetch, "published_definitions")).toHaveLength(3);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("再試行の回数は取得ごとに数える：app_state と公開版がそれぞれ 3 回失敗しても、それぞれ 4 回目で取得できれば書き出す", async () => {
    const { deps, fetch, writeFile } = setup({
      appState: [respondStatus(503), respondStatus(502), respondStatus(500), okJson(latestEventRows)],
      published: [new Error("1 回目"), new Error("2 回目"), new Error("3 回目"), okJson(publishedRows())],
    });

    const [result] = await Promise.allSettled([generateLatestDefinition(deps)]);

    expect(result.status).toBe("fulfilled");
    expect(callsTo(fetch, "app_state")).toHaveLength(4);
    expect(callsTo(fetch, "published_definitions")).toHaveLength(4);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("すべて失敗したら、既定では最初の 1 回と再試行 3 回（計 4 回）取得し、最後の失敗の理由で失敗する。書き出さず消さない", async () => {
    const { deps, fetch, writeFile, removeFile } = setup({
      appState: [
        new Error("ECONNRESET 1 回目"),
        new Error("ECONNRESET 2 回目"),
        new Error("ECONNRESET 3 回目"),
        new Error("ETIMEDOUT 4 回目"),
      ],
    });

    const message = await rejectionMessage(generateLatestDefinition(deps));

    expect(callsTo(fetch, "app_state")).toHaveLength(4);
    expect(message).toContain("app_state");
    expect(message).toContain("ETIMEDOUT 4 回目");
    expect(message).toContain(PAUSED_HINT);
    expect(writeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("ok でない応答が続いてすべて失敗したら、最後の応答の状態の番号で失敗する", async () => {
    const { deps, fetch, writeFile } = setup({
      appState: [okJson(latestEventRows)],
      published: [respondStatus(500), respondStatus(502), respondStatus(503), respondStatus(504)],
    });

    const message = await rejectionMessage(generateLatestDefinition(deps));

    expect(callsTo(fetch, "published_definitions")).toHaveLength(4);
    expect(message).toContain("published_definitions");
    expect(containsNumber(message, 504), `状態の番号 504 が入っていない：${message}`).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])("HTTP の状態 %i は再試行しても直らないので、1 回の取得で失敗する", async (status) => {
    const { deps, fetch, writeFile } = setup({ appState: [respondStatus(status), okJson(latestEventRows)] });

    const message = await rejectionMessage(generateLatestDefinition(deps));

    expect(callsTo(fetch, "app_state")).toHaveLength(1);
    expect(containsNumber(message, status), `状態の番号 ${status} が入っていない：${message}`).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([408, 429])("HTTP の状態 %i は一時的な失敗なので再試行し、次で取得できれば書き出す", async (status) => {
    const { deps, fetch, writeFile } = setup({
      appState: [respondStatus(status), okJson(latestEventRows)],
      published: [okJson(publishedRows())],
    });

    const [result] = await Promise.allSettled([generateLatestDefinition(deps)]);

    expect(result.status).toBe("fulfilled");
    expect(callsTo(fetch, "app_state")).toHaveLength(2);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("retries を 0 にすると再試行せず、1 回の取得で失敗する", async () => {
    const { deps, fetch, writeFile } = setup(
      { appState: [new Error("ECONNRESET"), okJson(latestEventRows)], published: [okJson(publishedRows())] },
      { retries: 0 },
    );

    const message = await rejectionMessage(generateLatestDefinition(deps));

    expect(callsTo(fetch, "app_state")).toHaveLength(1);
    expect(message).toContain("ECONNRESET");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("既定では、再試行の前に 2000 ミリ秒待つ", async () => {
    // 準備：時計を偽物にする（待ち時間を実際には待たない）。retryDelayMs は渡さない
    vi.useFakeTimers();
    const fetch = supabaseFetch({
      appState: [new Error("ECONNRESET"), okJson(latestEventRows)],
      published: [okJson(publishedRows())],
    });
    const deps: GenerateLatestDefinitionDeps = {
      fetch,
      writeFile: recordingWriteFile(),
      removeFile: recordingRemoveFile(),
      supabaseUrl: SUPABASE_URL,
      publishableKey: PUBLISHABLE_KEY,
    };

    // 実行
    const settled = Promise.allSettled([generateLatestDefinition(deps)]);

    // 検証：1999 ミリ秒では再試行せず、2000 ミリ秒で再試行する
    await vi.advanceTimersByTimeAsync(1999);
    expect(callsTo(fetch, "app_state")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(callsTo(fetch, "app_state")).toHaveLength(2);
    const [result] = await settled;
    expect(result.status).toBe("fulfilled");
  });

  it("retryDelayMs を指定すると、再試行の前にその時間だけ待つ", async () => {
    vi.useFakeTimers();
    const { deps, fetch } = setup(
      { appState: [okJson(latestEventRows)], published: [respondStatus(503), okJson(publishedRows())] },
      { retryDelayMs: 300 },
    );

    const settled = Promise.allSettled([generateLatestDefinition(deps)]);

    await vi.advanceTimersByTimeAsync(299);
    expect(callsTo(fetch, "published_definitions")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(callsTo(fetch, "published_definitions")).toHaveLength(2);
    const [result] = await settled;
    expect(result.status).toBe("fulfilled");
  });
});
