import { pathTo } from "../../Navigator";
import { Container } from "../../Types.container-app";

export const getContainerUrl = (id: string, view: string) => {
  return pathTo(`/screens/container/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};

export const getContainerServiceUrl = (container: Container) => {
  const port = (container.Ports || [])[0];
  let serviceUrl;
  if (port) {
    const hostIp = port.hostIP || port.host_ip || "localhost";
    const hostPort = port.hostPort || port.host_port || 80;
    serviceUrl = `http://${hostIp}:${hostPort}`;
  } else {
    const portFromNetworkSettings = container.NetworkSettings?.Ports || {};
    const servicePorts = Object.values(portFromNetworkSettings);
    const [firstPort] = servicePorts;
    if (firstPort && firstPort[0]) {
      serviceUrl = `http://${firstPort[0].HostIp || "localhost"}:${firstPort[0].HostPort}`;
    }
  }
  // console.debug("Obtaining container web server URL", container, { serviceUrl, port });
  return serviceUrl;
};
