// 権限ごとの画面と操作の可否の画面テスト（Playwright。e2e/permissions.spec.ts。roadmap T4-1・要件 2.3）で使う補助
//
// 協力者・管理者の画面（イベント定義・協力者・設定のアカウント欄）は Supabase（Auth・PostgREST・RPC）を使う。
// CI の画面テストのジョブには Supabase がないので、次の 2 つを組み合わせて、ログイン済みの協力者・管理者を再現する
// - signInAs：ログイン済みの状態をブラウザに入れる（page.addInitScript）
//   - アプリが権限を覚える localStorage の "fudawari.account"（src/features/auth/account.ts の形）
//   - supabase-js のセッション（localStorage の "sb-（接続先のホスト名の先頭）-auth-token"）
// - FakeSupabase：接続先（ビルドのときの NEXT_PUBLIC_SUPABASE_URL）への通信を page.route で受け、
//   Auth（/auth/v1/user・/auth/v1/logout・/auth/v1/signup）・PostgREST の表の読み取り・RPC にメモリ上の値で答える。
//   受けた通信は記録し、知らない通信は unexpected に入れて 500 を返す（テストで空であることを確かめる）
// - Realtime（WebSocket。定義画面の「（名前）も編集中」の Presence）は page.routeWebSocket で受け、本物の接続先にはつながずに閉じる。
//   編集中の表示は出せなくてよい（画面は失敗を出さない）。受けた接続は realtimeConnections に記録し、unexpected には入れない
//
// 接続先の URL はビルドに埋め込まれるため、テストを動かす Node も同じ環境変数を持っている必要がある
// （`npm run test:e2e` はビルドと Playwright を同じ環境変数で動かす。CI の e2e のジョブは https://example.supabase.co を入れている）。
//
// Playwright から読むので、Vitest や Testing Library を読み込まない。別名（@/…）の実行時の import も避ける（型だけは読める）。
import type { Page, Request, Route } from "@playwright/test";
import type { PublicDefinition } from "@/domain/definition/types";
import { summer2026Definition } from "./fixtures";

// ---- 接続先 ----

/**
 * ビルドのときに入れた Supabase の接続先。URL と公開キー（NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY）の両方があるときだけ返し、
 * どちらかがなければ null（画面はクライアントを作らないので、協力者・管理者の画面は確かめられない。src/lib/supabase/config.ts と同じ条件）
 */
export function configuredSupabaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url === undefined || url === "" || key === undefined || key === "") return null;
  return url.replace(/\/+$/, "");
}

/** supabase-js がセッションを保存する localStorage のキー（supabase-js の既定：sb-（ホスト名の最初の区切り）-auth-token） */
function sessionStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

// ---- 人とイベント ----

/** 協力者・管理者の権限（profiles.role） */
export type ManagerRole = "admin" | "collab";

/** テストで使うアカウント */
export interface FakeAccount {
  readonly userId: string;
  readonly role: ManagerRole;
  readonly displayName: string;
  /** ログインの ID（「@fudawari.invalid」を付けない形） */
  readonly loginId: string;
}

export const ADMIN: FakeAccount = {
  userId: "00000000-0000-4000-8000-00000000a001",
  role: "admin",
  displayName: "管理 太郎",
  loginId: "taro-admin",
};

export const COLLAB: FakeAccount = {
  userId: "00000000-0000-4000-8000-00000000c001",
  role: "collab",
  displayName: "協力 花子",
  loginId: "hanako-01",
};

/** 最新のイベント（2026夏イベ）の ID（events.id） */
export const SUMMER_EVENT_ID = "00000000-0000-4000-8000-0000000e0826";
/** 過去のイベント（2026春イベ）の ID。新規作成の「元にするイベント」の候補 */
export const SPRING_EVENT_ID = "00000000-0000-4000-8000-0000000e0426";
/** 新規作成（create_event）で返すイベントの ID */
export const CREATED_EVENT_ID = "00000000-0000-4000-8000-0000000e1126";

