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
// それ以外なら main（ふだんのクライアント）を返す。2 つのクライアントは同じ「サーバー」（Auth のアカウントと表）を共有する。
// 表は profiles・events・app_state・drafts・published_definitions・save_logs の読み取りをまねる（行は server に直接入れる。eventRow などの補助を使う）。
// Realtime のチャンネル（channel・removeChannel）は Presence だけをまねる（FakeRealtimeChannel。他の人の出入りは putPeer・removePeer、
// 参加の失敗・切断は emitStatus で起こす）。同じ名前のチャンネルは、removeChannel が終わるまで同じものを返す（supabase-js と同じ）。
// realtime.setAuth（参加の前にトークンを渡す）は呼ばれ方の確認だけ。表の読み取りの range は、max_rows をまねないので ranges で呼び方を確かめる。
// 表の読み取りの or（"列.演算子.値,and(…)" の形。PR-14）は src/test/postgrest-or.ts で読む。
// RPC は register_collaborator・remove_collaborator だけをまねる。ほかの RPC（save_draft など）は、テストで
// `fake.main.rpc.mockResolvedValueOnce(rpcSuccess(…))`・`rpcFailure("FD002")` のように返し方を決める。
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
import { matchesPostgrestOr } from "@/test/postgrest-or";

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

/** events 表の 1 行（DB と同じ列名。日時は PostgREST が返す形の文字列。例 "2026-08-07T03:00:00+00:00"） */
export type FakeEventRow = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  created_by: string;
  created_at: string;
};

/** app_state 表の 1 行（DB には 1 行だけある） */
export type FakeAppStateRow = { id: true; latest_event_id: string | null };

/** drafts 表の 1 行（content は定義の文書。jsonb） */
export type FakeDraftRow = {
  event_id: string;
  version: number;
  content: unknown;
  updated_by: string;
  updated_at: string;
};

/** published_definitions 表の 1 行（content は公開した時点の定義の文書。jsonb） */
export type FakePublishedDefinitionRow = {
  id: string;
  event_id: string;
  version_label: string;
  content: unknown;
  draft_version: number;
  published_by: string;
  published_at: string;
};

/** save_logs 表の 1 行（DB と同じ列名。id は bigint の連番〔PostgREST は数で返す〕、created_at は PostgREST が返す形の文字列） */
export type FakeSaveLogRow = {
  id: number;
  event_id: string;
  user_id: string | null;
  user_name: string;
  kind: "save" | "publish";
  map_label: string | null;
  summary: string;
  created_at: string;
};

/**
 * 偽物のサーバーの中身（Auth のアカウントと表）。テストから直接書き換えてよい。
 * 表の読み取り（from(表)）は、ここの行を返す（RLS はまねない。権限ごとの絞り込みは呼び出し側の責任）
 */
export type FakeSupabaseServer = {
  accounts: FakeAccount[];
  profiles: FakeProfileRow[];
  /** events 表 */
  events: FakeEventRow[];
  /** app_state 表（installFakeSupabase は latest_event_id が null の 1 行を入れる。DB のマイグレーションと同じ） */
  appState: FakeAppStateRow[];
  /** drafts 表 */
  drafts: FakeDraftRow[];
  /** published_definitions 表 */
  publishedDefinitions: FakePublishedDefinitionRow[];
  /** save_logs 表 */
  saveLogs: FakeSaveLogRow[];
};

/** Presence の 1 件（track で送った値に presence_ref が付いたもの。presenceState() の値の要素） */
export type FakePresenceMeta = { readonly presence_ref: string; readonly [key: string]: unknown };

type PresenceListenEvent = "sync" | "join" | "leave" | "*";
type PresenceListener = { event: PresenceListenEvent; callback: (payload?: unknown) => void };

/** Presence の自分の key（channel の設定に config.presence.key がなければこの値） */
export const FAKE_PRESENCE_SELF_KEY_FALLBACK = "fake-self-presence-ref";

function presenceKeyOf(options: unknown): string | null {
  if (!isRecord(options) || !isRecord(options.config) || !isRecord(options.config.presence)) return null;
  const key = options.config.presence.key;
  return typeof key === "string" && key !== "" ? key : null;
}

