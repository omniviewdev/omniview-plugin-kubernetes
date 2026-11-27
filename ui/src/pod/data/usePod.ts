import {
  useKindObject,
  type KindObjectView,
  type UseKindObjectOptions,
} from '../../kinds/detail/useKindObject';
import { podDefinition } from '../../kinds/pods/definition';

import { podDetail, type PodDetail } from './object';

/** Pod presentation may be retained. Launch and menu callers use only `currentRecord` from the same single-object source as other details. */
export type PodView = KindObjectView & { readonly pod: PodDetail | undefined };

export type UsePodOptions = UseKindObjectOptions & { readonly namespace: string };

export function usePod(options: UsePodOptions): PodView {
  const view = useKindObject(podDefinition, options);
  return { ...view, pod: view.record === undefined ? undefined : podDetail(view.record) };
}
