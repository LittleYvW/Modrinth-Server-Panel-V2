import { useEffect, useRef } from 'react';

export const FLASH_MS = 600;
export const FADE_MS = 1400;

export function circuitOpacity(age: number): number {
  if (age < 0 || age >= FLASH_MS + FADE_MS) return 0;
  // Start visibly bright, with three flashes before the shared handoff boundary.
  if (age < FLASH_MS) {
    return (age >= 80 && age < 160) || (age >= 240 && age < 320) ? 0.06 : 1;
  }
  return 1 - (age - FLASH_MS) / FADE_MS;
}

export function chooseCircuit(starts: number[], now: number, random = Math.random): number {
  // Protect the current flash and the latest fade. Older tails can re-energize,
  // otherwise four routes with a long fade would lock into a fixed rotation.
  const available = starts.flatMap((start, index) =>
    now - start >= FLASH_MS * 2 ? [index] : []);
  return available.length ? available[Math.floor(random() * available.length)] : -1;
}

export function useCircuitRelay() {
  const ref = useRef<SVGGElement>(null);

  useEffect(() => {
    const routes = Array.from(ref.current?.querySelectorAll<SVGGElement>('.electric-route') ?? []);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const groups = ['left', 'right'].map(side => {
      const members = routes.filter(route => route.dataset.side === side);
      return { routes: members, starts: members.map(() => -Infinity), nextAt: 0 };
    });

    const tick = (now: number) => {
      groups.forEach(group => {
        if (now >= group.nextAt) {
          // Each side owns its selection history and handoff clock.
          const at = group.nextAt || now;
          const next = chooseCircuit(group.starts, at);
          if (next >= 0) group.starts[next] = at;
          group.nextAt = at + FLASH_MS;
        }
        group.routes.forEach((route, index) => {
          route.style.opacity = String(circuitOpacity(now - group.starts[index]));
        });
      });
      frame = requestAnimationFrame(tick);
    };

    const reset = () => {
      cancelAnimationFrame(frame);
      groups.forEach(group => {
        group.starts = group.routes.map(() => -Infinity);
        group.nextAt = 0;
      });
      routes.forEach(route => { route.style.opacity = '0'; });
      if (!motion.matches && !document.hidden) frame = requestAnimationFrame(tick);
    };

    reset();
    motion.addEventListener('change', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', reset);
      document.removeEventListener('visibilitychange', reset);
      routes.forEach(route => { route.style.opacity = ''; });
    };
  }, []);

  return ref;
}
