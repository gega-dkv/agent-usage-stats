'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

/**
 * Syncs a key/value filter object to the URL query string.
 * Filters become shareable/bookmarkable and survive navigation.
 *
 * Usage:
 *   const { filters, setFilter, resetFilters } = useUrlFilters(defaults);
 */

export type FilterValue = string | number | null | undefined;

export function useUrlFilters<T extends Record<string, FilterValue>>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Materialize current filters from the URL, falling back to defaults.
  const filters = {} as Record<keyof T, string>;
  (Object.keys(defaults) as (keyof T)[]).forEach((key) => {
    const fromUrl = searchParams.get(String(key));
    filters[key] = fromUrl ?? String(defaults[key] ?? '');
  });

  const setFilter = useCallback(
    (key: keyof T, value: FilterValue) => {
      const params = new URLSearchParams(searchParams.toString());
      const defaultValue = String(defaults[key] ?? '');
      const stringValue = value == null ? '' : String(value);
      if (stringValue === '' || stringValue === defaultValue) {
        params.delete(String(key));
      } else {
        params.set(String(key), stringValue);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, defaults],
  );

  const setFilters = useCallback(
    (patch: Partial<Record<keyof T, FilterValue>>) => {
      const params = new URLSearchParams(searchParams.toString());
      (Object.keys(patch) as (keyof T)[]).forEach((key) => {
        const defaultValue = String(defaults[key] ?? '');
        const value = patch[key];
        const stringValue = value == null ? '' : String(value);
        if (stringValue === '' || stringValue === defaultValue) {
          params.delete(String(key));
        } else {
          params.set(String(key), stringValue);
        }
      });
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, defaults],
  );

  const resetFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  /** True if any filter differs from its default (drives "Reset" affordance). */
  const isDirty = (Object.keys(defaults) as (keyof T)[]).some((key) => {
    const fromUrl = searchParams.get(String(key));
    return fromUrl != null && fromUrl !== String(defaults[key] ?? '');
  });

  return { filters, setFilter, setFilters, resetFilters, isDirty };
}
