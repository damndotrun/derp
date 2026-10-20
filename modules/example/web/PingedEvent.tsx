import { DefaultEvent } from '@/core/DefaultEvent.tsx';
import type { EventRendererProps } from '@/core/module-types.ts';

/** A „Minta esemény” megjelenítője: az alapértelmezett sorok alatt az üdvözlő szöveg. */
export function PingedEvent(props: EventRendererProps) {
  const greeting = typeof props.event.data.greeting === 'string' ? props.event.data.greeting : null;
  return (
    <DefaultEvent {...props}>
      {greeting && <p className="mt-1 rounded-md bg-accent px-2 py-1 text-sm">{greeting}</p>}
    </DefaultEvent>
  );
}
