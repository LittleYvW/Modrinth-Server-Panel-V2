import { useLayoutEffect, useRef, type RefObject } from 'react';

export type DialogTransition = {
  target: RefObject<HTMLDivElement | null>;
  complete: () => void;
};

const FADE_MS = 160;
const EXPAND_MS = 560;

// Animate the shell, never the form. Resolve the destination every frame so
// loading results, viewport changes and wrapping can move it during the handoff.
export function useDialogTransition(ref: RefObject<HTMLDialogElement | null>, transition?: DialogTransition) {
  const completeRef = useRef(transition?.complete);
  completeRef.current = transition?.complete;
  const target = transition?.target;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!target || !dialog) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let finished = false;
    let frame = 0;
    let timer = 0;
    const originalStyle = dialog.getAttribute('style');
    const overflow = document.body.style.overflow;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      completeRef.current?.();
    };
    const bounds = dialog.getBoundingClientRect();
    let current = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, radius: parseFloat(getComputedStyle(dialog).borderTopLeftRadius) || 16 };
    const paint = () => Object.assign(dialog.style, {
      position: 'fixed', margin: '0', inset: 'auto', transform: 'none', animation: 'none',
      maxWidth: 'none', maxHeight: 'none', boxSizing: 'border-box', overflow: 'hidden',
      left: `${current.left}px`, top: `${current.top}px`, width: `${current.width}px`, height: `${current.height}px`, borderRadius: `${current.radius}px`,
    });
    paint();
    // Freeze the form's wrapping while its contents fade out.
    dialog.style.setProperty('--auth-content-width', `${dialog.clientWidth}px`);
    document.body.style.overflow = 'hidden';
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const started = performance.now();
    let previousProgress = 0;
    const tick = (now: number) => {
      if (finished) return;
      const panel = target.current?.firstElementChild;
      if (!(panel instanceof HTMLElement)) { finish(); return; }
      const elapsed = Math.max(0, Math.min(1, (now - started - FADE_MS) / EXPAND_MS));
      const progress = 1 - Math.pow(1 - elapsed, 3);
      const mix = previousProgress < 1 ? (progress - previousProgress) / (1 - previousProgress) : 1;
      const rect = panel.getBoundingClientRect();
      const destination = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, radius: parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0 };
      for (const key of Object.keys(current) as (keyof typeof current)[]) current[key] += (destination[key] - current[key]) * mix;
      paint();
      previousProgress = progress;
      if (elapsed === 1) finish();
      else frame = requestAnimationFrame(tick);
    };
    const motionChanged = () => { if (motion.matches) finish(); };
    motion.addEventListener('change', motionChanged);
    if (motion.matches) finish();
    else {
      frame = requestAnimationFrame(tick);
      // Background tabs can suspend animation frames; never strand authentication.
      timer = window.setTimeout(finish, FADE_MS + EXPAND_MS + 200);
    }
    return () => {
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      motion.removeEventListener('change', motionChanged);
      document.body.style.overflow = overflow;
      if (originalStyle === null) dialog.removeAttribute('style');
      else dialog.setAttribute('style', originalStyle);
    };
  }, [ref, target]);
}