export const SUMMER_EVENT_NAME = "2026夏イベ";
export const SPRING_EVENT_NAME = "2026春イベ";

/** 2026夏イベの開始日時（日本時間 2026-08-07 12:00） */
const SUMMER_STARTS_AT = "2026-08-07T03:00:00+00:00";

/** 画面の時刻（日本時間 2026-10-16 12:00）。テストはブラウザの時刻をこれに固定する */
export const NOW = new Date("2026-10-16T12:00:00+09:00");
/** 2026夏イベが終了しているときの終了日時（日本時間 2026-10-01 12:00。NOW より前） */
export const SUMMER_ENDED_AT = "2026-10-01T03:00:00+00:00";

/** 定義の文書を写す（テスト用データは凍結しているため、書き換える前に写す） */
function cloneDoc(doc: PublicDefinition): PublicDefinition {
  return JSON.parse(JSON.stringify(doc)) as PublicDefinition;
}

/** 2026夏イベの文書（下書き・公開版の content。終了日時は日本時間の時差つき、未定は null） */
export function summerDoc(endsAtJst: string | null): PublicDefinition {
  const doc = cloneDoc(summer2026Definition);
  return { ...doc, event: { ...doc.event, id: SUMMER_EVENT_ID, endAt: endsAtJst } };
}

/**
 * 2026春イベの文書（公開版の content）。2026夏イベの E1 の札・段階だけにする
 * （新規作成で元にしたとき、写した札・段階が春イベのものだと見分けられるように）
 */
export function springDoc(): PublicDefinition {
  const doc = cloneDoc(summer2026Definition);
  const stages = doc.stages.filter((stage) => stage.areaId === "E1");
  const fudaIds = new Set(stages.map((stage) => stage.fudaId));
  return {
    ...doc,
    event: {
      id: SPRING_EVENT_ID,
      name: SPRING_EVENT_NAME,
      startAt: "2026-05-01T12:00:00+09:00",
      endAt: "2026-05-31T12:00:00+09:00",
      versionDate: "2026-04-28",
    },
    areas: doc.areas.filter((area) => area.id === "E1"),
    fudas: doc.fudas.filter((fuda) => fudaIds.has(fuda.id)),
    stages,
  };
}

/** 2026夏イベの下書きの版 */
export const SUMMER_DRAFT_VERSION = 3;

