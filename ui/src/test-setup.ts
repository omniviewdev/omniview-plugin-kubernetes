import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';

// Register on the same Vitest instance as the tests, including peer-scoped installs.
expect.extend(matchers);

afterEach(cleanup);

const domWindow = (
  globalThis as typeof globalThis & {
    jsdom: { window: Pick<Window, 'localStorage' | 'sessionStorage'> };
  }
).jsdom.window;
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
