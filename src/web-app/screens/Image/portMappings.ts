import type { ContainerImagePortMapping } from "@/container-client/types/image";
import { randomUUID } from "@/utils/randomUUID";

const DEFAULT_HOST_IP = "0.0.0.0";

export const createPortMapping = (): ContainerImagePortMapping => {
  return {
    guid: randomUUID(),
    container_port: 80,
    host_ip: DEFAULT_HOST_IP,
    host_port: 8080,
    protocol: "tcp",
  };
};

export const toPortMappings = (exposed: { [key: string]: number }) => {
  const mappings: ContainerImagePortMapping[] = Object.keys(exposed).map((key) => {
    const [container_port_raw, protocol] = key.split("/");
    const container_port = Number(container_port_raw);
    const host_port = container_port < 1000 ? 8000 + container_port : container_port;
    return {
      guid: randomUUID(),
      container_port: Number(container_port),
      host_ip: DEFAULT_HOST_IP,
      host_port: host_port,
      protocol: protocol as any,
    };
  });
  return mappings;
};
