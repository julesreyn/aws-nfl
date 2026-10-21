import { useEffect, useRef } from "react";
import { FPS, useStore } from "@/store";

// Drives the playback clock: advances `frame` while `playing`.
export function usePlaybackLoop(onRepEnded?: () => void) {
  const endedRef = useRef(onRepEnded);
  endedRef.current = onRepEnded;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { playing, rep, frame, speed, setFrame, pause } = useStore.getState();
      if (playing && rep) {
        const end = rep.nFrames - 1;
        let f = frame + dt * FPS * speed;
        if (f >= end) {
          f = end;
          pause();
          setFrame(f);
          endedRef.current?.();
        } else {
          setFrame(f);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}
