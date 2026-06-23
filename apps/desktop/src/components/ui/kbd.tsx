import * as React from 'react';
import { cn } from '@/lib/utils';

/** Keyboard shortcut hint, styled like Linear/Vercel. */
function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-[1.25rem] select-none items-center justify-center gap-0.5 rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))]',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
