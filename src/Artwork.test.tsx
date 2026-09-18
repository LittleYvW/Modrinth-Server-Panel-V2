// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Artwork from './Artwork';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('updates animated extensions when content grows or shrinks and releases its observer', () => {
  let height = 900;
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const scene = this.classList.contains('scene');
    return { top: 0, bottom: scene ? 940 : height, width: 1672, height: scene ? 940 : height } as DOMRect;
  });
  const { container, rerender, unmount } = render(<Artwork />);
  const extensions = () => container.querySelectorAll('.circuit-extension');
  expect(extensions()).toHaveLength(0);

  act(() => { height = 2400; resize(); });
  expect(extensions()).toHaveLength(3);
  expect(extensions()[1].querySelectorAll('.electric-route')).toHaveLength(3);
  // Reduced motion leaves the same geometry in place with flashes disabled.
  expect(extensions()[1].querySelector<SVGGElement>('.electric-route')?.style.opacity).toBe('0');

  rerender(<Artwork simple />);
  expect(container.firstElementChild?.classList.contains('artwork-simple')).toBe(true);
  act(() => { height = 1100; resize(); });
  expect(extensions()).toHaveLength(1);
  act(() => { height = 900; resize(); });
  expect(extensions()).toHaveLength(0);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
