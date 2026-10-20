import type { Person } from '../shared.ts';

export interface Segment {
  text: string;
  mention?: Person;
}

/** Az üzenet szövege darabokra bontva: a megemlített nevek (`@Név`) külön darabok, hogy kiemelve jelenjenek meg. */
export function splitMentions(body: string, mentions: Person[]): Segment[] {
  if (mentions.length === 0) return [{ text: body }];
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const lower = body.toLocaleLowerCase('hu');
  const out: Segment[] = [];
  let start = 0;
  for (let i = lower.indexOf('@'); i !== -1; i = lower.indexOf('@', i + 1)) {
    const m = sorted.find((p) => lower.startsWith(p.name.toLocaleLowerCase('hu'), i + 1));
    if (!m) continue;
    if (i > start) out.push({ text: body.slice(start, i) });
    const end = i + 1 + m.name.length;
    out.push({ text: body.slice(i, end), mention: m });
    start = end;
    i = end - 1;
  }
  if (start < body.length) out.push({ text: body.slice(start) });
  return out;
}

/**
 * Az éppen gépelt említés a kurzor előtt: az `@` utáni szöveg (legfeljebb 40 karakter, sortörés nélkül), ha az `@`
 * szó elején áll; különben `null`.
 */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1 || caret - at > 41) return null;
  if (at > 0 && /[\p{L}\p{N}_]/u.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/[\n@]/.test(query)) return null;
  return { query, start: at };
}

/** A gépelt említéshez illő személyek: a név eleje vagy bármelyik szavának eleje egyezik. */
export function matchPeople(people: Person[], query: string, limit = 6): Person[] {
  const q = query.trim().toLocaleLowerCase('hu');
  return people
    .filter((p) => {
      const name = p.name.toLocaleLowerCase('hu');
      return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
    })
    .slice(0, limit);
}
