import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { resetSupabaseClient } from "@/lib/supabase";
import { createDeferred } from "@/test/deferred";
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
//   （上の 2 つは PR-12b で決まった：名前は "plan-editor:" ＋イベント ID、private、presence の key は利用者の ID。
//    複数のタブは後ろの値〔後から更新した値〕の海域。下の「PR-12b」の describe で確かめる）
//
// PR-12b で変えたこと：海域の送信をまとめる（短い待ちの後に最後の値だけを送る）仕様にしたため、
// 既存の「setArea で表示中の海域を送り直す」は、送るまで少し待てるよう vi.waitFor の待ち時間を 3 秒にした

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

    // 検証（PR-12b：送信をまとめるため、少し待ってから送る）
    await vi.waitFor(
      () => {
        expect(channel.trackedPayloads().at(-1)).toMatchObject({
          userId: ADMIRAL.userId,
          displayName: ADMIRAL.displayName,
          areaName: "E3",
        });
      },
      { timeout: 3000 },
    );
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

  describe("PR-12b：チャンネルの指定・複数のタブ・参加の失敗（レビュー M2・P4）", () => {
    it("チャンネルの名前は \"plan-editor:\" ＋イベント ID、設定は private で、Presence の key は自分の利用者の ID", async () => {
      // 実行
      connect(SUMMER_ID);
      await channelAt(1);

      // 検証
      expect(fake.main.channel).toHaveBeenCalledTimes(1);
      expect(fake.main.channel).toHaveBeenCalledWith(`plan-editor:${SUMMER_ID}`, {
        config: { private: true, presence: { key: ADMIRAL.userId } },
      });
    });

    it("チャンネルを作る前に、ログイン中のセッションのトークンを Realtime に渡す（setAuth）", async () => {
      // 実行
      connect(SUMMER_ID);
      await channelAt(1);

      // 検証
      const setAuth = fake.main.realtime.setAuth;
      expect(setAuth).toHaveBeenCalledWith(`fake-access-token-${ADMIRAL.userId}`);
      const setAuthOrder = setAuth.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
      const channelOrder = fake.main.channel.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY;
      expect(setAuthOrder).toBeLessThan(channelOrder);
    });

    it("同じ人が 2 つのタブで違う海域を表示していたら、後ろの値（後から更新したタブ）の海域を出す", async () => {
      // 準備
      connect(SUMMER_ID);
      const channel = await joinedChannel();

      // 実行
      channel.putPeer("user-akane", peerPayload("user-akane", "あかね", "E2"), peerPayload("user-akane", "あかね", "E3"));

      // 検証
      await vi.waitFor(() => {
        expect(lastPeers()).toEqual([{ userId: "user-akane", displayName: "あかね", areaName: "E3" }]);
      });
    });

    it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"] as const)(
      "参加の状態が %s になったら、表示する人を空にする（誰がいるか分からないため）",
      async (status) => {
        // 準備
        connect(SUMMER_ID);
        const channel = await joinedChannel();
        channel.putPeer("user-akane", peerPayload("user-akane", "あかね", "E3"));
        await vi.waitFor(() => {
          expect(lastPeers()).toHaveLength(1);
        });

        // 実行
        channel.emitStatus(status);

        // 検証
        await vi.waitFor(() => {
          expect(lastPeers()).toEqual([]);
        });
      },
    );
  });

  describe("PR-12b：海域の送信をまとめ、送れなければ送り直す（Codex #21-4301315086）", () => {
    // 偽の時計（タイマーと日時）。参加などの Promise は止めない
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** 送った海域（参加の後の count 件より後） */
    function areasSentAfter(channel: FakeRealtimeChannel, count: number): unknown[] {
      return channel
        .trackedPayloads()
        .slice(count)
        .map((payload) => payload.areaName);
    }

    it("段階を続けて切り替えたら、すぐには送らず、短い待ち（1 秒ほど）の後に最後の海域だけを送る", async () => {
      // 準備
      const connection = connect(SUMMER_ID, "E1");
      const channel = await joinedChannel();
      const sentAtJoin = channel.track.mock.calls.length;

      // 実行：続けて 3 回切り替える
      connection.setArea("E2");
      connection.setArea("E3");
      connection.setArea("E4");
      await vi.advanceTimersByTimeAsync(0);

      // 検証：まだ送らない
      expect(areasSentAfter(channel, sentAtJoin)).toEqual([]);

      // 実行：少し待つ
      await vi.advanceTimersByTimeAsync(2000);

      // 検証：最後の海域だけを 1 回送る
      expect(areasSentAfter(channel, sentAtJoin)).toEqual(["E4"]);
    });

    it("送った値が ok 以外（timed out など）で返ったら、少し後に同じ海域を送り直し、届いたらそれ以上は送らない", async () => {
      // 準備
      const connection = connect(SUMMER_ID, "E1");
      const channel = await joinedChannel();
      const sentAtJoin = channel.track.mock.calls.length;
      channel.track.mockResolvedValueOnce("timed out");

      // 実行
      connection.setArea("E3");
      await vi.advanceTimersByTimeAsync(2000);

      // 検証：1 回目は送った（届かなかった）
      expect(areasSentAfter(channel, sentAtJoin)).toEqual(["E3"]);

      // 実行：しばらく待つ
      await vi.advanceTimersByTimeAsync(15_000);

      // 検証：送り直した
      expect(areasSentAfter(channel, sentAtJoin)).toEqual(["E3", "E3"]);

      // 実行・検証：届いた後は、さらに待っても送らない
      await vi.advanceTimersByTimeAsync(60_000);
      expect(areasSentAfter(channel, sentAtJoin)).toEqual(["E3", "E3"]);
    });

    it("送り直す前に海域が変わっていたら、送り直すのは最新の海域（古い海域は送り直さない）", async () => {
      // 準備
      const connection = connect(SUMMER_ID, "E1");
      const channel = await joinedChannel();
      const sentAtJoin = channel.track.mock.calls.length;
      channel.track.mockResolvedValueOnce("timed out");
      connection.setArea("E3");
      await vi.advanceTimersByTimeAsync(2000);
      expect(areasSentAfter(channel, sentAtJoin)).toEqual(["E3"]);

      // 実行
      connection.setArea("E4");
      await vi.advanceTimersByTimeAsync(15_000);

      // 検証
      const sent = areasSentAfter(channel, sentAtJoin);
      expect(sent.at(-1)).toBe("E4");
      expect(sent.slice(1)).not.toContain("E3");
    });

    it("参加したときの送信が ok 以外で返ったら、少し後に送り直す", async () => {
      // 準備：作られたチャンネルの最初の track を "error" にする
      const original = fake.main.channel.getMockImplementation();
      if (original === undefined) throw new Error("偽物の channel に返し方がありません");
      fake.main.channel.mockImplementationOnce((name, options) => {
        const created = original(name, options);
        created.track.mockResolvedValueOnce("error");
        return created;
      });

      // 実行
      connect(SUMMER_ID, "E1");
      const channel = await joinedChannel();
      expect(channel.track).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15_000);

      // 検証
      expect(channel.track.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(channel.trackedPayloads().at(-1)).toMatchObject({ userId: ADMIRAL.userId, areaName: "E1" });
    });
  });

  describe("PR-12b：同じイベントにすぐつなぎ直したとき（レビュー P1）", () => {
    it("前のチャンネルを外し終わるまで待ってから新しいチャンネルを作って参加し、他の人の出入りを知らせる", async () => {
      // 準備：1 つ目のつなぎ先が参加し、外す処理（removeChannel）は後で終わる
      const first = connect(SUMMER_ID);
      const oldChannel = await joinedChannel(1);
      const release = createDeferred<void>();
      const originalRemove = fake.main.removeChannel.getMockImplementation();
      if (originalRemove === undefined) throw new Error("偽物の removeChannel に返し方がありません");
      fake.main.removeChannel.mockImplementationOnce(async (target) => {
        await release.promise;
        return originalRemove(target);
      });

      // 実行：抜けてすぐ、同じイベントにつなぎ直す
      first.leave();
      connect(SUMMER_ID);
      await settle();

      // 検証：外し終わる前は、新しいチャンネルを作らない（supabase-js は同じ名前の抜けている途中のチャンネルを返すため）
      expect(fake.main.channels).toHaveLength(1);

      // 実行：外し終わる
      release.resolve();

      // 検証：新しいチャンネルを作って参加し、自分の値を送る
      await vi.waitFor(() => {
        expect(fake.main.channels).toHaveLength(2);
      });
      const newChannel = fake.main.channels[1] as FakeRealtimeChannel;
      expect(newChannel).not.toBe(oldChannel);
      await vi.waitFor(() => {
        expect(newChannel.state).toBe("joined");
        expect(newChannel.track).toHaveBeenCalled();
      });
      expect(oldChannel.state).toBe("closed");

      // 検証：新しいチャンネルの出入りを知らせる
      newChannel.putPeer("user-akane", peerPayload("user-akane", "あかね", "E3"));
      await vi.waitFor(() => {
        expect(lastPeers()).toEqual([{ userId: "user-akane", displayName: "あかね", areaName: "E3" }]);
      });
    });
  });
});
