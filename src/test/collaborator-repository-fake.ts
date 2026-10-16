// 協力者の保管庫（CollaboratorRepository）の偽物。協力者画面のテストで、DB の代わりに渡す
//
// - 中身（members）を持ち、一覧・発行・外すでその中身を読み書きする（画面が発行・外したあとに一覧を読み直しても、手元で表を書き換えても通る）
// - 各操作は vi.fn。失敗の場面は `fake.issue.mockResolvedValueOnce({ ok: false, error: "id-taken" })` のように差し替える
// - checkSession（Supabase のセッションがあるか）は、既定ではある（{ ok: true, value: true }）
import { type Mock, vi } from "vitest";
import type { Collaborator, CollaboratorRepository } from "@/features/collaborators";

export type FakeCollaboratorRepository = {
  /** 画面に渡す保管庫 */
  repository: CollaboratorRepository;
  list: Mock<CollaboratorRepository["list"]>;
  issue: Mock<CollaboratorRepository["issue"]>;
  remove: Mock<CollaboratorRepository["remove"]>;
  checkSession: Mock<NonNullable<CollaboratorRepository["checkSession"]>>;
  /** 今の中身（発行・外すで変わる） */
  members: Collaborator[];
};

/** 発行したときに作る協力者の user ID（1 人目は "issued-user-1"） */
export function issuedUserId(n: number): string {
  return `issued-user-${n}`;
}

export function createFakeCollaboratorRepository(
  initial: readonly Collaborator[],
): FakeCollaboratorRepository {
  const members = initial.map((member) => ({ ...member }));
  let issuedCount = 0;

  const list = vi.fn<CollaboratorRepository["list"]>(async () => ({
    ok: true,
    value: members.map((member) => ({ ...member })),
  }));

  const issue = vi.fn<CollaboratorRepository["issue"]>(async ({ displayName }) => {
    issuedCount += 1;
    const userId = issuedUserId(issuedCount);
    members.push({
      userId,
      displayName,
      role: "collab",
      createdAt: new Date().toISOString(),
      lastEditedAt: null,
      lastEditedNote: null,
    });
    return { ok: true, value: { userId } };
  });

  const remove = vi.fn<CollaboratorRepository["remove"]>(async (userId) => {
    const index = members.findIndex((member) => member.userId === userId);
    if (index === -1) return { ok: false, error: "not-found" };
    if (members[index].role === "admin") return { ok: false, error: "cannot-remove-admin" };
    members.splice(index, 1);
    return { ok: true, value: undefined };
  });

  const checkSession = vi.fn<NonNullable<CollaboratorRepository["checkSession"]>>(async () => ({
    ok: true,
    value: true,
  }));

  return {
    repository: { list, issue, remove, checkSession },
    list,
    issue,
    remove,
    checkSession,
    members,
  };
}
