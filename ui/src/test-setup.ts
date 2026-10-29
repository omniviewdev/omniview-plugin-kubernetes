import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

const domWindow = (globalThis as typeof globalThis & {
  jsdom: { window: Pick<Window, 'localStorage' | 'sessionStorage'> };
}).jsdom.window;
vi.stubGlobal('localStorage', domWindow.localStorage);
vi.stubGlobal('sessionStorage', domWindow.sessionStorage);

// matchMedia is not implemented by JSDOM.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
