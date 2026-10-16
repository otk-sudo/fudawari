import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Role, setRole } from "@/features/auth";
import {
  type Collaborator,
  type CollaboratorError,
  CollaboratorsScreen,
} from "@/features/collaborators";
import {
  createFakeCollaboratorRepository,
  type FakeCollaboratorRepository,
} from "@/test/collaborator-repository-fake";
import { expectInDocumentOrder } from "@/test/dom-order";

// 協力者画面の本文（要件 3.8、モック Collaborators.dc.html。招待の欄は「協力者を追加」に置き換える）
// - 管理者以外：「このページは管理者のみ使えます」「協力者の追加や削除は管理者にお願いしてください」「一覧に戻る」
// - 編集できる人（表）：名前・権限・追加した日・権限の期限（無期限）・最後に定義を編集・「外す」（管理者の行には出さない）
// - 協力者を追加：ID と表示名を入れて「発行する」。パスワードは画面が作る（英数字 16 文字）。発行後は ID とパスワード、「コピー」、注意書き
// - 外す：確認（チェックを入れるまで「外す」を押せない、「やめる」）
// DB とのやりとりは保管庫（偽物）に任せる。Supabase の実装は supabase-repository.test.ts、画面全体は src/app/collaborators/page.test.tsx

/** 管理者。追加した日は日本時間で 2026/07/01（UTC では 06/30）、最後の編集は日本時間で 10/15 */
const ADMIRAL: Collaborator = {
  userId: "user-admiral",
  displayName: "提督",
  role: "admin",
  createdAt: "2026-06-30T15:10:00.000Z",
  lastEditedAt: "2026-10-15T12:40:00.000Z",
  lastEditedNote: "公開",
};

/** 協力者。追加した日は日本時間で 2026/07/10（UTC では 07/09）、最後の編集は日本時間で 08/04（UTC では 08/03） */
const AKANE: Collaborator = {
  userId: "user-akane",
  displayName: "あかね",
  role: "collab",
  createdAt: "2026-07-09T16:30:00.000Z",
  lastEditedAt: "2026-08-03T15:30:00.000Z",
  lastEditedNote: "下書きを保存",
};

/** まだ定義を編集していない協力者 */
const MIDORI: Collaborator = {
  userId: "user-midori",
  displayName: "みどり",
  role: "collab",
  createdAt: "2026-07-22T01:00:00.000Z",
  lastEditedAt: null,
  lastEditedNote: null,
};

const MEMBERS: readonly Collaborator[] = [ADMIRAL, AKANE, MIDORI];

const ALPHANUMERIC_16 = /^[A-Za-z0-9]{16}$/;

/** ID の形式の理由の要点（要件 3.8：英小文字・数字・ハイフン、3〜32 文字） */
const ID_RULE_MESSAGES = [/英小文字・数字・ハイフン/, /3〜32/] as const;

/** 発行後に出す注意書き */
const ONE_TIME_NOTICE = /パスワードはこの画面を閉じると二度と表示できません/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 権限を決め、偽物の保管庫を渡して協力者画面を描く（prepare で描く前に保管庫の返し方を変えられる） */
function renderScreen(
  role: Role,
  members: readonly Collaborator[] = MEMBERS,
  prepare?: (fake: FakeCollaboratorRepository) => void,
): FakeCollaboratorRepository {
  setRole(role);
  const fake = createFakeCollaboratorRepository(members);
  prepare?.(fake);
  render(<CollaboratorsScreen repository={fake.repository} />);
  return fake;
}

/** 表の行を名前で探す（行の名前は、中のセルの文字をつなげたもの） */
function findRow(name: string): Promise<HTMLElement> {
  return screen.findByRole("row", { name: new RegExp(escapeRegExp(name)) });
}

function getRow(name: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(escapeRegExp(name)) });
}

function queryRow(name: string): HTMLElement | null {
  return screen.queryByRole("row", { name: new RegExp(escapeRegExp(name)) });
}

function idInput(): HTMLElement {
  return screen.getByRole("textbox", { name: /^ID/ });
}

function displayNameInput(): HTMLElement {
  return screen.getByRole("textbox", { name: /^表示名/ });
}

/** 「協力者を追加」の欄が出るまで待つ */
async function waitForIssueForm(): Promise<void> {
  await screen.findByRole("heading", { name: "協力者を追加" });
}

/** ID と表示名を入れて「発行する」を押す（空の文字列なら入れない） */
async function issue(user: UserEvent, loginId: string, displayName: string): Promise<void> {
  if (loginId !== "") await user.type(idInput(), loginId);
  if (displayName !== "") await user.type(displayNameInput(), displayName);
  await user.click(screen.getByRole("button", { name: "発行する" }));
}

