import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { resetSupabaseClient } from "@/lib/supabase";
import {
  addManager,
  type FakeRealtimeChannel,
  type FakeSupabase,
  installFakeSupabase,
  stubSupabaseEnv,
} from "@/test/supabase-fake";
import { connectSupabasePresence } from "./supabase-presence";
import type { PresenceConnection, PresencePeer } from "./types";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// 編集中の表示の Supabase Realtime（Presence）の実装（connectSupabasePresence。docs/design/database.md 5 章、roadmap T3-9）
// - チャンネルはイベントごと（名前にイベント ID を含め、イベントが違えば名前も違う）
// - 参加したら、自分の profile の ID（ログイン中の Auth の利用者の ID）・表示名・表示中の海域を track で送る
//   （送る値のキーは userId・displayName・areaName。ほかのブラウザの同じ実装が読む形なので、ここで決める）
// - 他の人の出入り・値の変化で onPeersChange を呼ぶ。自分（同じ userId。別のタブを含む）は含めず、同じ人は 1 件にする
// - setArea で表示中の海域を送り直す。leave で抜ける（つなぎ終わる前に呼ばれても、後で必ず抜ける）
//
// テストで決めていないこと（親が決める）
// - チャンネル名の前置き（例 "plan-editor:"）、private チャンネル（Realtime Authorization）にするか
// - 同じ人が複数のタブで違う海域を表示しているときに、どの海域を出すか

const ADMIRAL = {
  loginId: "admiral",
  password: "admiral-pass-0001",
  userId: "user-admiral",
  displayName: "提督",
  role: "admin",
} as const;

const SUMMER_ID = "2026-summer";
const AUTUMN_ID = "2026-autumn";

/** 他の人の値（他のブラウザの同じ実装が送る形） */
function peerPayload(userId: string, displayName: string, areaName: string | null): Record<string, unknown> {
  return { userId, displayName, areaName };
}

