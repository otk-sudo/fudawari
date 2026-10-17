// ホームの最終取り込みと、設定での削除の競合（PR-14b、Codex の指摘 4301989968）
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useMemo } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { SettingsDialog } from "@/components/SettingsDialog";
import { closeSettingsDialog, openSettingsDialog } from "@/components/settings-dialog-store";
import { setRole } from "@/features/auth";
import { SettingsContent } from "@/features/settings";
import { resetLatestDefinitionCache, useLatestDefinition } from "@/lib/definition";
import { type PlanData, resetPlanDataCache, usePlanData } from "@/lib/plan";
import { respondWithDefinition, stubFetch } from "@/test/definition-fetch";
import { summer2026Ships } from "@/test/fixtures";
import { cleanupTestStorages, holdableStorage, importInput, openTestStorage } from "@/test/plan-storage";

const IMPORTED_AT = new Date(2026, 9, 15, 20, 40).toISOString();
const LAST_IMPORT = /最終取り込み\s*10\/15\s+20:40/;

let plan: PlanData | null = null;

function PlanProbe(): ReactNode {
  const state = useLatestDefinition();
  const definition = state.status === "success" ? state.definition : null;
  const fudaIds = useMemo(() => definition?.fudas.map((fuda) => fuda.id) ?? [], [definition]);
  plan = usePlanData(definition?.event.id ?? null, fudaIds);
  return <p>{`probe:${plan.status}`}</p>;
}

function getHomeHeader(): HTMLElement {
  const header = screen.getByRole("heading", { level: 1, name: "札割りプランナー" }).closest("header");
  if (header === null) throw new Error("no header");
  return header;
}

beforeEach(() => {
  resetLatestDefinitionCache();
  setRole("user");
  respondWithDefinition(stubFetch());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T12:00:00+09:00"));
});

afterEach(async () => {
  closeSettingsDialog();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetLatestDefinitionCache();
  resetPlanDataCache();
  await cleanupTestStorages();
});

it("割り当ての保存が列に残っている間に削除を確定してすぐ閉じても、削除が終わればホームの最終取り込みは消える", async () => {
  const real = openTestStorage("home-delete-race").storage;
  const holdable = holdableStorage(real);
  resetPlanDataCache({ storage: holdable.storage });
  await real.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));
  const user = userEvent.setup();
  render(
    <>
      <HomePage />
      <SettingsDialog>
        <SettingsContent />
      </SettingsDialog>
      <PlanProbe />
    </>,
  );
  await waitFor(() => expect(getHomeHeader()).toHaveTextContent(LAST_IMPORT));
  expect(await screen.findByText("probe:ready")).toBeInTheDocument();

  act(() => {
    openSettingsDialog();
  });
  const dialog = await screen.findByRole("dialog", { name: "設定" });
  await waitFor(() => expect(dialog).toHaveTextContent(LAST_IMPORT));

  // 割り当ての保存を 1 つ列に入れて止める（札割りの読み込みなどで起きる）
  const held = holdable.holdSaveAssignments();
  act(() => {
    void plan?.setAssignments({});
  });
  await held.reached;

  // 削除を確定する（列の後ろに並ぶ）→ すぐ閉じる
  await user.click(within(dialog).getByRole("button", { name: "削除する" }));
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "削除する" }));
  act(() => {
    closeSettingsDialog();
  });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "設定" })).not.toBeInTheDocument());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  // 保存を続けると、削除が終わる
  held.release();
  await waitFor(async () => expect(await real.loadLastImport()).toBeNull());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  // 検証：削除の後に読み直しているので、最終取り込みは消える
  expect(holdable.calls.join(",")).toContain("clearImportedShips");
  expect(getHomeHeader()).not.toHaveTextContent(/最終取り込み/);
});
