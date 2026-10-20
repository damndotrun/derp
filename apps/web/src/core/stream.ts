import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { TimelineEvent } from '@derp/shared';
import { sessionKey } from './session.ts';

type Listener = (event: TimelineEvent) => void;
const listeners = new Set<Listener>();

/** Hiba után ennyi idő múlva épül újra a kapcsolat (a böngésző saját újracsatlakozásán felül). */
const RECONNECT_MS = 5_000;

/** Egy beérkezett esemény hatása a gyorsítótárra: a projekt eseménylistája újratöltődik. */
export function applyEvent(queryClient: QueryClient, event: TimelineEvent): void {
  if (event.projectId) void queryClient.invalidateQueries({ queryKey: ['projects', event.projectId, 'events'] });
  for (const l of listeners) l(event);
}

/**
 * Az élő eseményfolyam (`GET /api/stream`) a bejelentkezett felhasználónak, alkalmazásonként egy kapcsolattal.
 * Megszakadáskor a böngésző maga csatlakozik újra a `Last-Event-ID` fejléccel; ha a szerver hibával zárt (pl. lejárt
 * munkamenet), új kapcsolat épül a legutolsó sorszámmal (`?lastEventId=`), és a munkamenet újra ellenőrződik.
 * A `<html data-stream>` értéke `connecting` vagy `ready`.
 */
export function useEventStream(enabled: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const root = document.documentElement;
    let source: EventSource | null = null;
    let lastId: string | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const remember = (m: MessageEvent) => {
      if (m.lastEventId) lastId = m.lastEventId;
    };
    const connect = () => {
      root.dataset.stream = 'connecting';
      source = new EventSource(lastId ? `/api/stream?lastEventId=${encodeURIComponent(lastId)}` : '/api/stream');
      source.addEventListener('ready', (m) => {
        remember(m);
        root.dataset.stream = 'ready';
      });
      source.addEventListener('event', (m) => {
        remember(m);
        applyEvent(queryClient, JSON.parse(m.data) as TimelineEvent);
      });
      source.addEventListener('reset', () => void queryClient.invalidateQueries());
      source.onerror = () => {
        root.dataset.stream = 'connecting';
        if (source?.readyState !== EventSource.CLOSED) return;
        source.close();
        void queryClient.invalidateQueries({ queryKey: sessionKey });
        retry = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();
    return () => {
      clearTimeout(retry);
      source?.close();
      delete root.dataset.stream;
    };
  }, [enabled, queryClient]);
}

/** Modulok feliratkozása az élő eseményekre (pl. a chat saját listájának frissítésére). */
export function useLiveEvents(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}
