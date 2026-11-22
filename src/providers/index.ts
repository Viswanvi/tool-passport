import type { Environment, EnvironmentReader, EnvRead } from '../engine/model';

/**
 * One interface for every environment (spec section 9, `providers/index`): read(environment) → values,
 * version and record time. Assets and the registry sit behind it; an unknown provider is never guessed.
 */

export interface ProviderFns {
  assets(environment: Environment): Promise<EnvRead>;
  registry(environment: Environment): Promise<EnvRead>;
}

export function environmentReader(p: ProviderFns): EnvironmentReader {
  return {
    async read(environment) {
      if (environment.provider === 'assets') return p.assets(environment);
      if (environment.provider === 'registry') return p.registry(environment);
      return { ok: false, reason: 'not_found', detail: 'Unknown environment provider' };
    },
  };
}