/** 裏で進む処理（セッションの確認・参加）を待つ */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("編集中の表示の Supabase の実装（connectSupabasePresence）", () => {
  let fake: FakeSupabase;
  let onPeersChange: Mock<(peers: readonly PresencePeer[]) => void>;
  let connections: PresenceConnection[];

  /** つなぐ（表示名は提督。後片付けのために覚えておく） */
  function connect(eventId: string, areaName: string | null = "E1"): PresenceConnection {
    const connection = connectSupabasePresence({ eventId, displayName: ADMIRAL.displayName, areaName, onPeersChange });
    connections.push(connection);
    return connection;
  }

  /** n 番目（1 から数える）に作られたチャンネル（作られるまで待つ） */
  async function channelAt(nth = 1): Promise<FakeRealtimeChannel> {
    await vi.waitFor(() => {
      expect(fake.main.channels.length).toBeGreaterThanOrEqual(nth);
    });
    return fake.main.channels[nth - 1] as FakeRealtimeChannel;
  }

  /** チャンネルに参加し、自分の値を送り終わるまで待つ */
  async function joinedChannel(nth = 1): Promise<FakeRealtimeChannel> {
    const channel = await channelAt(nth);
    await vi.waitFor(() => {
      expect(channel.state).toBe("joined");
      expect(channel.track).toHaveBeenCalled();
    });
    return channel;
  }

  /** 最後に onPeersChange に渡された人 */
  function lastPeers(): readonly PresencePeer[] {
    const last = onPeersChange.mock.calls.at(-1);
    if (last === undefined) throw new Error("onPeersChange がまだ呼ばれていません");
    return last[0];
  }

  beforeEach(async () => {
    fake = installFakeSupabase();
    stubSupabaseEnv();
    resetSupabaseClient();
    addManager(fake, ADMIRAL);
    // ログインしている（このクライアントのセッションに提督が入る）
    await fake.main.auth.signInWithPassword({ email: `${ADMIRAL.loginId}@fudawari.invalid`, password: ADMIRAL.password });
    onPeersChange = vi.fn<(peers: readonly PresencePeer[]) => void>();
    connections = [];
  });

  afterEach(() => {
    for (const connection of connections) connection.leave();
    vi.unstubAllEnvs();
  });

  it("チャンネルはイベントごと：名前にイベント ID を含み、イベントが違えば名前も違う", async () => {
    // 実行
    connect(SUMMER_ID);
    const summer = await channelAt(1);
    connect(AUTUMN_ID);
    const autumn = await channelAt(2);

    // 検証
    expect(summer.name).toContain(SUMMER_ID);
    expect(autumn.name).toContain(AUTUMN_ID);
    expect(summer.name).not.toBe(autumn.name);
  });

  it("参加したら、自分の profile の ID・表示名・表示中の海域を送る", async () => {
    // 実行
    connect(SUMMER_ID, "E1");
    const channel = await joinedChannel();

    // 検証
    expect(channel.subscribe).toHaveBeenCalled();
    expect(channel.trackedPayloads().at(-1)).toMatchObject({
      userId: ADMIRAL.userId,
      displayName: ADMIRAL.displayName,
      areaName: "E1",
    });
  });

  it("他の人が入ると、その人（ID・表示名・表示中の海域）を渡し、自分は含めない", async () => {
    // 準備
    connect(SUMMER_ID);
    const channel = await joinedChannel();

    // 実行
    channel.putPeer("user-akane", peerPayload("user-akane", "あかね", "E3"));

    // 検証
    await vi.waitFor(() => {
      expect(lastPeers()).toEqual([{ userId: "user-akane", displayName: "あかね", areaName: "E3" }]);
    });
  });

  it("他の人が抜けると、その人を除いて渡す（誰もいなければ空）", async () => {
    // 準備
    connect(SUMMER_ID);
    const channel = await joinedChannel();
    channel.putPeer("user-akane", peerPayload("user-akane", "あかね", "E3"));
    await vi.waitFor(() => {
      expect(lastPeers()).toHaveLength(1);
    });

    // 実行
    channel.removePeer("user-akane");

    // 検証
    await vi.waitFor(() => {
      expect(lastPeers()).toEqual([]);
    });
  });

  it("2 人が入ると 2 人とも渡す", async () => {
    // 準備
    connect(SUMMER_ID);
    const channel = await joinedChannel();

    // 実行
    channel.putPeer("user-akane", peerPayload("user-akane", "あかね", "E3"));
    channel.putPeer("user-b", peerPayload("user-b", "協力者B", "E2"));

    // 検証（並びはここでは決めない）
    await vi.waitFor(() => {
      expect(lastPeers()).toHaveLength(2);
    });
    expect(lastPeers()).toEqual(
      expect.arrayContaining([
        { userId: "user-akane", displayName: "あかね", areaName: "E3" },
        { userId: "user-b", displayName: "協力者B", areaName: "E2" },
      ]),
    );
  });

  it("同じ人が 2 つのタブで開いていても 1 件にする", async () => {
    // 準備
    connect(SUMMER_ID);
    const channel = await joinedChannel();

    // 実行
    channel.putPeer("user-akane", peerPayload("user-akane", "あかね", "E2"), peerPayload("user-akane", "あかね", "E3"));

    // 検証
    await vi.waitFor(() => {
      expect(lastPeers()).toHaveLength(1);
    });
    expect(lastPeers()[0]).toMatchObject({ userId: "user-akane", displayName: "あかね" });
  });

  it("自分が別のタブで開いていても、自分は含めない", async () => {
    // 準備
    connect(SUMMER_ID);
    const channel = await joinedChannel();

    // 実行：自分（同じ userId）の別のタブが入る
    channel.putPeer(ADMIRAL.userId, peerPayload(ADMIRAL.userId, ADMIRAL.displayName, "E2"));
    channel.putPeer("user-akane", peerPayload("user-akane", "あかね", "E3"));

    // 検証
    await vi.waitFor(() => {
      expect(lastPeers()).toEqual([{ userId: "user-akane", displayName: "あかね", areaName: "E3" }]);
    });
  });

  it("setArea で表示中の海域を送り直す（ID・表示名はそのまま）", async () => {
    // 準備
    const connection = connect(SUMMER_ID, "E1");
    const channel = await joinedChannel();

    // 実行
    connection.setArea("E3");

    // 検証
    await vi.waitFor(() => {
      expect(channel.trackedPayloads().at(-1)).toMatchObject({
        userId: ADMIRAL.userId,
        displayName: ADMIRAL.displayName,
        areaName: "E3",
      });
    });
  });

  it("leave で抜け（チャンネルから外れ）、その後に他の人が入っても知らせない", async () => {
    // 準備
    const connection = connect(SUMMER_ID);
    const channel = await joinedChannel();
    const callsBeforeLeave = onPeersChange.mock.calls.length;

    // 実行
    connection.leave();
    await settle();
    channel.putPeer("user-akane", peerPayload("user-akane", "あかね", "E3"));
    await settle();

    // 検証
    expect(channel.unsubscribe).toHaveBeenCalled();
    expect(channel.state).toBe("closed");
    expect(onPeersChange.mock.calls.length).toBe(callsBeforeLeave);
  });

  it("つなぎ終わる前に leave しても、後で参加したままにならない", async () => {
    // 実行：つないですぐ抜ける（セッションの確認・参加の前）
    const connection = connect(SUMMER_ID);
    connection.leave();
    await settle();

    // 検証：チャンネルを作っていないか、作っていても抜けている
    for (const channel of fake.main.channels) {
      expect(channel.state).not.toBe("joined");
    }
  });
});
