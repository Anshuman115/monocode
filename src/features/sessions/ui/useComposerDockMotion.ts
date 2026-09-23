import { useCallback, useLayoutEffect, useRef } from "react";

// A submit only counts as the launch if the composer docks shortly after it.
const LAUNCH_WINDOW_MS = 1500;
const DURATION_MS = 480;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Slides the composer from the centered empty-session slot down to the dock
 * when the first message is sent, instead of letting it jump there.
 */
export function useComposerDockMotion(docked: boolean) {
  const centeredRef = useRef<HTMLDivElement>(null);
  const dockedRef = useRef<HTMLDivElement>(null);
  const launch = useRef<{
    top: number;
    centerX: number;
    width: number;
    at: number;
  } | null>(null);

  const captureLaunch = useCallback(() => {
    const rect = centeredRef.current?.getBoundingClientRect();
    launch.current = rect
      ? {
          top: rect.top,
          centerX: rect.left + rect.width / 2,
          width: rect.width,
          at: performance.now(),
        }
      : null;
  }, []);

  useLayoutEffect(() => {
    if (!docked) return;
    const from = launch.current;
    launch.current = null;
    const element = dockedRef.current;
    if (!from || !element || reducedMotion()) return;
    if (performance.now() - from.at > LAUNCH_WINDOW_MS) return;
    const to = element.getBoundingClientRect();
    // Align centers so the composer drops straight down, and grow it from
    // the narrower centered width instead of snapping to the dock width.
    const dx = from.centerX - (to.left + to.width / 2);
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const animation = element.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px)`,
          width: `${from.width}px`,
        },
        { transform: "translate(0, 0)", width: `${to.width}px` },
      ],
      { duration: DURATION_MS, easing: EASING },
    );
    return () => animation.cancel();
  }, [docked]);

  return { centeredRef, dockedRef, captureLaunch };
}
