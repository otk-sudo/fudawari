import { describe, expect, it } from "vitest";

// IndexedDB の要求（IDBRequest）を Promise にする
function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("単体テストの共通の準備", () => {
  it("IndexedDB に保存した値を読み出せる（fake-indexeddb が有効）", async () => {
    // 準備：ストアを 1 つ持つデータベースを開く
    const openRequest = indexedDB.open("setup-test", 1);
    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore("items");
    };
    const db = await toPromise(openRequest);

    // 実行：値を保存してから読み出す
    const tx = db.transaction("items", "readwrite");
    const store = tx.objectStore("items");
    await toPromise(store.put({ name: "初霜改二" }, "ship-1"));
    const saved = await toPromise(store.get("ship-1"));
    db.close();

    // 検証
    expect(saved).toEqual({ name: "初霜改二" });
  });
});
