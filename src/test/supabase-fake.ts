// supabase-js のクライアントの偽物（テストでは Supabase に通信しない）
//
// 使い方：
// 1. テストファイルの先頭に、次の vi.mock をそのまま書く（vi.mock は書いたファイルの中でだけ巻き上げられるため、この補助には入れられない）
//
//      vi.mock("@supabase/supabase-js", async (importOriginal) => ({
//        ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
//        createClient: vi.fn(),
//      }));
//
// 2. beforeEach で installFakeSupabase()・stubSupabaseEnv()・resetSupabaseClient()（@/lib/supabase）を呼ぶ。
//    afterEach で vi.unstubAllEnvs() を呼ぶ。
//
// createClient（偽物）は、設定が auth.persistSession: false なら issuing（保存しない別のクライアント）を、
// それ以外なら main（ふだんのクライアント）を返す。2 つのクライアントは同じ「サーバー」（Auth のアカウントと profiles 表）を共有する。
// エラーの形は supabase-js と同じにする（Auth は AuthApiError など、表と RPC は PostgrestError と code）。
import {
  AuthApiError,
  type AuthError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  createClient,
  PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { type Mock, vi } from "vitest";
import type { FetchMock } from "@/test/definition-fetch";

/** テスト用の接続先の URL（環境変数 NEXT_PUBLIC_SUPABASE_URL に入れる） */
export const FAKE_SUPABASE_URL = "https://fake-project.supabase.co";
/** テスト用の公開キー（環境変数 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY に入れる） */
export const FAKE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fake_key_for_tests";

/** 接続先の環境変数の名前 */
export type SupabaseEnvName = "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

/** 接続先の環境変数を 2 つとも入れる（afterEach で vi.unstubAllEnvs() を呼んで戻す） */
export function stubSupabaseEnv(): void {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", FAKE_SUPABASE_PUBLISHABLE_KEY);
}

/** 接続先の環境変数の 1 つを、なし（undefined）または空の文字列にする。もう 1 つは入れておく */
export function stubSupabaseEnvWithout(name: SupabaseEnvName, value: "" | undefined = undefined): void {
  stubSupabaseEnv();
  vi.stubEnv(name, value);
}

/** profiles 表の 1 行（DB と同じ列名） */
export type FakeProfileRow = {
  user_id: string;
  display_name: string;
  role: "admin" | "collab";
  created_at: string;
  last_edited_at: string | null;
  last_edited_note: string | null;
};

/** Auth のアカウント（メールアドレスとパスワード） */
export type FakeAccount = { userId: string; email: string; password: string };

/** Auth の利用者（identities は signUp の戻り値で使う。「Confirm email」が ON のときの見分けに使われる） */
export type FakeUser = { id: string; email: string; identities?: Array<Record<string, unknown>> };

/** Auth のセッション */
export type FakeSession = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  user: FakeUser;
};

/** auth.signInWithPassword・auth.signUp の結果 */
export type FakeAuthResponse = {
  data: { user: FakeUser | null; session: FakeSession | null };
  error: AuthError | null;
};

/** 表の読み取り・RPC の結果（supabase-js の PostgrestResponse と同じ形） */
export type FakeQueryResult = {
  data: unknown;
  error: PostgrestError | null;
  count: null;
  status: number;
  statusText: string;
};

/** 偽物のサーバーの中身（Auth のアカウントと profiles 表）。テストから直接書き換えてよい */
export type FakeSupabaseServer = {
  accounts: FakeAccount[];
  profiles: FakeProfileRow[];
};

type Credentials = { email: string; password: string; options?: unknown };

/** 偽物のクライアント。各メソッドは vi.fn なので、呼ばれ方の確認や mockResolvedValueOnce での差し替えができる */
export type FakeSupabaseClient = {
  auth: {
    signInWithPassword: Mock<(credentials: Credentials) => Promise<FakeAuthResponse>>;
    signUp: Mock<(credentials: Credentials) => Promise<FakeAuthResponse>>;
    signOut: Mock<(options?: unknown) => Promise<{ error: AuthError | null }>>;
    getSession: Mock<
      () => Promise<{ data: { session: FakeSession | null }; error: AuthError | null }>
    >;
    getUser: Mock<() => Promise<{ data: { user: FakeUser | null }; error: AuthError | null }>>;
    onAuthStateChange: Mock<
      (callback: unknown) => {
        data: { subscription: { id: string; unsubscribe: Mock<() => void> } };
      }
    >;
    /** クライアントの後片付け（supabase-js 2.118 の auth.dispose）。ない版をまねるときは delete で消す */
    dispose?: Mock<() => void>;
  };
  from: Mock<(table: string) => FakeQuery>;
  rpc: Mock<(fn: string, args?: Record<string, unknown>) => Promise<FakeQueryResult>>;
};

