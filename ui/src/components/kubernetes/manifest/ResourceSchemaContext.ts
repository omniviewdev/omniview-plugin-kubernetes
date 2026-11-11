import { createContext } from 'react';
import type { SchemaRequest } from '@omniviewdev/runtime';

/** Exact editor-owned target for mounted field consumers; this context owns no I/O or cache. */
export const ResourceSchemaContext = createContext<SchemaRequest | undefined>(undefined);
