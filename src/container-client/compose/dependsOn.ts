// Topological start order for Compose services (dependencies started before dependents).
// Pure graph logic, no I/O. DFS post-order preserves declaration order for independent services.

export class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyError";
  }
}

interface ServiceNode {
  name: string;
  dependsOn: string[];
}

/** Return service names ordered so every `depends_on` target precedes the service that needs it. */
export function topologicalStartOrder(services: ServiceNode[]): string[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  const order: string[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();

  const visit = (name: string, from?: string): void => {
    const node = byName.get(name);
    if (!node) {
      throw new DependencyError(`service "${from}" depends on undefined service "${name}"`);
    }
    if (done.has(name)) return;
    if (onStack.has(name)) {
      throw new DependencyError(`dependency cycle detected at service "${name}"`);
    }
    onStack.add(name);
    for (const dep of node.dependsOn) {
      visit(dep, name);
    }
    onStack.delete(name);
    done.add(name);
    order.push(name);
  };

  for (const service of services) {
    visit(service.name);
  }
  return order;
}
