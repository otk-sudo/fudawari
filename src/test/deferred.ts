// 結果を後から決める Promise（読み込み中・送信中の状態を確かめるテストで使う）

export type Deferred<T> = {
  promise: Promise<T>;
  /** 成功で終える */
  resolve: (value: T) => void;
  /** 失敗で終える */
  reject: (reason: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