/** UTC の timestamptz（例 "2026-10-01T03:00:00+00:00"）を日本時間の時差つき（"2026-10-01T12:00:00+09:00"）にする */
function utcToJst(value: string): string {
  const jst = new Date(Date.parse(value) + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 19)}+09:00`;
}

// ---- 表 ----

/**
 * 保存の記録（save_logs の行）。2026夏イベの 3 件と、別のイベント（2026春イベ）の 1 件。
 * 画面は開いたイベントの記録だけを、新しい順に出す
 */
export const SAVE_LOGS = [
  {
    id: 1,
    event_id: SPRING_EVENT_ID,
    created_at: "2026-04-28T03:00:00+00:00",
    user_id: ADMIN.userId,
    user_name: ADMIN.displayName,
    kind: "publish",
    map_label: null,
    summary: "公開（2026/04/28 版）",
  },
  {
    id: 2,
    event_id: SUMMER_EVENT_ID,
    created_at: "2026-08-03T12:00:00+00:00",
    user_id: ADMIN.userId,
    user_name: ADMIN.displayName,
    kind: "save",
    map_label: "E1",
    summary: "E1 ギミック〜ゲージ3 の特効を追加",
  },
  {
    id: 3,
    event_id: SUMMER_EVENT_ID,
    created_at: "2026-08-04T03:00:00+00:00",
    user_id: ADMIN.userId,
    user_name: ADMIN.displayName,
    kind: "publish",
    map_label: null,
    summary: "公開（2026/08/04 版）",
  },
  {
    id: 4,
    event_id: SUMMER_EVENT_ID,
    created_at: "2026-10-15T13:40:00+00:00",
    user_id: COLLAB.userId,
    user_name: COLLAB.displayName,
    kind: "save",
    map_label: "E2",
    summary: "E2 の段階の大事さを「普通」→「重要」",
  },
] as const;

type Row = Record<string, unknown>;

export interface FakeSupabaseOptions {
  /** 2026夏イベ（最新）の終了日時（timestamptz。未定は null） */
  readonly summerEndsAt: string | null;
}

function initialTables(options: FakeSupabaseOptions): Record<string, Row[]> {
  const summerEndJst = options.summerEndsAt === null ? null : utcToJst(options.summerEndsAt);
  return {
    profiles: [
      {
        user_id: ADMIN.userId,
        display_name: ADMIN.displayName,
        role: ADMIN.role,
        created_at: "2026-07-01T00:00:00.123456+00:00",
        last_edited_at: "2026-08-04T10:00:00+00:00",
        last_edited_note: "公開",
      },
      {
        user_id: COLLAB.userId,
        display_name: COLLAB.displayName,
        role: COLLAB.role,
        created_at: "2026-07-10T00:00:00.654321+00:00",
        last_edited_at: "2026-10-15T13:40:00+00:00",
        last_edited_note: "下書きを保存",
      },
    ],
    app_state: [{ latest_event_id: SUMMER_EVENT_ID }],
    events: [
      {
        id: SPRING_EVENT_ID,
        name: SPRING_EVENT_NAME,
        starts_at: "2026-05-01T03:00:00+00:00",
        ends_at: "2026-05-31T03:00:00+00:00",
        created_at: "2026-04-20T00:00:00+00:00",
      },
      {
        id: SUMMER_EVENT_ID,
        name: SUMMER_EVENT_NAME,
        starts_at: SUMMER_STARTS_AT,
        ends_at: options.summerEndsAt,
        created_at: "2026-07-20T00:00:00+00:00",
      },
    ],
    drafts: [
      {
        event_id: SUMMER_EVENT_ID,
        version: SUMMER_DRAFT_VERSION,
        content: summerDoc(summerEndJst),
        updated_by: COLLAB.userId,
        updated_at: "2026-10-15T13:40:00+00:00",
      },
    ],
    save_logs: SAVE_LOGS.map((log) => ({ ...log })),
    published_definitions: [
      {
        event_id: SPRING_EVENT_ID,
        version_label: "2026/04/28 版",
        content: springDoc(),
        published_at: "2026-04-28T03:00:00+00:00",
      },
      {
        event_id: SUMMER_EVENT_ID,
        version_label: "2026/08/04 版",
        content: summerDoc(summerEndJst),
        published_at: "2026-08-04T03:00:00+00:00",
      },
    ],
  };
}

/** PostgREST の問い合わせ文字列のうち、絞り込みでないもの（これ以外は絞り込みとして読み、eq.・in.() 以外は失敗させる） */
const NON_FILTER_PARAMS = new Set(["select", "order", "limit", "offset"]);

/** 件数の指定（offset・limit）を 0 以上の整数として読む。なければ null、読めなければ失敗させる */
function countParam(params: URLSearchParams, name: "offset" | "limit"): number | null {
  const text = params.get(name);
  if (text === null) return null;
  const value = Number(text);
  if (!/^[0-9]+$/.test(text) || !Number.isSafeInteger(value)) {
    throw new Error(`偽物の PostgREST が読めない件数の指定です：${name}=${text}`);
  }
  return value;
}

/** 絞り込み（eq.・in.()）を 1 つ当てる */
function matchesFilter(row: Row, column: string, expression: string): boolean {
  const value = row[column];
  if (expression.startsWith("eq.")) return String(value) === expression.slice(3);
  if (expression.startsWith("in.(") && expression.endsWith(")")) {
    const options = expression
      .slice(4, -1)
      .split(",")
      .map((option) => option.replace(/^"|"$/g, ""));
    return options.includes(String(value));
  }
  throw new Error(`偽物の PostgREST が知らない絞り込みです：${column}=${expression}`);
}

/** 表の行を、問い合わせ文字列（絞り込み・並び・件数・列）に従って選ぶ */
function selectRows(rows: readonly Row[], params: URLSearchParams): Row[] {
  const select = params.get("select");
  // 埋め込み（別の表の列。例 "*, profiles(display_name)"）・列の別名・型の変換は答え方を作っていないので、黙って無視せず失敗させる
  if (select !== null && /[():]/.test(select)) {
    throw new Error(`偽物の PostgREST が知らない列の指定です：select=${select}`);
  }
  let result = [...rows];
  for (const [column, expression] of params) {
    if (NON_FILTER_PARAMS.has(column)) continue;
    result = result.filter((row) => matchesFilter(row, column, expression));
  }
  const order = params.get("order");
  if (order !== null) {
    // 例 "created_at.desc,id.desc"（前の列から順に比べる）
    const keys = order.split(",").map((key) => {
      const [column = "", direction] = key.split(".");
      return { column, sign: direction === "desc" ? -1 : 1 };
    });
    result.sort((a, b) => {
      for (const { column, sign } of keys) {
        const x = a[column];
        const y = b[column];
        const compared =
          typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        if (compared !== 0) return sign * compared;
      }
      return 0;
    });
  }
  // range(from, to) は offset=from&limit=(to-from+1) になる。先に offset 件を飛ばしてから limit 件で切る
  const offset = countParam(params, "offset");
  if (offset !== null) result = result.slice(offset);
  const limit = countParam(params, "limit");
  if (limit !== null) result = result.slice(0, limit);
  if (select !== null && select !== "*") {
    const columns = select.split(",").map((column) => column.trim());
    // 表にない列を頼まれたら、黙って null を返さず失敗させる（画面が読む列が増えたことに気づけるように）
    const missing = columns.filter((column) => result.some((row) => !Object.hasOwn(row, column)));
    if (missing.length > 0) throw new Error(`偽物の PostgREST の表にない列です：${missing.join(", ")}`);
    result = result.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
  }
  return result;
}

// ---- 応答 ----

/** 別のオリジン（127.0.0.1 → 接続先）からの fetch に答えるための CORS の見出し */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
};

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function fulfillEmpty(route: Route, status = 204): Promise<void> {
  await route.fulfill({ status, headers: CORS_HEADERS, body: "" });
}

/** Auth の利用者（GET /auth/v1/user の応答） */
function authUser(account: FakeAccount): Row {
  return {
    id: account.userId,
    aud: "authenticated",
    role: "authenticated",
    email: `${account.loginId}@fudawari.invalid`,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2026-07-01T00:00:00+00:00",
    updated_at: "2026-07-01T00:00:00+00:00",
  };
}

/** 2030-01-01T00:00:00Z（セッションの期限。固定した画面の時刻・実際の時刻のどちらよりも後にして、更新させない） */
const SESSION_EXPIRES_AT = 1_893_456_000;

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** 形だけの JWT（偽物の Auth は中身を確かめない。supabase-js が読んでも困らない形にする） */
function fakeJwt(account: FakeAccount): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ sub: account.userId, role: "authenticated", aud: "authenticated", exp: SESSION_EXPIRES_AT }),
  );
  return `${header}.${payload}.fake-signature`;
}

/** supabase-js が localStorage に保存するセッションの形 */
function fakeSession(account: FakeAccount): Row {
  return {
    access_token: fakeJwt(account),
    refresh_token: `fake-refresh-${account.loginId}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: SESSION_EXPIRES_AT,
    user: authUser(account),
  };
}

