// vendors
import { Action, Thunk, Computed, action, thunk, computed, createTypedHooks } from "easy-peasy";
// project
import { AppModelAccessor } from "../../domain/types";
import { api, withPending } from "../../domain/client";
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

export const createModel = (accessor: AppModelAccessor): SecretsModel => ({
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
    withPending(actions, async () => {
      const secrets = await api.getSecrets();
      actions.setSecrets(secrets);
      return secrets;
    })
  ),
  secretFetch: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const secret = await api.getSecret(options.Id);
      return secret;
    })
  ),
  secretCreate: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const created = await api.createSecret(options);
      return created;
    })
  ),
  secretRemove: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let removed = false;
      if (options.ID) {
        removed = await api.removeSecret(options.ID);
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

const typedHooks = createTypedHooks<SecretsModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;

const Factory = { create: (accessor: AppModelAccessor) => createModel(accessor) };

export default Factory;
