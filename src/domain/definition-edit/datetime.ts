// 日時（ISO 8601 の時差つき）の読み取りと比較。定義の編集（イベントの情報・権限）と 3 方向マージで使う内部の補助
//
// 受け付ける形式は公開定義の検証（src/domain/definition/validate.ts）と同じ：
// "YYYY-MM-DDTHH:mm" ＋任意の秒 ＋ "Z" か "+09:00" などの時差。時差のない値・実在しない日時（2026-02-30、25 時など）は読めない。
// Date の文字列の解釈（実装ごとの差、日付の繰り上げ）に頼らず、年月日・時分秒を数として確かめる。

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** うるう年か（グレゴリオ暦） */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 実在する年月日か */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

/** 1970-01-01 からの日数（先発グレゴリオ暦。H. Hinnant の days_from_civil） */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const monthFromMarch = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * ISO 8601 の時差つきの日時を、1970-01-01T00:00Z からのミリ秒（Date#getTime と同じ基準）にする。
 * 形式が違う、または実在しない日時は undefined
 */
export function parseDateTime(text: string): number | undefined {
  const match = DATE_TIME_PATTERN.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const offsetSign = match[7] === "-" ? -1 : 1;
  const offsetHour = Number(match[8] ?? "0");
  const offsetMinute = Number(match[9] ?? "0");
  if (!isRealDate(year, month, day)) return undefined;
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return undefined;
  const localMs = daysFromCivil(year, month, day) * DAY_MS + ((hour * 60 + minute) * 60 + second) * 1000;
  return localMs - offsetSign * (offsetHour * 60 + offsetMinute) * MINUTE_MS;
}

/**
 * 2 つの日時が同じか。どちらも読めれば時刻で比べ（"12:00+09:00" と "12:00:00+09:00" は同じ）、
 * 読めない値があれば文字列で比べる
 */
export function sameDateTime(a: string, b: string): boolean {
  const aMs = parseDateTime(a);
  const bMs = parseDateTime(b);
  if (aMs === undefined || bMs === undefined) return a === b;
  return aMs === bMs;
}

/** 日本時間の時差（ミリ秒） */
const JST_OFFSET_MS = 9 * 60 * MINUTE_MS;

/** 2 桁にそろえる */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 日時を「2026/10/20 11:00」の形（日本時間）にする。読めない値はそのまま返す。
 * 時差の書き方（"+09:00"・"Z"）が違っても、同じ時刻は同じ表示になる
 */
export function formatDateTimeJst(text: string): string {
  const ms = parseDateTime(text);
  if (ms === undefined) return text;
  const jst = new Date(ms + JST_OFFSET_MS);
  const date = `${jst.getUTCFullYear()}/${pad2(jst.getUTCMonth() + 1)}/${pad2(jst.getUTCDate())}`;
  return `${date} ${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}`;
}