// ---- ログイン済みの状態 ----

/** ログイン済みの状態を入れたことの目印（sessionStorage。同じタブで開き直しても残る） */
const SIGNED_IN_MARK = "fudawari-e2e.signed-in";

/**
 * ログイン済みの協力者・管理者の状態をブラウザに入れる（ページを開く前に呼ぶ）。
 * 入れるのはそのタブで最初に開いたときの 1 回だけ（sessionStorage の目印で見分ける）。
 * 開き直しや画面の移動のたびに入れ直すと、アプリが権限を消してしまう不具合を見逃すため。
 * - "fudawari.account"：アプリが権限・表示名・ID を覚える値（src/features/auth/account.ts。版 1）
 * - supabase-js のセッション：定義画面・協力者画面が Auth に問い合わせる（auth.getUser）ときに使う
 */
export async function signInAs(page: Page, account: FakeAccount, supabaseUrl: string): Promise<void> {
  await page.addInitScript(
    ({ mark, accountValue, sessionKey, sessionValue }) => {
      if (window.sessionStorage.getItem(mark) !== null) return;
      window.sessionStorage.setItem(mark, "1");
      window.localStorage.setItem("fudawari.account", accountValue);
      window.localStorage.setItem(sessionKey, sessionValue);
    },
    {
      mark: SIGNED_IN_MARK,
      accountValue: JSON.stringify({
        version: 1,
        role: account.role,
        displayName: account.displayName,
        loginId: account.loginId,
      }),
      sessionKey: sessionStorageKey(supabaseUrl),
      sessionValue: JSON.stringify(fakeSession(account)),
    },
  );
}

