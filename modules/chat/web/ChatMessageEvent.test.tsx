import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { EventList } from '@/core/EventList.tsx';
import { MessageBody } from './ProjectChatPage.tsx';

describe('chat a felületen', () => {
  it('az idővonalon a chat-üzenet szövege és link a chatre', () => {
    const projectId = crypto.randomUUID();
    const element = (
      <EventList
        timeZone="Europe/Budapest"
        events={[
          {
            id: crypto.randomUUID(),
            projectId,
            type: 'chat.message_posted',
            source: 'user',
            occurredAt: '2026-10-20T10:00:00.000Z',
            actor: { id: crypto.randomUUID(), name: 'Terepes Tamás' },
            title: 'Chat-üzenet: Melyik gyártmányú legyen a ventilátor?',
            data: { messageId: crypto.randomUUID(), body: 'Melyik gyártmányú legyen a ventilátor?', mentions: [], attachments: 2 },
            parentId: null,
          },
        ]}
      />
    );
    render(<RouterProvider router={createMemoryRouter([{ path: '/', element }])} />);
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Terepes Tamás');
    expect(item).toHaveTextContent('2 csatolmány');
    expect(screen.getByRole('link', { name: 'Megnyitás a chatben' })).toHaveAttribute('href', `/chat/${projectId}`);
  });

  it('a megemlített nevek kiemelve jelennek meg', () => {
    const { container } = render(<MessageBody body="@Iroda Ildi kérlek nézd meg" mentions={[{ id: 'i', name: 'Iroda Ildi' }]} />);
    const strong = container.querySelector('strong')!;
    expect(strong).toHaveTextContent('@Iroda Ildi');
    expect(strong).toHaveAttribute('data-mention', 'i');
  });
});
