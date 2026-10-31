/**
 * What the voice actually reads. Money, percents, phone numbers, years and other numbers become words,
 * so "$4.99" is read "four dollars and ninety-nine cents", not "dollar four point nine nine".
 * Only the voice gets this; captions and the phone screen keep the text exactly as written.
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
  [1e12, "trillion"],
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
];

function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}

function underThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} hundred` : "", r || !h ? underHundred(r) : ""].filter(Boolean).join(" ");
}

/** 1234567 -> "one million two hundred thirty-four thousand five hundred sixty-seven" */
export function numberWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `minus ${numberWords(-n)}`;
  n = Math.floor(n);
  if (n < 1000) return underThousand(n);
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${numberWords(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(underThousand(n));
  return parts.join(" ");
}

const digits = (s: string) => s.split("").map((d) => ONES[Number(d)]).join(" ");

/** "2.5" -> "two point five"; "1,500" -> "one thousand five hundred" */
function decimalWords(s: string): string {
  const [whole, frac] = s.replace(/,/g, "").split(".");
  return frac ? `${numberWords(Number(whole))} point ${digits(frac)}` : numberWords(Number(whole));
}

/** 2026 -> "twenty twenty-six", 2005 -> "two thousand five", 1999 -> "nineteen ninety-nine", 1905 -> "nineteen oh five" */
export function yearWords(y: number): string {
  if (y >= 2000 && y < 2010) return numberWords(y);
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (lo === 0) return `${numberWords(hi)} hundred`;
  return `${numberWords(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : underHundred(lo)}`;
}

const SCALE_WORD: Record<string, string> = { k: "thousand", thousand: "thousand", m: "million", mm: "million", million: "million", b: "billion", bn: "billion", billion: "billion" };

/** "$4.99" -> "four dollars and ninety-nine cents"; "$2.5 million" -> "two point five million dollars" */
export function moneyWords(amount: string, scale?: string): string {
  const clean = amount.replace(/,/g, "");
  if (scale) return `${decimalWords(clean)} ${SCALE_WORD[scale.toLowerCase()]} dollars`;
  const [whole, frac = ""] = clean.split(".");
  const dollars = Number(whole || "0");
  const cents = frac ? Math.round(Number(`0.${frac}`) * 100) : 0;
  const d = `${numberWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  const c = `${numberWords(cents)} ${cents === 1 ? "cent" : "cents"}`;
  if (!cents) return d;
  if (!dollars) return c;
  return `${d} and ${c}`;
}

const ORDINAL: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
function ordinalWords(n: number): string {
  const w = numberWords(n);
  const m = w.match(/(\w+)$/)!;
  const last = m[1];
  const ord = ORDINAL[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return w.slice(0, m.index) + ord;
}

/** A phone number read in groups, digit by digit: "(202) 555-0199" -> "two zero two, five five five, zero one nine nine" */
function phoneWords(m: string): string {
  const d = m.replace(/\D/g, "");
  const groups = d.length === 11 ? [d.slice(0, 1), d.slice(1, 4), d.slice(4, 7), d.slice(7)] : [d.slice(0, 3), d.slice(3, 6), d.slice(6)];
  return groups.map(digits).join(", ");
}

const PHONE = /(?<![\w$])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/g;
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d+)?)(?:\s?(thousand|million|billion|mm|bn|[kmb])\b)?/gi;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;
const ORDINAL_NUM = /\b(\d+)(st|nd|rd|th)\b/gi;
const YEAR = /(?<![\d,.$])\b(19\d{2}|20\d{2})\b(?![\d,]|\.\d)/g;
const LONG_CODE = /(?<![\d,.])\b\d{5,}\b(?![,.]\d)/g; // codes, ZIPs, IDs: digit by digit
const NUMBER = /(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w])/g;

/** The text the voice reads. */
export function speakable(text: string): string {
  return text
    .replace(PHONE, (m) => phoneWords(m))
    .replace(MONEY, (_, amount: string, scale?: string) => moneyWords(amount, scale))
    .replace(PERCENT, (_, n: string) => `${decimalWords(n)} percent`)
    .replace(ORDINAL_NUM, (_, n: string) => ordinalWords(Number(n)))
    .replace(YEAR, (_, y: string) => yearWords(Number(y)))
    .replace(LONG_CODE, (m) => digits(m))
    .replace(NUMBER, (_, n: string) => decimalWords(n));
}