// ---- 偽物の Supabase ----

/** 管理者だけが呼べる RPC（docs/design/database.md 4.2） */
const ADMIN_ONLY_RPCS: ReadonlySet<string> = new Set(["create_event", "register_collaborator", "remove_collaborator"]);

/** 受けた RPC の呼び出し */
export interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/** 受けた通信（メソッドとパス） */
export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
}

/**
 * 接続先への通信に、メモリ上の表で答える偽物の Supabase。
 * install でページに取り付ける。ログインしているのは signedInAs（Auth の /user が返す人）
 */
export class FakeSupabase {
  readonly requests: ReceivedRequest[] = [];
  readonly rpcCalls: RpcCall[] = [];
  /** 答え方を知らない通信（テストで空であることを確かめる） */
  readonly unexpected: string[] = [];
  /** 受けた Realtime（WebSocket）の接続の URL（本物にはつながずに閉じる） */
  readonly realtimeConnections: string[] = [];
  /** 協力者の発行（auth.signUp）で送られたパスワード */
  readonly signUpPasswords: string[] = [];
  private readonly tables: Record<string, Row[]>;
  private draftVersion = SUMMER_DRAFT_VERSION;

  constructor(
    private readonly supabaseUrl: string,
    private readonly signedInAs: FakeAccount,
    options: FakeSupabaseOptions,
  ) {
    this.tables = initialTables(options);
  }

  /** ページの接続先への通信（HTTP・WebSocket）を受け始める */
  async install(page: Page): Promise<void> {
    await page.route(`${this.supabaseUrl}/**`, (route) => this.handle(route));
    // Realtime は wss://（接続先のホスト）/realtime/v1/websocket。本物にはつながず（connectToServer を呼ばない）、すぐ閉じる。
    // supabase-js はあとで接続し直すので、そのたびにここで受けて閉じる（編集中の表示が出ないだけ）
    const host = new URL(this.supabaseUrl).host;
    await page.routeWebSocket(
      (url) => url.host === host,
      (socket) => {
        this.realtimeConnections.push(socket.url());
        void socket.close({ code: 1011, reason: "偽物の Supabase は Realtime に答えません" });
      },
    );
  }