/**
 * Realtime のチャンネルの偽物（Presence だけ。supabase-js 2.118 の RealtimeChannel の使うところをまねる）。
 * - subscribe(callback)：次のマイクロタスクで参加し、callback("SUBSCRIBED") を呼び、Presence の sync を起こす（参加した時点の状態の受け取り）
 * - track(payload)：自分の値を置き換え、参加中なら join・sync を起こす。参加の前に呼んでもよい（参加したら有効になる。supabase-js も送るのを待つ）
 * - untrack()：自分の値を消し、参加中なら leave・sync を起こす
 * - unsubscribe()：抜ける（以後、どの出来事も起こさない）
 * - presenceState()：key ごとの値の一覧（自分の値も含む。自分の key は channel の設定の config.presence.key）
 * - テストから：putPeer(key, ...payloads) で他の人が入る（タブを 2 つ開いていれば payload を 2 つ）、removePeer(key) で抜ける
 */
export class FakeRealtimeChannel {
  /** channel(name, options) に渡された名前 */
  readonly name: string;
  /** channel(name, options) に渡された設定 */
  readonly options: unknown;
  /** idle：作っただけ、joined：参加中、closed：抜けた */
  state: "idle" | "joined" | "closed" = "idle";
  private readonly listeners: PresenceListener[] = [];
  private readonly peers = new Map<string, FakePresenceMeta[]>();
  private selfMeta: FakePresenceMeta | null = null;
  private refCount = 0;

  /** subscribe に渡された知らせの関数（emitStatus で参加の失敗・切断を知らせるため） */
  private statusCallback: ((status: string, err?: Error) => void) | null = null;

  constructor(name: string, options: unknown) {
    this.name = name;
    this.options = options;
  }

  /**
   * テストから：参加の状態の知らせ（CHANNEL_ERROR・TIMED_OUT・CLOSED）を起こす（supabase-js の subscribe の callback と同じ）。
   * 知らせた後は参加していない状態（closed）になり、以後の出来事を起こさない
   */
  emitStatus(status: "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED"): void {
    this.state = "closed";
    this.statusCallback?.(status, status === "CHANNEL_ERROR" ? new Error("テスト用の参加の失敗") : undefined);
  }

  /** 自分の key（設定の config.presence.key。なければ FAKE_PRESENCE_SELF_KEY_FALLBACK） */
  get selfKey(): string {
    return presenceKeyOf(this.options) ?? FAKE_PRESENCE_SELF_KEY_FALLBACK;
  }

  readonly on = vi.fn<(type: string, filter: { event?: string }, callback: (payload?: unknown) => void) => FakeRealtimeChannel>(
    (type, filter, callback) => {
      const event = filter.event;
      if (type === "presence" && (event === "sync" || event === "join" || event === "leave" || event === "*")) {
        this.listeners.push({ event, callback });
      }
      return this;
    },
  );

  readonly subscribe = vi.fn<(callback?: (status: string, err?: Error) => void) => FakeRealtimeChannel>((callback) => {
    if (this.state !== "idle") return this;
    this.statusCallback = callback ?? null;
    void Promise.resolve().then(() => {
      if (this.state !== "idle") return;
      this.state = "joined";
      callback?.("SUBSCRIBED");
      this.emit("sync");
    });
    return this;
  });

  readonly track = vi.fn<(payload: Record<string, unknown>, opts?: unknown) => Promise<string>>(async (payload) => {
    if (this.state === "closed") return "error";
    this.selfMeta = { ...payload, presence_ref: this.nextRef() };
    if (this.state === "joined") {
      this.emit("join", { key: this.selfKey, newPresences: [this.selfMeta], currentPresences: [] });
      this.emit("sync");
    }
    return "ok";
  });

  readonly untrack = vi.fn<(opts?: unknown) => Promise<string>>(async () => {
    const left = this.selfMeta;
    this.selfMeta = null;
    if (this.state === "joined" && left !== null) {
      this.emit("leave", { key: this.selfKey, leftPresences: [left], currentPresences: [] });
      this.emit("sync");
    }
    return "ok";
  });

  readonly unsubscribe = vi.fn<(timeout?: number) => Promise<string>>(async () => {
    this.state = "closed";
    return "ok";
  });

  readonly presenceState = vi.fn<() => Record<string, FakePresenceMeta[]>>(() => {
    const state: Record<string, FakePresenceMeta[]> = {};
    for (const [key, metas] of this.peers) state[key] = metas.map((meta) => ({ ...meta }));
    if (this.selfMeta !== null) state[this.selfKey] = [...(state[this.selfKey] ?? []), { ...this.selfMeta }];
    return state;
  });

  /** 自分が track で送った値（送った順） */
  trackedPayloads(): Record<string, unknown>[] {
    return this.track.mock.calls.map(([payload]) => payload);
  }

