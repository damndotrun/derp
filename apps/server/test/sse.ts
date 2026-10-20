import type { FastifyInstance } from 'fastify';

export interface SseMessage {
  id?: string;
  event: string;
  data: string;
}

export interface SseClient {
  status: number;
  /** A következő üzenet (pinggel együtt: a `: ping` kommentből `event: 'comment'` lesz). */
  next(timeoutMs?: number): Promise<SseMessage>;
  /** Az első olyan üzenet, amelyre a feltétel igaz; a többit eldobja. */
  waitFor(pred: (m: SseMessage) => boolean, timeoutMs?: number): Promise<SseMessage>;
  close(): void;
}

/** Valódi HTTP-kapcsolattal olvassa az SSE-folyamot (az `inject` nem streamel). */
export async function openStream(
  app: FastifyInstance,
  opts: { cookie?: string; lastEventId?: string; path?: string } = {},
): Promise<SseClient> {
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('az alkalmazás nem figyel portot');
  const controller = new AbortController();
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.lastEventId) headers['last-event-id'] = opts.lastEventId;
  const res = await fetch(`http://127.0.0.1:${address.port}${opts.path ?? '/api/stream'}`, {
    headers,
    signal: controller.signal,
  });

  const queue: SseMessage[] = [];
  const waiters: Array<() => void> = [];
  let buffer = '';
  const decoder = new TextDecoder();
  if (res.ok && res.body) {
    const reader = res.body.getReader();
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const msg: SseMessage = { event: 'message', data: '' };
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) msg.event = 'comment';
              else if (line.startsWith('id: ')) msg.id = line.slice(4);
              else if (line.startsWith('event: ')) msg.event = line.slice(7);
              else if (line.startsWith('data: ')) msg.data += line.slice(6);
              else if (line.startsWith('retry: ')) msg.event = 'retry';
            }
            queue.push(msg);
            waiters.splice(0).forEach((w) => w());
          }
        }
      } catch {
        // megszakítva
      }
    })();
  }

  const next = async (timeoutMs = 5000): Promise<SseMessage> => {
    const deadline = Date.now() + timeoutMs;
    while (queue.length === 0) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('SSE: nem jött üzenet időben');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return queue.shift()!;
  };

  return {
    status: res.status,
    next,
    waitFor: async (pred, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const m = await next(Math.max(1, deadline - Date.now()));
        if (pred(m)) return m;
      }
    },
    close: () => controller.abort(),
  };
}
