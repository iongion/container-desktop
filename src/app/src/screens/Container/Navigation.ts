import { Container } from "../../Types";
import { pathTo } from "../../Navigator";

export const getContainerUrl = (id: string, view: string) => {
  return pathTo(`/screens/container/${id}/${view}`);
};

export const getContainerServiceUrl = (container: Container) => {
  const port = (container.Ports || [])[0];
  let serviceUrl;
  if (port) {
    serviceUrl = `http://${port.hostIP || "localhost"}:${port.hostPort}`;
  } else {
    const portFromNetworkSettings = container.NetworkSettings?.Ports || {};
    const servicePorts = Object.values(portFromNetworkSettings);
    const [firstPort] = servicePorts;
    if (firstPort && firstPort[0]) {
      serviceUrl = `http://${firstPort[0].HostIp || "localhost"}:${firstPort[0].HostPort}`;
    }
  }
  return serviceUrl;
};
