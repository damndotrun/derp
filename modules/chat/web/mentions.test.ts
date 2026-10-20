import { describe, expect, it } from 'vitest';
import { matchPeople, mentionQuery, splitMentions } from './mentions.ts';

const tamas = { id: 't', name: 'Terepes Tamás' };
const ildi = { id: 'i', name: 'Iroda Ildi' };

describe('@említés a felületen', () => {
  it('a megemlített neveket külön darabként emeli ki', () => {
    expect(splitMentions('Szia @terepes tamás, nézd meg @Iroda Ildi!', [tamas, ildi])).toEqual([
      { text: 'Szia ' },
      { text: '@terepes tamás', mention: tamas },
      { text: ', nézd meg ' },
      { text: '@Iroda Ildi', mention: ildi },
      { text: '!' },
    ]);
    expect(splitMentions('Nincs említés @valaki', [])).toEqual([{ text: 'Nincs említés @valaki' }]);
  });

  it('a kurzor előtti, szó elején álló @ utáni szöveg a keresés', () => {
    expect(mentionQuery('Szia @Ter', 9)).toEqual({ query: 'Ter', start: 5 });
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 });
    expect(mentionQuery('a@b.hu', 6)).toBeNull();
    expect(mentionQuery('@Ter\nmás', 8)).toBeNull();
    expect(mentionQuery('nincs', 5)).toBeNull();
  });

  it('a név vagy bármelyik szavának eleje illeszkedik', () => {
    expect(matchPeople([tamas, ildi], 'ta')).toEqual([tamas]);
    expect(matchPeople([tamas, ildi], 'IRO')).toEqual([ildi]);
    expect(matchPeople([tamas, ildi], '')).toEqual([tamas, ildi]);
    expect(matchPeople([tamas, ildi], 'Terepes Tamás nézd')).toEqual([]);
  });
});