  /** テストから：他の人（key）が入る・値を変える（タブを複数開いていれば payload を複数渡す） */
  putPeer(key: string, ...payloads: Record<string, unknown>[]): void {
    const metas = payloads.map((payload) => ({ ...payload, presence_ref: this.nextRef() }));
    this.peers.set(key, metas);
    this.emit("join", { key, newPresences: metas, currentPresences: [] });
    this.emit("sync");
  }

  /** テストから：他の人（key）が抜ける */
  removePeer(key: string): void {
    const metas = this.peers.get(key) ?? [];
    this.peers.delete(key);
    this.emit("leave", { key, leftPresences: metas, currentPresences: [] });
    this.emit("sync");
  }

  private nextRef(): string {
    this.refCount += 1;
    return `fake-ref-${this.refCount}`;
  }

  private emit(event: "sync" | "join" | "leave", payload?: unknown): void {
    if (this.state !== "joined") return;
    for (const listener of [...this.listeners]) {
      if (listener.event === event || listener.event === "*") listener.callback(event === "sync" ? undefined : { event, ...(payload as object) });
    }
  }
}

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
  /** Realtime のクライアント（使うのは setAuth だけ。参加の前にセッションのトークンを渡す） */
  realtime: { setAuth: Mock<(token?: string | null) => Promise<void>> };
  /**
   * Realtime のチャンネルを作る（作ったものは channels に作った順に入る）。
   * supabase-js と同じく、同じ名前のチャンネルがまだ外されていなければ（removeChannel が終わるまでは）、新しく作らずにそれを返す
   */
  channel: Mock<(name: string, options?: unknown) => FakeRealtimeChannel>;
  /** チャンネルを外す（そのチャンネルの unsubscribe を待ってから、同じ名前で channel を呼べば新しく作るようにする） */
  removeChannel: Mock<(channel: unknown) => Promise<string>>;
  /** このクライアントで作った Realtime のチャンネル（作った順。同じ名前で返し直したものは足さない） */
  channels: FakeRealtimeChannel[];
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

/**
 * RPC が成功したときの結果（data は関数の戻り値。jsonb なら解析した値、uuid なら文字列、void なら null）。
 * `fake.main.rpc.mockResolvedValueOnce(rpcSuccess({ status: "saved", version: 8 }))` のように使う
 */
export function rpcSuccess(data: unknown, status = 200): FakeQueryResult {
  return okResult(data, status);
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
  // 数の列（save_logs.id など）は数として比べる
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  return String(a) < String(b) ? -1 : 1;
}

/**
 * 表の読み取り（from(表).select(...).eq(...).order(...).maybeSingle() など）の偽物。
 * select の列の指定は見ない（行のすべての列を返す）。await すると結果になる。
 * 絞り込みは eq・neq・in・is（null との比較）だけをまねる。返す行は複製（jsonb の列も入れ子まで）なので、書き換えてもサーバーの中身は変わらない
 */
export class FakeQuery implements PromiseLike<FakeQueryResult> {
  private readonly source: () => readonly object[];
  private readonly forced: FakeQueryResult | null;
  private readonly filters: Array<{ column: string; value: unknown }> = [];
  /** eq 以外の絞り込み（neq・in・is） */
  private readonly predicates: Array<(row: Record<string, unknown>) => boolean> = [];
  private readonly orders: Order[] = [];
  private limitCount: number | null = null;
  private mode: "many" | "maybeSingle" | "single" = "many";
  /** range(from, to) に渡された値（呼んだ順。PostgREST の max_rows はまねないので、ページの読み方はこれで確かめる） */
  readonly ranges: Array<readonly [from: number, to: number]> = [];

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