/** installFakeSupabase の戻り値 */
export type FakeSupabase = {
  /** 差し替えた createClient（作られた回数と、渡された URL・キー・設定の確認に使う） */
  createClient: Mock<typeof createClient>;
  /** ふだんのクライアント（auth.persistSession: false でない設定で作ったとき） */
  main: FakeSupabaseClient;
  /** 保存しない別のクライアント（auth.persistSession: false の設定で作ったとき） */
  issuing: FakeSupabaseClient;
  /** 2 つのクライアントが共有するサーバーの中身 */
  server: FakeSupabaseServer;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** createClient の設定が「セッションを保存しない」（auth.persistSession: false）か */
function isNonPersistent(options: unknown): boolean {
  return isRecord(options) && isRecord(options.auth) && options.auth.persistSession === false;
}

function okResult(data: unknown, status = 200): FakeQueryResult {
  return { data, error: null, count: null, status, statusText: status === 204 ? "No Content" : "OK" };
}

/** RPC が例外（SQLSTATE。例 "FD010"）を返したときの結果 */
export function rpcFailure(code: string, message = "テスト用の RPC の失敗"): FakeQueryResult {
  return {
    data: null,
    error: new PostgrestError({ message, details: "", hint: "", code }),
    count: null,
    status: 400,
    statusText: "Bad Request",
  };
}

/** 表の読み取り・RPC が、コード（例 "42501"・"PGRST301"）と状態コード（例 401・403）の失敗を返したときの結果 */
export function postgrestFailure(code: string, status: number, message = "テスト用の失敗"): FakeQueryResult {
  return {
    data: null,
    error: new PostgrestError({ message, details: "", hint: "", code }),
    count: null,
    status,
    statusText: "",
  };
}

/** 表の読み取り・RPC の通信の失敗（supabase-js は fetch の失敗を、code が空の error・status 0 で返す） */
export function networkFailure(): FakeQueryResult {
  return {
    data: null,
    error: new PostgrestError({
      message: "TypeError: Failed to fetch",
      details: "TypeError: Failed to fetch",
      hint: "",
      code: "",
    }),
    count: null,
    status: 0,
    statusText: "",
  };
}

/** Auth の通信の失敗（supabase-js は fetch の失敗を AuthRetryableFetchError で返す） */
export function authNetworkError(): AuthRetryableFetchError {
  return new AuthRetryableFetchError("Failed to fetch", 0);
}

/** Auth の失敗の結果（signInWithPassword・signUp の戻り値） */
export function authFailure(error: AuthError): FakeAuthResponse {
  return { data: { user: null, session: null }, error };
}

/** ID かパスワードが違うときの Auth のエラー */
export function invalidCredentialsError(): AuthApiError {
  return new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
}

/** すでにあるメールアドレス（ID）で signUp したときの Auth のエラー */
export function userAlreadyExistsError(): AuthApiError {
  return new AuthApiError("User already registered", 422, "user_already_exists");
}

type Order = { column: string; ascending: boolean };

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  // null は後ろ（PostgREST の昇順の既定と同じ）
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return String(a) < String(b) ? -1 : 1;
}

/**
 * 表の読み取り（from(表).select(...).eq(...).order(...).maybeSingle() など）の偽物。
 * select の列の指定は見ない（行のすべての列を返す）。await すると結果になる
 */
export class FakeQuery implements PromiseLike<FakeQueryResult> {
  private readonly source: () => readonly object[];
  private readonly forced: FakeQueryResult | null;
  private readonly filters: Array<{ column: string; value: unknown }> = [];
  private readonly orders: Order[] = [];
  private limitCount: number | null = null;
  private mode: "many" | "maybeSingle" | "single" = "many";

  constructor(source: () => readonly object[], forced: FakeQueryResult | null = null) {
    this.source = source;
    this.forced = forced;
  }

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  maybeSingle(): this {
    this.mode = "maybeSingle";
    return this;
  }

  single(): this {
    this.mode = "single";
    return this;
  }

