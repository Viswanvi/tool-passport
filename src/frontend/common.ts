import { xcss } from '@forge/react';
import { invoke } from '@forge/bridge';

/** Shared by the UI Kit screens. The page decides nothing: the resolvers check and answer everything. */

export interface Option {
  label: string;
  value: string;
}

export const cardStyle = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'radius.medium',
  padding: 'space.200',
});

/** invoke() resolves to the resolver's return value when no metadata is asked for. */
export async function call<T>(key: string, payload: Record<string, unknown> = {}): Promise<T> {
  return (await invoke(key, payload)) as T;
}
