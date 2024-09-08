import { Action, Computed, Thunk, action, computed, thunk } from "easy-peasy";

import { CreateSecretOptions, FetchSecretOptions } from "@/container-client/Api.clients";
import { Secret } from "@/env/Types";
import { AppRegistry, ResetableModel } from "@/web-app/domain/types";
import { sortAlphaNum } from "@/web-app/domain/utils";

export interface SecretsModelState {
  secrets: Secret[];
}

export interface SecretsModel extends SecretsModelState, ResetableModel<SecretsModel> {
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

export const createModel = async (registry: AppRegistry): Promise<SecretsModel> => ({
  secrets: [],
  // actions
  reset: action((state) => {
    state.secrets = [];
  }),
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
      const client = await registry.getContainerClient();
      const secrets = await client.getSecrets();
      actions.setSecrets(secrets);
      return secrets;
    })
  ),
  secretFetch: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const secret = await client.getSecret(options.Id);
      return secret;
    })
  ),
  secretCreate: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const created = await client.createSecret(options);
      return created;
    })
  ),
  secretRemove: thunk(async (actions, options) =>
    registry.withPending(async () => {
      let removed = false;
      if (options.ID) {
        const client = await registry.getContainerClient();
        removed = await client.removeSecret(options.ID);
        if (removed) {
          actions.secretDelete(options);
        }
      }
      return removed;
    })
  ),
  secretsSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      if (!searchTerm) {
        return state.secrets.sort((a, b) => sortAlphaNum(a.Spec.Name, b.Spec.Name));
      }
      return state.secrets
        .sort((a, b) => sortAlphaNum(a.Spec.Name, b.Spec.Name))
        .filter((it) => {
          const haystacks = [it.ID, it.Spec.Name, it.Spec.Driver.Name].map((t) => t.toLowerCase());
          const matching = haystacks.find((it) => it.includes(searchTerm));
          return !!matching;
        });
    };
  })
});
