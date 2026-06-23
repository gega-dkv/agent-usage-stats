import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Syncs a key/value filter object to the URL query string.
 * Filters become shareable/bookmarkable and survive navigation.
 *
 * Usage:
 *   const { filters, setFilter, resetFilters } = useUrlFilters(defaults);
 */

export type FilterValue = string | number | null | undefined;

export function useUrlFilters<T extends Record<string, FilterValue>>(defaults: T) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Materialize current filters from the URL, falling back to defaults.
  const filters = {} as Record<keyof T, string>;
  (Object.keys(defaults) as (keyof T)[]).forEach((key) => {
    const fromUrl = searchParams.get(String(key));
    filters[key] = fromUrl ?? String(defaults[key] ?? '');
  });

  const setFilter = useCallback(
    (key: keyof T, value: FilterValue) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          const defaultValue = String(defaults[key] ?? '');
          const stringValue = value == null ? '' : String(value);
          if (stringValue === '' || stringValue === defaultValue) {
            next.delete(String(key));
          } else {
            next.set(String(key), stringValue);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaults],
  );

  const setFilters = useCallback(
    (patch: Partial<Record<keyof T, FilterValue>>) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          (Object.keys(patch) as (keyof T)[]).forEach((key) => {
            const defaultValue = String(defaults[key] ?? '');
            const value = patch[key];
            const stringValue = value == null ? '' : String(value);
            if (stringValue === '' || stringValue === defaultValue) {
              next.delete(String(key));
            } else {
              next.set(String(key), stringValue);
            }
          });
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaults],
  );

  const resetFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  /** True if any filter differs from its default (drives "Reset" affordance). */
  const isDirty = (Object.keys(defaults) as (keyof T)[]).some((key) => {
    const fromUrl = searchParams.get(String(key));
    return fromUrl != null && fromUrl !== String(defaults[key] ?? '');
  });

  return { filters, setFilter, setFilters, resetFilters, isDirty };
}
