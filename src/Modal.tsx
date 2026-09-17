import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialogTransition, type DialogTransition } from './useDialogTransition';

export default function Modal({ title, kicker, close, children, wide = false, entrance = false, transition, onCloseStart }: {
  title: string; kicker: string; close: () => void; children: ReactNode; wide?: boolean; entrance?: boolean; transition?: DialogTransition; onCloseStart?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const closeRequested = useRef(false);
  const closeFinished = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  const finishClose = () => {
    if (!closeRequested.current || closeFinished.current) return;
    closeFinished.current = true;
    closeRef.current();
  };
  const handingOff = useRef(false);
  handingOff.current = !!transition;
  useLayoutEffect(() => {
    const trigger = document.activeElement;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (!handingOff.current && trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  useDialogTransition(ref, transition);
  useLayoutEffect(() => {
    if (!closing) return;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const changed = () => { if (motion?.matches) finishClose(); };
    motion?.addEventListener('change', changed);
    const timer = window.setTimeout(finishClose, 300);
    return () => { clearTimeout(timer); motion?.removeEventListener('change', changed); };
  }, [closing]);
  const requestClose = () => {
    if (transition || closeRequested.current) return;
    closeRequested.current = true;
    onCloseStart?.();
    if (!entrance || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) finishClose();
    else setClosing(true);
  };
  const locked = !!transition || closing;
  return <dialog ref={ref} className={`settings-dialog${wide ? ' wide-dialog' : ''}${entrance ? ' auth-dialog' : ''}${transition ? ' auth-expanding' : ''}${closing ? ' auth-closing' : ''}`} aria-label={title} aria-busy={locked || undefined}
    onAnimationEnd={event => { if (event.target === ref.current && event.animationName === 'auth-close') finishClose(); }}
    onCancel={event => { event.preventDefault(); requestClose(); }}
    onClick={event => { if (event.target === ref.current) requestClose(); }}
    onKeyDown={event => {
      if (locked) { if (event.key === 'Tab') event.preventDefault(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="dialog-content" inert={locked}><div className="dialog-heading"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div><button type="button" className="icon-button" aria-label={`关闭${title}`} onClick={requestClose} disabled={locked}><X size={20} /></button></div>{children}</div>
  </dialog>;
}
