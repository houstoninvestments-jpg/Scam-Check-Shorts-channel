/** Readability gate: grade 8 or lower, every sentence under 18 words. */

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z]/i.test(s));
}

const words = (s: string) => s.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));

export function fkGrade(text: string): number {
  const ss = sentences(text);
  const ws = ss.flatMap(words);
  if (!ws.length) return 0;
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59;
}

export interface ReadabilityResult {
  ok: boolean;
  grade: number;
  longest: number;
  problems: string[];
}

export function checkReadability(text: string, maxGrade = 8, maxWords = 17): ReadabilityResult {
  const problems: string[] = [];
  const ss = sentences(text);
  let longest = 0;
  for (const s of ss) {
    const n = words(s).length;
    longest = Math.max(longest, n);
    if (n > maxWords) problems.push(`sentence has ${n} words: "${s}"`);
  }
  const grade = +fkGrade(text).toFixed(1);
  if (grade > maxGrade) problems.push(`reading grade ${grade} is above ${maxGrade}`);
  return { ok: problems.length === 0, grade, longest, problems };
}
