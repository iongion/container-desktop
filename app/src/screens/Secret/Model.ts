// vendors
import { Action, Thunk, Computed, action, thunk, computed } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { Secret } from "../../Types";
import { FetchSecretOptions, CreateSecretOptions } from "../../Api.clients";

export interface SecretsModelState {
  secrets: Secret[];
}

export interface SecretsModel extends SecretsModelState {
  secrets: Secret[];
  // actions
  setSecrets: Action<SecretsModel, Secret[]>;
  secretUpdate: Action<SecretsModel, Partial<Secret>>;
  secretDelete: Action<SecretsModel, Partial<Secret>>;
  // thunks
  secretsFetch: Thunk<SecretsModel>;
  secretFetch: Thunk<SecretsModel, FetchSecretOptions>;
  secretCreate: Thunk<SecretsModel, CreateSecretOptions>;
  secretRemove: Thunk<SecretsModel, Partial<Secret>>;
  secretsSearchByTerm: Computed<SecretsModel, (searchTerm: string) => Secret[]>;
}

export const createModel = (registry: AppRegistry): SecretsModel => ({
  secrets: [],
  // actions
  setSecrets: action((state, secrets) => {
    state.secrets = secrets;
  }),
  secretUpdate: action((state, secret) => {
    const existing = state.secrets.find((it) => it.ID === secret.ID);
    if (existing) {
      // Transfer all keys
      Object.entries(secret).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
    }
  }),
  secretDelete: action((state, secret) => {
    const existingPos = state.secrets.findIndex((it) => it.ID === secret.ID);
    if (existingPos !== -1) {
      state.secrets.splice(existingPos, 1);
    }
  }),
  // thunks
  secretsFetch: thunk(async (actions) =>
    registry.withPending(async () => {
      const secrets = await registry.api.getSecrets();
      actions.setSecrets(secrets);
      return secrets;
    })
  ),
  secretFetch: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const secret = await registry.api.getSecret(options.Id);
      return secret;
    })
  ),
  secretCreate: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const created = await registry.api.createSecret(options);
      return created;
    })
  ),
  secretRemove: thunk(async (actions, options) =>
    registry.withPending(async () => {
      let removed = false;
      if (options.ID) {
        removed = await registry.api.removeSecret(options.ID);
        if (removed) {
          actions.secretDelete(options);
        }
      }
      return removed;
    })
  ),
  secretsSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      return state.secrets.filter((it) => {
        const haystacks = [it.ID, it.Spec.Name, it.Spec.Driver.Name].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  })
});

const Factory = { create: (registry: AppRegistry) => createModel(registry) };

export default Factory;