  then<TResult1 = FakeQueryResult, TResult2 = never>(
    onfulfilled?: ((value: FakeQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): FakeQueryResult {
    if (this.forced !== null) return this.forced;
    let rows = this.source().map((row) => ({ ...row }) as Record<string, unknown>);
    rows = rows.filter((row) => this.filters.every(({ column, value }) => row[column] === value));
    if (this.orders.length > 0) {
      rows.sort((a, b) => {
        for (const { column, ascending } of this.orders) {
          const result = compareValues(a[column], b[column]);
          if (result !== 0) return ascending ? result : -result;
        }
        return 0;
      });
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    if (this.mode === "many") return okResult(rows);
    if (rows.length === 1) return okResult(rows[0]);
    if (rows.length === 0 && this.mode === "maybeSingle") return okResult(null);
    return {
      data: null,
      error: new PostgrestError({
        message: "JSON object requested, multiple (or no) rows returned",
        details: `The result contains ${rows.length} rows`,
        hint: "",
        code: "PGRST116",
      }),
      count: null,
      status: 406,
      statusText: "Not Acceptable",
    };
  }
}

/** どう読んでも決まった結果（失敗など）を返す読み取り。`fake.main.from.mockImplementationOnce(() => failedQuery(networkFailure()))` のように使う */
export function failedQuery(result: FakeQueryResult): FakeQuery {
  return new FakeQuery(() => [], result);
}

function tableRows(server: FakeSupabaseServer, table: string): readonly object[] {
  return table === "profiles" ? server.profiles : [];
}

function stringArg(args: Record<string, unknown>, name: string): string | null {
  const value = args[name];
  return typeof value === "string" ? value : null;
}

// RPC の偽物（docs/design/database.md 4.2 の register_collaborator・remove_collaborator の主な分かれ道だけをまねる。呼んだ人の権限は見ない）
function runRpc(server: FakeSupabaseServer, fn: string, args: Record<string, unknown>): FakeQueryResult {
  switch (fn) {
    case "register_collaborator": {
      const userId = stringArg(args, "p_user_id");
      const displayName = stringArg(args, "p_display_name")?.trim() ?? "";
      if (displayName === "") return rpcFailure("FD005", "表示名を入れてください");
      if (server.profiles.some((row) => row.user_id === userId)) {
        return rpcFailure("FD010", "すでに定義を編集できる権限があります");
      }
      if (userId === null || !server.accounts.some((account) => account.userId === userId)) {
        return rpcFailure("FD009", "アカウントが見つかりません");
      }
      server.profiles.push({
        user_id: userId,
        display_name: displayName,
        role: "collab",
        created_at: new Date().toISOString(),
        last_edited_at: null,
        last_edited_note: null,
      });
      return okResult(null, 204);
    }
    case "remove_collaborator": {
      const userId = stringArg(args, "p_user_id");
      const index = server.profiles.findIndex((row) => row.user_id === userId);
      if (index === -1) return rpcFailure("FD009", "協力者が見つかりません");
      if (server.profiles[index].role === "admin") return rpcFailure("FD011", "管理者は外せません");
      server.profiles.splice(index, 1);
      return okResult(null, 204);
    }
    default:
      return {
        data: null,
        error: new PostgrestError({
          message: `Could not find the function public.${fn}`,
          details: "",
          hint: "",
          code: "PGRST202",
        }),
        count: null,
        status: 404,
        statusText: "Not Found",
      };
  }
}

function createFakeClient(server: FakeSupabaseServer, counter: { users: number }): FakeSupabaseClient {
  // このクライアントのセッション（ログインしている人）
  let session: FakeSession | null = null;
  const sessionFor = (account: FakeAccount): FakeSession => ({
    access_token: `fake-access-token-${account.userId}`,
    refresh_token: `fake-refresh-token-${account.userId}`,
    token_type: "bearer",
    user: { id: account.userId, email: account.email },
  });

  return {
    auth: {
      signInWithPassword: vi.fn<(credentials: Credentials) => Promise<FakeAuthResponse>>(
        async ({ email, password }) => {
          const account = server.accounts.find((a) => a.email === email && a.password === password);
          if (account === undefined) return authFailure(invalidCredentialsError());
          session = sessionFor(account);
          return { data: { user: session.user, session }, error: null };
        },
      ),
      signUp: vi.fn<(credentials: Credentials) => Promise<FakeAuthResponse>>(
        async ({ email, password }) => {
          if (server.accounts.some((a) => a.email === email)) return authFailure(userAlreadyExistsError());
          counter.users += 1;
          const account: FakeAccount = { userId: `new-user-${counter.users}`, email, password };
          server.accounts.push(account);
          // 「Confirm email」が OFF なので、作ったアカウントのセッションがこのクライアントに入る（設計書 2.1.1）
          session = sessionFor(account);
          return { data: { user: session.user, session }, error: null };
        },
      ),
      signOut: vi.fn<(options?: unknown) => Promise<{ error: AuthError | null }>>(async () => {
        session = null;
        return { error: null };
      }),
      getSession: vi.fn<
        () => Promise<{ data: { session: FakeSession | null }; error: AuthError | null }>
      >(async () => ({ data: { session }, error: null })),
      getUser: vi.fn<() => Promise<{ data: { user: FakeUser | null }; error: AuthError | null }>>(
        async () =>
          session === null
            ? { data: { user: null }, error: new AuthSessionMissingError() }
            : { data: { user: session.user }, error: null },
      ),
      onAuthStateChange: vi.fn<
        (callback: unknown) => {
          data: { subscription: { id: string; unsubscribe: Mock<() => void> } };
        }
      >(() => ({ data: { subscription: { id: "fake-subscription", unsubscribe: vi.fn() } } })),
      dispose: vi.fn<() => void>(),
    },
    from: vi.fn<(table: string) => FakeQuery>((table) => new FakeQuery(() => tableRows(server, table))),
    rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => Promise<FakeQueryResult>>(
      async (fn, args) => runRpc(server, fn, args ?? {}),
    ),
  };
}

/**
 * createClient（vi.mock で差し替えたもの）が偽物のクライアントを返すようにする。呼ぶたびに新しいサーバーとクライアントを作り、
 * createClient の呼ばれた記録も消す。テストファイルに vi.mock("@supabase/supabase-js", …) がなければ例外にする
 */
export function installFakeSupabase(): FakeSupabase {
  const mocked = vi.mocked(createClient);
  if (!vi.isMockFunction(mocked)) {
    throw new Error(
      'このテストファイルの先頭に vi.mock("@supabase/supabase-js", …) を書いてください（src/test/supabase-fake.ts の使い方）',
    );
  }
  const server: FakeSupabaseServer = { accounts: [], profiles: [] };
  const counter = { users: 0 };
  const main = createFakeClient(server, counter);
  const issuing = createFakeClient(server, counter);
  mocked.mockReset();
  mocked.mockImplementation(((...args: unknown[]) =>
    (isNonPersistent(args[2]) ? issuing : main) as unknown as SupabaseClient) as unknown as typeof createClient);
  return { createClient: mocked, main, issuing, server };
}

/** profiles 表の行を作る（指定しない列はテスト用の値） */
export function profileRow(row: Pick<FakeProfileRow, "user_id" | "display_name" | "role"> & Partial<FakeProfileRow>): FakeProfileRow {
  return {
    created_at: "2026-07-01T03:00:00.000Z",
    last_edited_at: null,
    last_edited_note: null,
    ...row,
  };
}

/** 管理者・協力者のアカウント（ID とパスワード）と profiles の行を、偽物のサーバーに入れる */
export function addManager(
  fake: FakeSupabase,
  manager: {
    loginId: string;
    password: string;
    userId: string;
    displayName: string;
    role: "admin" | "collab";
  },
): void {
  fake.server.accounts.push({
    userId: manager.userId,
    email: `${manager.loginId}@fudawari.invalid`,
    password: manager.password,
  });
  fake.server.profiles.push(
    profileRow({ user_id: manager.userId, display_name: manager.displayName, role: manager.role }),
  );
}

/** 呼ばれた記録を見る・消すためだけに使う、vi.fn の最小限の形 */
type RecordedMock = { mock: { calls: readonly unknown[] }; mockClear: () => unknown };

function clientMocks(client: FakeSupabaseClient): Array<[string, RecordedMock]> {
  const dispose: Array<[string, RecordedMock]> =
    client.auth.dispose === undefined ? [] : [["auth.dispose", client.auth.dispose]];
  return [
    ...dispose,
    ["auth.signInWithPassword", client.auth.signInWithPassword],
    ["auth.signUp", client.auth.signUp],
    ["auth.signOut", client.auth.signOut],
    ["auth.getSession", client.auth.getSession],
    ["auth.getUser", client.auth.getUser],
    ["auth.onAuthStateChange", client.auth.onAuthStateChange],
    ["from", client.from],
    ["rpc", client.rpc],
  ];
}

function allMocks(fake: FakeSupabase): Array<[string, RecordedMock]> {
  return [
    ["createClient", fake.createClient],
    ...clientMocks(fake.main).map(([name, mock]): [string, RecordedMock] => [`main.${name}`, mock]),
    ...clientMocks(fake.issuing).map(([name, mock]): [string, RecordedMock] => [`issuing.${name}`, mock]),
  ];
}

/** 呼ばれた Supabase の操作の名前（"createClient"・"main.auth.signInWithPassword" など）。何も呼ばれていなければ空 */
export function calledSupabaseMethods(fake: FakeSupabase): string[] {
  return allMocks(fake)
    .filter(([, mock]) => mock.mock.calls.length > 0)
    .map(([name]) => name);
}

/** 呼ばれた記録だけを消す（返し方とサーバーの中身はそのまま） */
export function clearSupabaseCalls(fake: FakeSupabase): void {
  for (const [, mock] of allMocks(fake)) mock.mockClear();
}

/** fetch に渡された URL のうち、Supabase の接続先（FAKE_SUPABASE_URL）へのもの */
export function supabaseFetchUrls(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls
    .map(([input]) => (input instanceof Request ? input.url : String(input)))
    .filter((url) => url.startsWith(FAKE_SUPABASE_URL));
}
