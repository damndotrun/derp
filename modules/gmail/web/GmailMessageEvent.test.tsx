import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@derp/shared';
import { EventList } from '@/core/EventList.tsx';
import type { GmailMessageEventData, MessageDetail } from '../shared.ts';
import { displayName, formatSize } from './parts.tsx';

const messageId = crypto.randomUUID();
const threadId = crypto.randomUUID();
const projectId = crypto.randomUUID();

const data: GmailMessageEventData = {
  messageId,
  threadId,
  from: 'Minta Béla <bela@minta-kft.test>',
  to: ['levelek@derp.test'],
  cc: [],
  direction: 'in',
  kind: 'client_rfq',
  snippet: 'A telefonos egyeztetés alapján kérnénk ajánlatot',
  attachments: [{ name: 'alaprajz_csarnok.pdf', mimeType: 'application/pdf', size: 183402 }],
};

const event: TimelineEvent = {
  id: crypto.randomUUID(),
  projectId,
  type: 'gmail.message',
  source: 'gmail',
  occurredAt: '2026-10-18T08:00:00.000Z',
  actor: null,
  title: 'Levél: Re: Minta Kft. ajánlatkérés',
  data: { ...data },
  parentId: null,
};

const detail: MessageDetail = {
  id: messageId,
  threadId,
  projectId,
  subject: 'Re: Minta Kft. ajánlatkérés',
  from: data.from,
  to: data.to,
  cc: ['kolléga@derp.test'],
  sentAt: event.occurredAt,
  direction: 'in',
  kind: 'client_rfq',
  snippet: data.snippet,
  bodyText: 'Tisztelt Dóka Kft.!\n\nA telefonos egyeztetés alapján kérnénk ajánlatot a csarnok felújítására.',
  attachments: data.attachments,
};

afterEach(() => vi.unstubAllGlobals());

describe('gmail a felületen', () => {
  it('az idővonalon a levél iránya, feladója, típusa és kivonata; kibontva a törzs és a csatolmánylista', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(detail), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EventList timeZone="Europe/Budapest" events={[event]} />
      </QueryClientProvider>,
    );
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Levél: Re: Minta Kft. ajánlatkérés');
    expect(item).toHaveTextContent('Bejövő');
    expect(item).toHaveTextContent('Ügyfél-ajánlatkérés');
    expect(item).toHaveTextContent('Feladó: Minta Béla');
    expect(item).toHaveTextContent('1 csatolmány');
    expect(item).toHaveTextContent('A telefonos egyeztetés alapján');
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Levél megnyitása/ }));
    const body = await screen.findByLabelText('A levél szövege');
    expect(body).toHaveTextContent('csarnok felújítására');
    expect(fetch).toHaveBeenCalledWith(`/api/gmail/messages/${messageId}`, expect.anything());
    const attachments = within(item).getByRole('list', { name: 'Csatolmányok' });
    expect(attachments).toHaveTextContent('alaprajz_csarnok.pdf (179 kB)');
    expect(item).toHaveTextContent('kolléga@derp.test');
    expect(screen.getByRole('button', { name: /Levél bezárása/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('segédek: név a fejlécből, méret', () => {
    expect(displayName('Minta Béla <bela@minta-kft.test>')).toBe('Minta Béla');
    expect(displayName('"Iroda" <levelek@derp.test>')).toBe('Iroda');
    expect(displayName('<x@y.test>')).toBe('x@y.test');
    expect(displayName('x@y.test')).toBe('x@y.test');
    expect(formatSize(900)).toBe('900 B');
    expect(formatSize(1_572_864)).toBe('1,5 MB');
  });
});
