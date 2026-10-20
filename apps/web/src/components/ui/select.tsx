import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Natív legördülő lista az `Input` stílusában (telefonon a rendszer választója nyílik). */
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  );
}