  /** 名前で RPC の呼び出しを探す */
  rpcCallsNamed(name: string): RpcCall[] {
    return this.rpcCalls.filter((call) => call.name === name);
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method === "OPTIONS") {
      // CORS の事前確認（Authorization は「*」に含まれないので、求められた見出しをそのまま許す）
      const requested = (await request.allHeaders())["access-control-request-headers"] ?? "*";
      await route.fulfill({
        status: 204,
        headers: { ...CORS_HEADERS, "access-control-allow-headers": requested },
        body: "",
      });
      return;
    }
    this.requests.push({ method, path });
    try {
      if (path.startsWith("/auth/v1/")) {
        await this.handleAuth(route, method, path.slice("/auth/v1/".length), request);
        return;
      }
      if (path.startsWith("/rest/v1/rpc/")) {
        await this.handleRpc(route, path.slice("/rest/v1/rpc/".length), request);
        return;
      }
      if (path.startsWith("/rest/v1/") && method === "GET") {
        const table = this.tables[path.slice("/rest/v1/".length)];
        if (table !== undefined) {
          await fulfillJson(route, 200, selectRows(table, url.searchParams));
          return;
        }
      }
    } catch (error: unknown) {
      this.unexpected.push(`${method} ${path}${url.search}：${String(error)}`);
      await fulfillJson(route, 500, { message: "偽物の Supabase で失敗しました" });
      return;
    }
    this.unexpected.push(`${method} ${path}${url.search}`);
    await fulfillJson(route, 500, { message: "偽物の Supabase が知らない通信です" });
  }

  private async handleAuth(route: Route, method: string, endpoint: string, request: Request): Promise<void> {
    if (method === "GET" && endpoint === "user") {
      await fulfillJson(route, 200, authUser(this.signedInAs));
      return;
    }
    if (method === "POST" && endpoint.startsWith("logout")) {
      await fulfillEmpty(route);
      return;
    }
    if (method === "POST" && endpoint === "signup") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      this.signUpPasswords.push(String(body.password));
      const created: FakeAccount = {
        userId: "00000000-0000-4000-8000-00000000c002",
        role: "collab",
        displayName: "",
        loginId: "jiro-02",
      };
      await fulfillJson(route, 200, {
        ...fakeSession(created),
        user: { ...authUser(created), identities: [{ id: created.userId, provider: "email" }] },
      });
      return;
    }
    throw new Error("偽物の Auth が知らない通信です");
  }

  private async handleRpc(route: Route, name: string, request: Request): Promise<void> {
    const args = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    this.rpcCalls.push({ name, args });
    // 管理者だけの RPC を協力者が呼んだ：本物の DB は FD001 で断る。画面が呼んではいけないので unexpected にも入れる
    const adminOnly = ADMIN_ONLY_RPCS.has(name) || (name === "publish_definition" && args.p_make_latest === true);
    if (adminOnly && this.signedInAs.role !== "admin") {
      this.unexpected.push(`協力者が管理者だけの RPC を呼んだ：${name}`);
      await fulfillJson(route, 403, { code: "FD001", message: "権限がありません", details: null, hint: null });
      return;
    }
    switch (name) {
      case "save_draft":
        this.draftVersion += 1;
        await fulfillJson(route, 200, { status: "saved", version: this.draftVersion });
        return;
      case "publish_definition":
        await fulfillJson(route, 200, {
          status: "published",
          id: "00000000-0000-4000-8000-0000000p1016",
          versionLabel: "2026/10/16 版",
          versionDate: "2026-10-16",
        });
        return;
      case "update_event_meta":
      case "register_collaborator":
      case "remove_collaborator":
        await fulfillEmpty(route);
        return;
      case "create_event":
        await fulfillJson(route, 200, CREATED_EVENT_ID);
        return;
      default:
        throw new Error(`偽物の Supabase が知らない RPC です：${name}`);
    }
  }
}
