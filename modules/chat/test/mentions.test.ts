import { describe, expect, it } from 'vitest';
import { parseMentions } from '../server/mentions.ts';

const ildi = { id: '00000000-0000-4000-8000-000000000001', name: 'Iroda Ildi' };
const tamas = { id: '00000000-0000-4000-8000-000000000002', name: 'Terepes Tamás' };
const kiss = { id: '00000000-0000-4000-8000-000000000003', name: 'Kiss Ádám' };
const kissP = { id: '00000000-0000-4000-8000-000000000004', name: 'Kiss Ádám Péter' };
const people = [ildi, tamas, kiss, kissP];

describe('@említés feldolgozása', () => {
  it('a teljes névre illeszkedik, kis- és nagybetűtől függetlenül, előfordulási sorrendben, ismétlés nélkül', () => {
    expect(parseMentions('@Terepes Tamás nézd meg, @iroda ildi küldi. @TEREPES TAMÁS!', people)).toEqual([tamas.id, ildi.id]);
  });

  it('a név után írásjel állhat, betű nem', () => {
    expect(parseMentions('Szia @Iroda Ildi, kérdés:', people)).toEqual([ildi.id]);
    expect(parseMentions('(@Iroda Ildi)', people)).toEqual([ildi.id]);
    expect(parseMentions('@Iroda Ildikó', people)).toEqual([]);
  });

  it('az e-mail-cím és a csak vezetéknév nem említés', () => {
    expect(parseMentions('írj a terepes@Terepes Tamás címre', people)).toEqual([]);
    expect(parseMentions('@Terepes', people)).toEqual([]);
  });

  it('több illeszkedő név közül a leghosszabb nyer', () => {
    expect(parseMentions('@Kiss Ádám Péter és @Kiss Ádám', people)).toEqual([kissP.id, kiss.id]);
  });

  it('aki nincs a jelöltek között (nem látja a projektet), nem említhető', () => {
    expect(parseMentions('@Admin Ádám', people)).toEqual([]);
  });
});