/** value を画面に出している部品（文字として、または入力欄の値として）。exclude の部品は数えない */
function elementsShowing(value: string, exclude: readonly Element[] = []): Element[] {
  const texts = screen.queryAllByText(new RegExp(escapeRegExp(value)));
  const fields = Array.from(document.querySelectorAll("input, textarea")).filter(
    (field) =>
      (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
      field.value === value,
  );
  return [...texts, ...fields].filter((element) => !exclude.includes(element));
}

/** 保管庫に渡したパスワード（1 回目の発行） */
function issuedPassword(fake: FakeCollaboratorRepository): string {
  const password = fake.issue.mock.calls[0]?.[0].password;
  expect(password).toMatch(ALPHANUMERIC_16);
  return password ?? "";
}

/** 行の「外す」を押して、外すときの確認を開く */
async function openRemoveConfirm(user: UserEvent, name: string): Promise<HTMLElement> {
  const row = await findRow(name);
  await user.click(within(row).getByRole("button", { name: /外す/ }));
  return screen.findByRole("alertdialog");
}

function confirmCheckbox(dialog: HTMLElement, name: string): HTMLElement {
  return within(dialog).getByRole("checkbox", {
    name: new RegExp(`${escapeRegExp(name)}\\s*を外すことを確認しました`),
  });
}

describe("協力者画面の本文（CollaboratorsScreen）", () => {
  beforeEach(() => {
    setRole("user");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("管理者以外", () => {
    it.each<Role>(["user", "collab"])(
      "権限が %s なら「このページは管理者のみ使えます」「協力者の追加や削除は管理者にお願いしてください」「一覧に戻る」（/list）だけを出し、保管庫を呼ばない",
      async (role) => {
        // 準備・実行
        const fake = renderScreen(role);

        // 検証
        expect(await screen.findByText("このページは管理者のみ使えます")).toBeInTheDocument();
        expect(screen.getByText("協力者の追加や削除は管理者にお願いしてください")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "一覧に戻る" })).toHaveAttribute("href", "/list");
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "発行する" })).not.toBeInTheDocument();
        expect(fake.list).not.toHaveBeenCalled();
      },
    );

    it("管理者には拒否の表示を出さない", async () => {
      // 準備・実行
      renderScreen("admin");

      // 検証：表が出てから、拒否の文がないことを見る
      expect(await findRow("提督")).toBeInTheDocument();
      expect(screen.queryByText("このページは管理者のみ使えます")).not.toBeInTheDocument();
    });
  });

  describe("編集できる人（表）", () => {
    it("見出し「編集できる人」と人数「3人」、列の見出し（名前・権限・追加した日・権限の期限・最後に定義を編集）を出す", async () => {
      // 準備・実行
      const fake = renderScreen("admin");

      // 検証
      expect(await screen.findByRole("heading", { name: "編集できる人" })).toBeInTheDocument();
      expect(await screen.findByText("3人")).toBeInTheDocument();
      for (const name of ["名前", "権限", "追加した日", "権限の期限", "最後に定義を編集"]) {
        expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
      }
      expect(fake.list).toHaveBeenCalled();
    });

    it("各行に、名前・権限・追加した日（日本時間の 年/月/日）・「無期限」・最後に定義を編集（日本時間の 月/日（内容））を出す", async () => {
      // 準備・実行
      renderScreen("admin");

      // 検証：管理者
      const admiral = await findRow("提督");
      expect(within(admiral).getByText("管理者")).toBeInTheDocument();
      expect(admiral).toHaveTextContent("2026/07/01");
      expect(within(admiral).getByText("無期限")).toBeInTheDocument();
      expect(admiral).toHaveTextContent("10/15（公開）");

      // 検証：協力者
      const akane = getRow("あかね");
      expect(within(akane).getByText("協力者")).toBeInTheDocument();
      expect(akane).toHaveTextContent("2026/07/10");
      expect(within(akane).getByText("無期限")).toBeInTheDocument();
      expect(akane).toHaveTextContent("08/04（下書きを保存）");

      // 検証：まだ定義を編集していない協力者は「—」
      const midori = getRow("みどり");
      expect(within(midori).getByText("協力者")).toBeInTheDocument();
      expect(midori).toHaveTextContent("2026/07/22");
      expect(within(midori).getByText("無期限")).toBeInTheDocument();
      expect(within(midori).getByText("—")).toBeInTheDocument();
    });

    it("管理者を先に、協力者は追加した日の古い順に並べる", async () => {
      // 準備・実行：保管庫はばらばらの順で返す
      renderScreen("admin", [MIDORI, ADMIRAL, AKANE]);

      // 検証
      expectInDocumentOrder([await findRow("提督"), getRow("あかね"), getRow("みどり")]);
    });

    it("協力者の行には「外す」があり、管理者の行にはない", async () => {
      // 準備・実行
      renderScreen("admin");

      // 検証
      const admiral = await findRow("提督");
      expect(within(admiral).queryByRole("button", { name: /外す/ })).not.toBeInTheDocument();
      expect(within(getRow("あかね")).getByRole("button", { name: /外す/ })).toBeInTheDocument();
      expect(within(getRow("みどり")).getByRole("button", { name: /外す/ })).toBeInTheDocument();
    });

    it("一覧を読めなければ、読み込めなかったことを出す", async () => {
      // 準備・実行
      renderScreen("admin", MEMBERS, (fake) => {
        fake.list.mockResolvedValueOnce({ ok: false, error: "network" });
      });

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent(/読み込めませんでした/);
    });
  });

  describe("協力者を追加（ID とパスワードの発行）", () => {
    it("見出し「協力者を追加」と説明、ID・表示名の欄、「発行する」ボタンがある（招待の欄はない）", async () => {
      // 準備・実行
      renderScreen("admin");

      // 検証
      await waitForIssueForm();
      expect(screen.getByText(/ID\s*とパスワードを発行/)).toBeInTheDocument();
      expect(idInput()).toBeInTheDocument();
      expect(displayNameInput()).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "発行する" })).toBeInTheDocument();
      expect(screen.queryByText(/招待/)).not.toBeInTheDocument();
    });

    it("ID と表示名を入れて「発行する」を押すと、画面が作った英数字 16 文字のパスワードと一緒に保管庫へ渡す", async () => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin");
      await waitForIssueForm();

      // 実行
      await issue(user, "hanako-2", "花子");

      // 検証
      await waitFor(() => expect(fake.issue).toHaveBeenCalledTimes(1));
      expect(fake.issue).toHaveBeenCalledWith({
        loginId: "hanako-2",
        displayName: "花子",
        password: expect.stringMatching(ALPHANUMERIC_16),
      });
    });

    it("発行できたら、ID とパスワード、「パスワードはこの画面を閉じると二度と表示できません」を出し、表に加える", async () => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin");
      await waitForIssueForm();
      await findRow("提督");
      const typedIdInput = idInput();

      // 実行
      await issue(user, "hanako-2", "花子");

      // 検証：ID とパスワードと注意書き（ID は入力した欄とは別のところに出す）
      expect(await screen.findByText(ONE_TIME_NOTICE)).toBeInTheDocument();
      const password = issuedPassword(fake);
      expect(elementsShowing(password)).not.toEqual([]);
      expect(elementsShowing("hanako-2", [typedIdInput])).not.toEqual([]);

      // 検証：表に加わる
      const row = await findRow("花子");
      expect(within(row).getByText("協力者")).toBeInTheDocument();
      expect(within(row).getByText("無期限")).toBeInTheDocument();
      expect(await screen.findByText("4人")).toBeInTheDocument();
    });

    it("「コピー」を押すと、発行した ID とパスワードをクリップボードに書き込む", async () => {
      // 準備（userEvent.setup がクリップボードの偽物を用意するので、その後で見張る）
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, "writeText");
      const fake = renderScreen("admin");
      await waitForIssueForm();
      await issue(user, "hanako-2", "花子");
      await screen.findByText(ONE_TIME_NOTICE);
      const password = issuedPassword(fake);

      // 実行：「コピー」をすべて押す（ID とパスワードを 1 つで写しても、別々に写してもよい）
      const copyButtons = screen.getAllByRole("button", { name: /コピー/ });
      for (const button of copyButtons) {
        await user.click(button);
      }

      // 検証
      const copied = writeText.mock.calls.map(([text]) => text).join("\n");
      expect(copied).toContain("hanako-2");
      expect(copied).toContain(password);
    });

    it.each([
      ["2 文字", "ab"],
      ["英大文字を含む", "Hanako"],
      ["下線を含む", "hanako_2"],
    ])("ID の形式が違えば（%s）、理由（英小文字・数字・ハイフンの 3〜32 文字）を出し、保管庫に渡さない", async (_label, loginId) => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin");
      await waitForIssueForm();

      // 実行
      await issue(user, loginId, "花子");

      // 検証
      const alert = await screen.findByRole("alert");
      for (const message of ID_RULE_MESSAGES) {
        expect(alert).toHaveTextContent(message);
      }
      expect(fake.issue).not.toHaveBeenCalled();
    });

    it.each([
      ["空", ""],
      ["空白だけ", "   "],
    ])("表示名が%sなら、理由（表示名を入れてください）を出し、保管庫に渡さない", async (_label, displayName) => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin");
      await waitForIssueForm();

      // 実行
      await issue(user, "hanako-2", displayName);

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent(/表示名を入れてください/);
      expect(fake.issue).not.toHaveBeenCalled();
    });

    it.each<[CollaboratorError, RegExp]>([
      ["id-taken", /すでに使われてい/],
      ["already-registered", /すでに定義を編集できる権限があります/],
      ["invalid-input", /入力が正しくありません/],
      ["forbidden", /権限がありません/],
      ["network", /通信に失敗/],
    ])("保管庫が %s を返したら理由（%s）を出し、パスワードは出さず、表も変えない", async (error, message) => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin", MEMBERS, (f) => {
        f.issue.mockResolvedValueOnce({ ok: false, error });
      });
      await waitForIssueForm();
      await findRow("提督");

      // 実行
      await issue(user, "hanako-2", "花子");

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(fake.issue).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(ONE_TIME_NOTICE)).not.toBeInTheDocument();
      expect(queryRow("花子")).not.toBeInTheDocument();
    });
  });

  describe("外す", () => {
    it("「外す」を押すと確認を出す（名前と説明、確認のチェック。チェックを入れるまで「外す」は押せない）", async () => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin");

      // 実行
      const dialog = await openRemoveConfirm(user, "あかね");

      // 検証
      expect(dialog).toHaveTextContent(/あかね\s*を協力者から外しますか？/);
      expect(dialog).toHaveTextContent(/外すとすぐにイベント定義を編集できなくなります/);
      expect(dialog).toHaveTextContent(/これまでの編集内容は残ります/);
      expect(dialog).toHaveTextContent(/新しく\s*ID\s*を発行してください/);
      expect(confirmCheckbox(dialog, "あかね")).not.toBeChecked();
      expect(within(dialog).getByRole("button", { name: /外す/ })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "やめる" })).toBeEnabled();
      expect(fake.remove).not.toHaveBeenCalled();
    });

    it("確認のチェックを入れると「外す」を押せるようになり、押すと保管庫で外して表から消し、確認を閉じる", async () => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin");
      const dialog = await openRemoveConfirm(user, "あかね");

      // 実行
      await user.click(confirmCheckbox(dialog, "あかね"));
      const removeButton = within(dialog).getByRole("button", { name: /外す/ });
      expect(removeButton).toBeEnabled();
      await user.click(removeButton);

      // 検証
      await waitFor(() => expect(fake.remove).toHaveBeenCalledWith("user-akane"));
      await waitFor(() => expect(queryRow("あかね")).not.toBeInTheDocument());
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(getRow("みどり")).toBeInTheDocument();
      expect(await screen.findByText("2人")).toBeInTheDocument();
    });

    it("チェックを入れずに「外す」を押しても外さない", async () => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin");
      const dialog = await openRemoveConfirm(user, "あかね");

      // 実行
      await user.click(within(dialog).getByRole("button", { name: /外す/ }));

      // 検証
      expect(fake.remove).not.toHaveBeenCalled();
      expect(getRow("あかね")).toBeInTheDocument();
    });

    it("「やめる」を押すと確認を閉じ、外さない", async () => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin");
      const dialog = await openRemoveConfirm(user, "あかね");

      // 実行
      await user.click(within(dialog).getByRole("button", { name: "やめる" }));

      // 検証
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(fake.remove).not.toHaveBeenCalled();
      expect(getRow("あかね")).toBeInTheDocument();
    });

    it.each<[CollaboratorError, RegExp]>([
      ["cannot-remove-admin", /管理者は外せません/],
      ["forbidden", /権限がありません/],
      ["network", /通信に失敗/],
    ])("外せなかったら（%s）理由（%s）を出し、表に残す", async (error, message) => {
      // 準備
      const user = userEvent.setup();
      const fake = renderScreen("admin", MEMBERS, (f) => {
        f.remove.mockResolvedValueOnce({ ok: false, error });
      });
      const dialog = await openRemoveConfirm(user, "あかね");
      await user.click(confirmCheckbox(dialog, "あかね"));

      // 実行
      await user.click(within(dialog).getByRole("button", { name: /外す/ }));

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(fake.remove).toHaveBeenCalledWith("user-akane");
      expect(getRow("あかね")).toBeInTheDocument();
    });
  });
});
