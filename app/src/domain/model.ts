// vendors
import { action, Action, Thunk, thunk, Computed, computed } from "easy-peasy";
import { v4 } from "uuid";
// project
import {
  Program,
  Machine,
  Volume,
  Container,
  ContainerImage,
  Secret,
  SystemInfo,
  ContainerStats,
  SystemConnection
} from "../Types";
import { findAPI } from "../Api";
import {
  FetchDomainOptions,
  FetchImageOptions,
  FetchContainerOptions,
  FetchVolumeOptions,
  FetchSecretOptions,
  CreateContainerOptions,
  CreateVolumeOptions,
  CreateSecretOptions,
  FetchMachineOptions,
  CreateMachineOptions
} from "../Api.clients";
import { Native, Platforms } from "../Native";
import { CURRENT_ENVIRONMENT, PROGRAM_PODMAN, PROGRAM_DEFAULT } from "../Environment";

const PROGRAMS = {
  podman: PROGRAM_PODMAN
};

interface ConnectOptions {
  autoStart: boolean;
}
interface AppModelState {
  revision: number;
  hash: string;

  inited: boolean;
  pending: boolean;
  running: boolean;
  native: boolean;

  platform: Platforms;
  currentProgram: string;

  system: SystemInfo;
  program: Program;
  connections: SystemConnection[];

  containers: Container[];
  containersMap: { [key: string]: Container };

  images: ContainerImage[];
  machines: Machine[];
  secrets: Secret[];
  volumes: Volume[];
}

export interface AppModel extends AppModelState {
  // actions
  setInited: Action<AppModel, boolean>;
  setPending: Action<AppModel, boolean>;
  setRunning: Action<AppModel, boolean>;
  setProgram: Action<AppModel, Program>;
  setSystem: Action<AppModel, SystemInfo>;
  setContainers: Action<AppModel, Container[]>;
  setImages: Action<AppModel, ContainerImage[]>;
  setSecrets: Action<AppModel, Secret[]>;
  setMachines: Action<AppModel, Machine[]>;
  setVolumes: Action<AppModel, Volume[]>;
  domainReset: Action<AppModel, Partial<AppModelState>>;
  domainUpdate: Action<AppModel, Partial<AppModelState>>;
  imageUpdate: Action<AppModel, Partial<ContainerImage>>;
  containerUpdate: Action<AppModel, Partial<Container>>;
  containerDelete: Action<AppModel, Partial<Container>>;
  imageDelete: Action<AppModel, Partial<ContainerImage>>;
  secretDelete: Action<AppModel, Partial<Secret>>;
  machineDelete: Action<AppModel, Partial<Machine>>;

  // thunks
  connect: Thunk<AppModel, ConnectOptions>;
  domainFetch: Thunk<AppModel, FetchDomainOptions | undefined>;

  programSetPath: Thunk<AppModel, string>;

  imagesFetch: Thunk<AppModel>;
  imageFetch: Thunk<AppModel, FetchImageOptions>;
  imageFetchHistory: Thunk<AppModel, FetchImageOptions>;
  imagePull: Thunk<AppModel, Partial<ContainerImage>>;
  imagePush: Thunk<AppModel, Partial<ContainerImage>>;
  imageRemove: Thunk<AppModel, Partial<ContainerImage>>;

  containersFetch: Thunk<AppModel>;
  containerFetch: Thunk<AppModel, FetchContainerOptions>;
  containerStop: Thunk<AppModel, Partial<Container>>;
  containerRestart: Thunk<AppModel, Partial<Container>>;
  containerRemove: Thunk<AppModel, Partial<Container>>;
  containerCreate: Thunk<AppModel, CreateContainerOptions>;
  containersSearchByTerm: Computed<AppModel, (searchTerm: string) => Container[]>;
  containerConnect: Thunk<AppModel, Partial<Container>>;

  troubleShootPrune: Thunk<AppModel>;
  troubleShootReset: Thunk<AppModel>;

  volumesFetch: Thunk<AppModel>;
  volumeFetch: Thunk<AppModel, FetchVolumeOptions>;
  volumeCreate: Thunk<AppModel, CreateVolumeOptions>;
  volumeRemove: Thunk<AppModel, Partial<Volume>>;

