import type { Person } from '../shared.ts';

const WORD = /[\p{L}\p{N}_]/u;

/**
 * Az üzenetben @-tal megemlített személyek a jelöltek közül (akik a projektet látják), előfordulási sorrendben,
 * ismétlés nélkül. Az említés `@` + a teljes név (kis- és nagybetűtől függetlenül); az `@` előtt és a név után nem
 * állhat betű vagy szám (így az e-mail-cím nem említés). Ha több név is illeszkedik (pl. „Kiss Ádám” és „Kiss Ádám
 * Péter”), a leghosszabb nyer.
 */
export function parseMentions(body: string, candidates: Person[]): string[] {
  const sorted = [...candidates].sort((a, b) => b.name.length - a.name.length);
  const lower = body.toLocaleLowerCase('hu');
  const found: string[] = [];
  for (let i = lower.indexOf('@'); i !== -1; i = lower.indexOf('@', i + 1)) {
    if (i > 0 && WORD.test(lower[i - 1]!)) continue;
    const rest = lower.slice(i + 1);
    const match = sorted.find((p) => {
      const name = p.name.toLocaleLowerCase('hu');
      return name.length > 0 && rest.startsWith(name) && !WORD.test(rest[name.length] ?? '');
    });
    if (match && !found.includes(match.id)) found.push(match.id);
  }
  return found;
}
