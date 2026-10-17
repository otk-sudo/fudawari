// 画像で保存（src/features/export-image）のテストで使う、ブラウザの機能の偽物
//
// jsdom にはないか、動かないブラウザの機能を、テストの間だけ差し込む。どれも外部との境界（フォント・クリップボード・ダウンロード）。
// - installDocumentFonts()：document.fonts（FontFaceSet）。ready・load の終わりを後から決められる（フォントを待ってから描画するかを確かめる）
// - installClipboard()：navigator.clipboard と ClipboardItem。対応している／いないブラウザを作り分ける
// - recordDownloads()：a 要素の click によるダウンロード（download 属性と href）を記録し、URL.createObjectURL を差し替える
// - pngBlob()：PNG の頭（シグネチャ）だけを持つ Blob（modern-screenshot の domToBlob の差し替えの戻り値に使う）
//
// 後片付け：テストの afterEach で restoreBrowserFakes() と vi.restoreAllMocks()・vi.unstubAllGlobals() を呼ぶ。
import { type Mock, type MockInstance, vi } from "vitest";

// ---- PNG ----

/** PNG のシグネチャ（ファイルの先頭 8 バイト） */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG の頭だけを持つ Blob（type は image/png。呼ぶたびに別の Blob を作る） */
export function pngBlob(): Blob {
  return new Blob([new Uint8Array(PNG_SIGNATURE)], { type: "image/png" });
}

// ---- 差し込んだものの後片付け ----

/** restoreBrowserFakes で戻す処理（差し込んだ順） */
const restorers: (() => void)[] = [];

/** このファイルの関数で差し込んだもの（document.fonts・navigator.clipboard・ダウンロードの記録）を元に戻す */
export function restoreBrowserFakes(): void {
  for (const restore of restorers.splice(0).reverse()) {
    restore();
  }
}

/** オブジェクトの項目を差し替え、restoreBrowserFakes で元に戻す（元が自分の項目でなければ消す） */
function replaceProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | null): void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === null) {
    Reflect.deleteProperty(target, key);
  } else {
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
  }
  restorers.push(() => {
    if (original === undefined) {
      Reflect.deleteProperty(target, key);
    } else {
      Object.defineProperty(target, key, original);
    }
  });
}

// ---- document.fonts ----

/** installDocumentFonts の引数 */
export interface InstallFontsOptions {
  /** document.fonts.ready を、resolveReady を呼ぶまで終わらせない（省略すると、すぐに終わっている） */
  holdReady?: boolean;
  /** document.fonts.load を、resolveLoad を呼ぶまで終わらせない（省略すると、すぐに終わる） */
  holdLoad?: boolean;
}

/** 差し込んだ document.fonts の偽物と、その操作 */
export interface FontsControl {
  /** document.fonts.load（呼ばれた引数を見る。第 1 引数はフォントの指定、第 2 引数は読む文字） */
  load: Mock<(font: string, text?: string) => Promise<unknown[]>>;
  /** document.fonts.ready を終わらせる（holdReady のとき） */
  resolveReady(): void;
  /** 待たせている document.fonts.load をすべて終わらせる（holdLoad のとき。後から呼ばれた load はすぐに終わる） */
  resolveLoad(): void;
}

/**
 * document.fonts（FontFaceSet）の偽物を差し込む（jsdom には document.fonts がない）。
 * ready は（holdReady なら resolveReady の後で）終わる Promise を返す。load はフォントの指定と文字を受け取り、空の配列で終わる
 */
export function installDocumentFonts(options: InstallFontsOptions = {}): FontsControl {
  let resolveReady: () => void = () => {};
  const readyGate = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  if (!options.holdReady) resolveReady();

  let loadReleased = !options.holdLoad;
  const waitingLoads: (() => void)[] = [];
  const load = vi.fn(async (font: string, text?: string): Promise<unknown[]> => {
    void font;
    void text;
    if (!loadReleased) {
      await new Promise<void>((resolve) => {
        waitingLoads.push(resolve);
      });
    }
    return [];
  });

  const fonts = {
    load,
    check: vi.fn(() => true),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    get status(): string {
      return "loaded";
    },
    get ready(): Promise<unknown> {
      return readyGate.then(() => fonts);
    },
  };
  replaceProperty(document, "fonts", { value: fonts, writable: true });

  return {
    load,
    resolveReady: () => resolveReady(),
    resolveLoad: () => {
      loadReleased = true;
      for (const release of waitingLoads.splice(0)) release();
    },
  };
}

/**
 * document.fonts.load に渡された文字（第 2 引数）を、フォントの指定（第 1 引数）が family を含む呼び出しの分だけつなげる
 */
export function loadedTextFor(control: FontsControl, family: string): string {
  return control.load.mock.calls
    .filter(([font]) => font.includes(family))
    .map(([, text]) => text ?? "")
    .join("");
}