  secretsFetch: Thunk<AppModel>;
  secretFetch: Thunk<AppModel, FetchSecretOptions>;
  secretCreate: Thunk<AppModel, CreateSecretOptions>;
  secretRemove: Thunk<AppModel, Partial<Secret>>;
  secretsSearchByTerm: Computed<AppModel, (searchTerm: string) => Secret[]>;

  machinesFetch: Thunk<AppModel>;
  machineFetch: Thunk<AppModel, FetchMachineOptions>;
  machineCreate: Thunk<AppModel, CreateMachineOptions>;
  machineRemove: Thunk<AppModel, Partial<Machine>>;
  machineStop: Thunk<AppModel, Partial<Machine>>;
  machineRestart: Thunk<AppModel, Partial<Machine>>;
  machineConnect: Thunk<AppModel, Partial<Machine>>;
  machinesSearchByTerm: Computed<AppModel, (searchTerm: string) => Machine[]>;
}

const env = CURRENT_ENVIRONMENT;
const api = findAPI(env);
if (api === undefined) {
  console.error("No such API environment", env);
  throw new Error("API instance is mandatory");
}
const withPending = async (state: any, operation: any) => {
  let result = {
    success: false,
    body: "",
    warnings: []
  };
  state.setPending(true);
  try {
    result = await operation();
  } catch (error: any) {
    result = {
      ...result,
      body: error?.response?.data || error.message
    };
    console.error("Pending operation error", result, error);
    state.setPending(false);
    // if (error?.message.indexOf("connect ECONNREFUSED") !== -1) {
    //   console.debug("Connection broken");
    //   state.setRunning(false);
    // }
    console.debug("Forwarding error", { result, error });
    throw error;
  } finally {
    state.setPending(false);
  }
  return result;
};
const native = Native.getInstance().isNative();
const platform = Native.getInstance().getPlatform();
const model: AppModel = {
  hash: v4(),
  revision: 0,
  inited: false,
  pending: false,
  running: false,
  native,
  platform,
  currentProgram: PROGRAM_DEFAULT,
  program: {
    ...PROGRAMS[PROGRAM_DEFAULT],
    path: undefined,
    currentVersion: undefined,
    platform: Platforms.Unknown
  },
  system: {} as any,
  connections: [],
  containers: [],
  containersMap: {},
  images: [],
  machines: [],
  secrets: [],
  volumes: [],
  // Actions
  setInited: action((state, inited) => {
    state.inited = inited;
  }),
  setPending: action((state, pending) => {
    state.pending = pending;
  }),
  setRunning: action((state, running) => {
    state.running = running;
  }),
  setProgram: action((state, program) => {
    state.program = program;
  }),
  setContainers: action((state, containers) => {
    state.containers = containers;
  }),
  setImages: action((state, images) => {
    state.images = images;
  }),
  setMachines: action((state, machines) => {
    state.machines = machines;
  }),
  setSecrets: action((state, secrets) => {
    state.secrets = secrets;
  }),
  setVolumes: action((state, volumes) => {
    state.volumes = volumes;
  }),
  setSystem: action((state, system) => {
    state.system = system;
  }),
  domainReset: action((state, { inited, pending, running }) => {
    state.inited = inited || false;
    state.pending = pending || false;
    state.running = running || false;
    state.containers = [];
    state.images = [];
    state.machines = [];
    state.volumes = [];
  }),
  domainUpdate: action((state, opts: Partial<AppModelState>) => {
    const { inited, pending, running, system, program, connections, containers, images, machines, secrets, volumes } =
      opts;
    state.hash = v4();
    state.revision += 1;
    console.debug("Updating domain", opts, state.hash, state.revision);
    state.inited = inited === undefined ? state.inited : inited;
    state.pending = pending === undefined ? state.pending : pending;
    state.running = running === undefined ? state.running : running;
    state.system = system === undefined ? state.system : system;
    state.program = program === undefined ? state.program : program;
    state.connections = connections === undefined ? state.connections : connections;
    state.containers = containers === undefined ? state.containers : containers;
    state.images = images === undefined ? state.images : images;
    state.machines = machines === undefined ? state.machines : machines;
    state.secrets = secrets === undefined ? state.secrets : secrets;
    state.volumes = volumes === undefined ? state.volumes : volumes;
  }),
  // domain specific
  imageUpdate: action((state, image) => {
    const existing = state.images.find((it) => it.Id === image.Id);
    if (existing) {
      // Transfer all keys
      Object.entries(image).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
    }
  }),
  imageDelete: action((state, image) => {
    const existingPos = state.images.findIndex((it) => it.Id === image.Id);
    if (existingPos !== -1) {
      state.images.splice(existingPos, 1);
    }
    console.warn("TODO - must delete all associated containers");
  }),
  // container
  containerUpdate: action((state, container) => {
    const existing = state.containers.find((it) => it.Id === container.Id);
    if (existing) {
      // Transfer all keys
      Object.entries(container).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
      existing.Logs = existing.Logs || [];
      existing.Config = existing.Config || { Env: [] };
    }
  }),
  containerDelete: action((state, container) => {
    const existingPos = state.containers.findIndex((it) => it.Id === container.Id);
    if (existingPos !== -1) {
      state.containers.splice(existingPos, 1);
    }
  }),
  secretDelete: action((state, secret) => {
    const existingPos = state.secrets.findIndex((it) => it.ID === secret.ID);
    if (existingPos !== -1) {
      state.secrets.splice(existingPos, 1);
    }
  }),
  machineDelete: action((state, machine) => {
    const existingPos = state.machines.findIndex((it) => it.Name === machine.Name);
    if (existingPos !== -1) {
      state.machines.splice(existingPos, 1);
    }
  }),

  // Thunks
  connect: thunk(async (actions, options) => {
    console.debug("Connecting to system service", options);
    if (native) {
      Native.getInstance().setup();
    }
    return withPending(actions, async () => {
      const environment = await api.getSystemEnvironment();
      let system: SystemInfo | undefined;
      try {
        const startup = await api.startSystemService();
        system = startup.system;
      } catch (error) {
        console.error("Error during system startup", error);
      }
      console.debug("System startup info is", environment, system);
      actions.domainUpdate({
        program: environment.program,
        connections: environment.connections,
        system: system,
        inited: true,
        running: true
      });
    });
  }),
  programSetPath: thunk(async (actions, program) => {
    return withPending(actions, async () => {
      const newProgram = await api.setProgramPath(program);
      actions.domainUpdate({ program: newProgram });
    });
  }),
  domainFetch: thunk(async (actions, options) => {
    return withPending(actions, async () => {
      const domain = await api.getDomain();
      actions.domainUpdate({ ...domain });
    });
  }),
  // images
  imagesFetch: thunk(async (actions) =>
    withPending(actions, async () => {
      const images = await api.getImages();
      actions.setImages(images);
      return images;
    })
  ),
  imageFetch: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const image = await api.getImage(options.Id, options);
      actions.imageUpdate(image);
      return image;
    })
  ),
  imageFetchHistory: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const history = await api.getImageHistory(options.Id);
      actions.imageUpdate({ Id: options.Id, History: history });
      return history;
    })
  ),
  imagePull: thunk(async (actions, image) =>
    withPending(actions, async () => {
      let pulled = false;
      if (image.Names) {
        pulled = await api.pullImage(image.Names[0]);
      }
      if (pulled) {
        actions.imageDelete(image);
      }
      return pulled;
    })
  ),
  imagePush: thunk(async (actions, image) =>
    withPending(actions, async () => {
      let pushed = false;
      if (image.Id) {
        pushed = await api.pushImage(image.Id);
      }
      return pushed;
    })
  ),
  imageRemove: thunk(async (actions, image) =>
    withPending(actions, async () => {
      let removed = false;
      if (image.Id) {
        removed = await api.removeImage(image.Id);
      }
      if (removed) {
        actions.imageDelete(image);
      }
      return removed;
    })
  ),
  // containers
  containersFetch: thunk(async (actions) =>
    withPending(actions, async () => {
      const containers = await api.getContainers();
      actions.setContainers(containers);
      return containers;
    })
  ),
  containersSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      return state.containers.filter((it) => {
        const haystacks = [it.Names[0] || "", it.Image, it.Id, `${it.Pid}`, `${it.Size}`].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  }),
  containerFetch: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let logs: string[] = [];
      try {
        logs = options.withLogs ? await api.getContainerLogs(options.Id) : [];
      } catch (error) {
        console.error("Unable to retrieve logs", error);
      }
      let stats: ContainerStats | null = null;
      try {
        stats = options.withStats ? await api.getContainerStats(options.Id) : null;
      } catch (error) {
        console.error("Unable to retrieve stats", error);
      }
      const container = await api.getContainer(options.Id);
      const hydrated: Container = { ...container, Logs: logs, Stats: stats };
      actions.containerUpdate(hydrated);
      return hydrated;
    })
  ),
  containerStop: thunk(async (actions, container) =>
    withPending(actions, async () => {
      let removed = false;
      if (container.Id) {
        removed = await api.stopContainer(container.Id);
      }
      if (removed) {
        actions.containerDelete(container);
      }
      return removed;
    })
  ),
  containerRestart: thunk(async (actions, container) =>
    withPending(actions, async () => {
      let restarted = false;
      if (container.Id) {
        restarted = await api.restartContainer(container.Id);
        if (restarted) {
          const freshContainer = await api.getContainer(container.Id);
          actions.containerUpdate(freshContainer);
        }
      }
      return restarted;
    })
  ),
  containerRemove: thunk(async (actions, container) =>
    withPending(actions, async () => {
      let removed = false;
      if (container.Id) {
        removed = await api.removeContainer(container.Id);
      }
      if (removed) {
        actions.containerDelete(container);
      }
      return removed;
    })
  ),
  containerCreate: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const created = await api.createContainer(options);
      return created;
    })
  ),
  containerConnect: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let connected = false;
      if (options.Id) {
        const result = await api.connectToContainer(options.Id);
        console.debug("Connect result", result);
        connected = true;
      } else {
        console.warn("Unable to connect to container without name", options);
      }
      return connected;
    })
  ),
  // volumes
  volumesFetch: thunk(async (actions) =>
    withPending(actions, async () => {
      const volumes = await api.getVolumes();
      actions.setVolumes(volumes);
      return volumes;
    })
  ),
  volumeFetch: thunk(async (actions, opts) =>
    withPending(actions, async () => {
      const volume = await api.getVolume(opts.Id);
      return volume;
    })
  ),
  volumeCreate: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const created = await api.createVolume(options);
      return created;
    })
  ),
  volumeRemove: thunk(async (actions, volume) =>
    withPending(actions, async () => {
      let removed = false;
      if (volume.Name) {
        removed = await api.removeVolume(volume.Name);
      }
      return removed;
    })
  ),
  // secrets
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
  }),
  // machines
  machinesFetch: thunk(async (actions) =>
    withPending(actions, async () => {
      const machines = await api.getMachines();
      actions.setMachines(machines);
      return machines;
    })
  ),
  machineStop: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let stopped = false;
      if (options.Name) {
        const result = await api.stopMachine(options.Name);
        console.debug("Stop result", result);
        stopped = true;
      }
      return stopped;
    })
  ),
  machineRestart: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let restarted = false;
      if (options.Name) {
        const result = await api.restartMachine(options.Name);
        console.debug("Restart result", result);
        restarted = true;
      }
      return restarted;
    })
  ),
  machineConnect: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let connected = false;
      if (options.Name) {
        const result = await api.connectToMachine(options.Name);
        console.debug("Connect result", result);
        connected = true;
      }
      return connected;
    })
  ),
  machineFetch: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const machine = await api.getMachine(options.Name);
      return machine;
    })
  ),
  machineCreate: thunk(async (actions, options) =>
    withPending(actions, async () => {
      const created = await api.createMachine(options);
      return created;
    })
  ),
  machineRemove: thunk(async (actions, options) =>
    withPending(actions, async () => {
      let removed = false;
      if (options.Name) {
        removed = await api.removeMachine(options.Name);
        if (removed) {
          actions.machineDelete(options);
        }
      }
      return removed;
    })
  ),
  machinesSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      return state.machines.filter((it) => {
        const haystacks = [it.Name, it.VMType].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  }),
  // troubleshoot
  troubleShootPrune: thunk(async (actions) =>
    withPending(actions, async () => {
      const report = await api.pruneSystem();
      if (report) {
        try {
          await actions.domainFetch();
        } catch (error) {
          console.error("Unable to reload domain", error);
        }
      }
      return report;
    })
  ),
  troubleShootReset: thunk(async (actions) =>
    withPending(actions, async () => {
      const report = await api.resetSystem();
      if (report) {
        console.debug("Report is here", report);
        const domain = await api.getDomain();
        actions.domainUpdate({ ...domain });
      }
      return report;
    })
  )
};

export { model };
