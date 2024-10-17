import type { Container } from "@/env/Types";
import { pathTo } from "@/web-app/Navigator";

export const getContainerUrl = (id: string, view: string) => {
  return pathTo(`/screens/container/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};

export const getContainerServiceUrl = (container: Container) => {
  const port = (container.Ports || [])[0];
  let serviceUrl = "";
  if (port) {
    if (port.PublicPort) {
      serviceUrl = `http://localhost:${port.PublicPort}`;
    } else {
      const hostIp = port.hostIP || port.host_ip || "localhost";
      const hostPort = port.hostPort || port.host_port || 80;
      serviceUrl = `http://${hostIp === "0.0.0.0" ? "localhost" : hostIp}:${hostPort}`;
    }
  } else {
    const portFromNetworkSettings = container.NetworkSettings?.Ports || {};
    const servicePorts = Object.values(portFromNetworkSettings);
    const [firstPort] = servicePorts;
    if (firstPort?.[0]) {
      const hostIp = firstPort[0].HostIp || "localhost";
      serviceUrl = `http://${hostIp === "0.0.0.0" ? "localhost" : hostIp}:${firstPort[0].HostPort}`;
    }
  }
  // console.debug("Obtaining container web server URL", container, { serviceUrl, port });
  return serviceUrl;
};
