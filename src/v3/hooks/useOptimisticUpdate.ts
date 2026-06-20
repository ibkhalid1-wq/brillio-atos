import { useCallback, useRef, useState } from "react";

interface OptimisticUpdateOptions<T> {
  onSuccess?: (result: T) => void;
  onError?: (error: Error, rolledBackTo: T) => void;
  rollbackDelayMs?: number;
}

export function useOptimisticUpdate<T>(initialValue: T, options?: OptimisticUpdateOptions<T>) {
  const [value, setValue] = useState<T>(initialValue);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const previousRef = useRef<T>(initialValue);

  const update = useCallback(async (optimisticValue: T, mutate: () => Promise<T>) => {
    previousRef.current = value;
    setValue(optimisticValue);
    setIsUpdating(true);
    setError(null);
    try {
      const result = await mutate();
      setValue(result);
      options?.onSuccess?.(result);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const delay = options?.rollbackDelayMs ?? 0;
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      setValue(previousRef.current);
      setError(err);
      options?.onError?.(err, previousRef.current);
    } finally {
      setIsUpdating(false);
    }
  }, [value, options]);

  const reset = useCallback(() => {
    setValue(initialValue);
    setError(null);
  }, [initialValue]);

  return { value, isUpdating, error, update, reset };
}
