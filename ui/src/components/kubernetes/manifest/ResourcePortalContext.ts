import { createContext, type RefObject } from 'react';

/** Portaled controls must remain inside the owning native dialog's top layer. */
export const ResourcePortalContext = createContext<RefObject<HTMLElement | null> | undefined>(undefined);