// ---- クリップボード ----

/** ClipboardItem の中身（MIME タイプ → 値。値は Blob・文字列、またはそれを返す Promise） */
export type ClipboardItemData = Record<string, string | Blob | PromiseLike<string | Blob>>;

/** ClipboardItem の偽物（渡された中身を items に持つ） */
export class FakeClipboardItem {
  /** 渡された中身 */
  readonly items: ClipboardItemData;

  constructor(items: ClipboardItemData) {
    this.items = items;
  }

  get types(): string[] {
    return Object.keys(this.items);
  }

  async getType(type: string): Promise<Blob> {
    const value = await this.items[type];
    if (value === undefined) throw new Error(`${type} がない`);
    return value instanceof Blob ? value : new Blob([value], { type });
  }

  static supports(type: string): boolean {
    return type === "image/png" || type === "text/plain";
  }
}

/**
 * クリップボードの対応の具合
 * - "supported"：navigator.clipboard.write と ClipboardItem がある（画像をコピーできる）
 * - "no-clipboard-item"：navigator.clipboard.write はあるが ClipboardItem がない
 * - "no-clipboard"：navigator.clipboard がない（ClipboardItem はある）
 * - "text-only"：navigator.clipboard に writeText しかない（write がない。ClipboardItem はある）
 */
export type ClipboardSupport = "supported" | "no-clipboard-item" | "no-clipboard" | "text-only";

/** 差し込んだクリップボードの偽物 */
export interface ClipboardControl {
  /** navigator.clipboard.write（ない場合も呼ばれていないことを確かめられるよう、常に返す） */
  write: Mock<(items: unknown[]) => Promise<void>>;
  /** navigator.clipboard.writeText */
  writeText: Mock<(text: string) => Promise<void>>;
}

/**
 * navigator.clipboard と ClipboardItem を差し込む。
 * userEvent.setup() はクリップボードの偽物を navigator に差し込むため、この関数は userEvent.setup() の後で呼ぶ
 */
export function installClipboard(support: ClipboardSupport): ClipboardControl {
  const write = vi.fn(async (items: unknown[]): Promise<void> => {
    void items;
  });
  const writeText = vi.fn(async (text: string): Promise<void> => {
    void text;
  });

  if (support === "no-clipboard") {
    replaceProperty(navigator, "clipboard", null);
  } else {
    const clipboard = support === "text-only" ? { writeText } : { write, writeText };
    replaceProperty(navigator, "clipboard", { get: () => clipboard });
  }

  if (support === "no-clipboard-item") {
    replaceProperty(globalThis, "ClipboardItem", null);
  } else {
    replaceProperty(globalThis, "ClipboardItem", { value: FakeClipboardItem, writable: true });
  }

  return { write, writeText };
}

// ---- ダウンロード ----

/** a 要素のクリックで始まったダウンロード 1 回分 */
export interface DownloadRecord {
  /** a 要素の download 属性（保存するファイル名） */
  download: string;
  /** a 要素の href */
  href: string;
}

/** recordDownloads の戻り値 */
export interface DownloadRecorder {
  /** 記録したダウンロード（クリックの順） */
  readonly downloads: readonly DownloadRecord[];
  /** URL.createObjectURL が blob に返した URL（作っていなければ undefined） */
  objectUrlOf(blob: Blob): string | undefined;
  /** URL.createObjectURL の差し替え */
  readonly createObjectURL: MockInstance<(object: Blob | MediaSource) => string>;
}

/**
 * a 要素のクリックによるダウンロードを記録する（jsdom は画面の移動をしないため、実際には何もしない）。
 * - HTMLAnchorElement.prototype.click を差し替える（文書に入れていない a 要素の click も記録する）
 * - 文書の中の a 要素に click のイベントを送った場合も、download 属性があれば記録して、既定の動き（画面の移動）を止める
 * - URL.createObjectURL を「blob:fudawari-test/n」を返す関数に、URL.revokeObjectURL を何もしない関数に差し替える
 * 差し替え（vi.spyOn）は afterEach の vi.restoreAllMocks() で、文書のイベントの見張りは restoreBrowserFakes() で外す
 */
export function recordDownloads(): DownloadRecorder {
  const downloads: DownloadRecord[] = [];
  const urls = new Map<Blob | MediaSource, string>();

  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ download: this.download, href: this.href });
  });

  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (target instanceof HTMLAnchorElement && target.hasAttribute("download")) {
      downloads.push({ download: target.download, href: target.href });
      event.preventDefault();
    }
  };
  document.addEventListener("click", onClick, true);
  restorers.push(() => document.removeEventListener("click", onClick, true));

  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation((object: Blob | MediaSource) => {
    const url = `blob:fudawari-test/${urls.size + 1}`;
    urls.set(object, url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

  return {
    downloads,
    objectUrlOf: (blob) => urls.get(blob),
    createObjectURL,
  };
}
