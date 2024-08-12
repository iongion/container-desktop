import * as Docker from "./docker";
import * as Podman from "./podman";

export { Docker, Podman };

export const adapters = {
  Docker,
  Podman
};

export default adapters;