  neq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.predicates.push((row) => values.includes(row[column]));
    return this;
  }

  is(column: string, value: null | boolean): this {
    this.predicates.push((row) => (value === null ? row[column] === null || row[column] === undefined : row[column] === value));
    return this;
  }

  /** or の絞り込み（"条件,条件"。src/test/postgrest-or.ts の読める形。呼んだ順に、どれも当てる） */
  or(filters: string): this {
    this.predicates.push((row) => matchesPostgrestOr(row, filters));
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

  /** 並べた後の from 番目から to 番目まで（両端を含む。0 から数える）だけを返す（supabase-js の range と同じ） */
  range(from: number, to: number): this {
    this.ranges.push([from, to]);
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
    // 通信で受け取る値と同じく、毎回新しい値にする（jsonb の列も入れ子まで複製する）
    let rows = this.source().map((row) => JSON.parse(JSON.stringify(row)) as Record<string, unknown>);
    rows = rows.filter((row) => this.filters.every(({ column, value }) => row[column] === value));
    rows = rows.filter((row) => this.predicates.every((matches) => matches(row)));
    if (this.orders.length > 0) {
      rows.sort((a, b) => {
        for (const { column, ascending } of this.orders) {
          const result = compareValues(a[column], b[column]);
          if (result !== 0) return ascending ? result : -result;
        }
        return 0;
      });
    }
    const lastRange = this.ranges.at(-1);
    if (lastRange !== undefined) rows = rows.slice(lastRange[0], lastRange[1] + 1);
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
  switch (table) {
    case "profiles":
      return server.profiles;
    case "events":
      return server.events;
    case "app_state":
      return server.appState;
    case "drafts":
      return server.drafts;
    case "published_definitions":
      return server.publishedDefinitions;
    case "save_logs":
      return server.saveLogs;
    default:
      return [];
  }
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
  // このクライアントで作った Realtime のチャンネル
  const channels: FakeRealtimeChannel[] = [];
  // まだ外していない（removeChannel が終わっていない）チャンネル
  const activeChannels: FakeRealtimeChannel[] = [];
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
    realtime: { setAuth: vi.fn<(token?: string | null) => Promise<void>>(async () => {}) },
    channel: vi.fn<(name: string, options?: unknown) => FakeRealtimeChannel>((name, options) => {
      // supabase-js と同じく、同じ名前のチャンネルがまだ外されていなければそれを返す（抜けている途中のものも返す）
      const existing = activeChannels.find((candidate) => candidate.name === name);
      if (existing !== undefined) return existing;
      const created = new FakeRealtimeChannel(name, options);
      channels.push(created);
      activeChannels.push(created);
      return created;
    }),
    removeChannel: vi.fn<(channel: unknown) => Promise<string>>(async (target) => {
      if (target instanceof FakeRealtimeChannel) {
        await target.unsubscribe();
        // 抜け終わってから一覧から外す（以後、同じ名前の channel は新しく作る）
        const index = activeChannels.indexOf(target);
        if (index !== -1) activeChannels.splice(index, 1);
      }
      return "ok";
    }),
    channels,
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
  const server: FakeSupabaseServer = {
    accounts: [],
    profiles: [],
    events: [],
    appState: [{ id: true, latest_event_id: null }],
    drafts: [],
    publishedDefinitions: [],
    saveLogs: [],
  };
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

/** events 表の行を作る（指定しない列はテスト用の値） */
export function eventRow(
  row: Pick<FakeEventRow, "id" | "name" | "starts_at"> & Partial<FakeEventRow>,
): FakeEventRow {
  return {
    ends_at: null,
    created_by: "user-admiral",
    created_at: "2026-07-01T03:00:00.000000+00:00",
    ...row,
  };
}

/** drafts 表の行を作る（指定しない列はテスト用の値） */
export function draftRow(
  row: Pick<FakeDraftRow, "event_id" | "version" | "content"> & Partial<FakeDraftRow>,
): FakeDraftRow {
  return {
    updated_by: "user-admiral",
    updated_at: "2026-07-01T03:00:00.000000+00:00",
    ...row,
  };
}

/** published_definitions 表の行を作る（指定しない列はテスト用の値） */
export function publishedDefinitionRow(
  row: Pick<FakePublishedDefinitionRow, "id" | "event_id" | "version_label" | "content" | "published_at"> &
    Partial<FakePublishedDefinitionRow>,
): FakePublishedDefinitionRow {
  return {
    draft_version: 1,
    published_by: "user-admiral",
    ...row,
  };
}

/** save_logs 表の行を作る（指定しない列はテスト用の値：協力者の下書き保存、海域なし） */
export function saveLogRow(
  row: Pick<FakeSaveLogRow, "id" | "event_id" | "user_name" | "summary" | "created_at"> & Partial<FakeSaveLogRow>,
): FakeSaveLogRow {
  return {
    user_id: null,
    kind: "save",
    map_label: null,
    ...row,
  };
}

/** app_state の最新のイベント（latest_event_id）を変える */
export function setLatestEvent(fake: FakeSupabase, eventId: string | null): void {
  fake.server.appState.splice(0, fake.server.appState.length, { id: true, latest_event_id: eventId });
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
    ["realtime.setAuth", client.realtime.setAuth],
    ["channel", client.channel],
    ["removeChannel", client.removeChannel],
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
