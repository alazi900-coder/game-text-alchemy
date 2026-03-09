import { useCallback, useRef } from "react";

/**
 * Hook for showing timed messages that auto-clear after a duration.
 * Replaces the repetitive pattern: setter(msg); setTimeout(() => setter(""), duration);
 */
export function useTimedMessage(setter: (msg: string) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback((msg: string, duration = 3000) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setter(msg);
    timerRef.current = setTimeout(() => setter(""), duration);
  }, [setter]);

  return show;
}
