// Homepage content: alternating feature rows, the feature grid, and the books.
export default {
  rows: [
    {
      eyebrow: "Consistent everywhere",
      title: "One interface for every platform",
      copy: "Container Desktop looks and works the same on Windows, macOS and Linux — no mental remapping. It tells you exactly where it stores logs and settings, so you can always see what's happening behind the scenes.",
      bullets: [
        "Identical UI across all operating systems",
        "Transparent about logs &amp; configuration",
        "Debug-friendly by design",
      ],
      img: "/img/podman/000-Overview.png",
      alt: "Container Desktop overview",
      flip: false,
    },
    {
      eyebrow: "Bring your own engine",
      title: "Podman, Docker <i>and</i> Apple&trade; Container, your way",
      copy: "Connect to a native engine on Linux, a virtualized one anywhere, LIMA on macOS, or WSL on Windows — plus Apple&trade; Container on Apple silicon (experimental). Switch engines and connections from one manager.",
      chips: ["PODMAN", "DOCKER", "APPLE", "LIMA", "WSL", "SSH"],
      img: "/img/podman/ConnectionManager.png",
      alt: "Connection Manager",
      flip: true,
    },
    {
      eyebrow: "Containers",
      title: "Full control, no popups in your way",
      copy: "Know the origin and status of every container. Jump to logs, env vars, mounts, ports and live stats. Start, stop, restart, open a terminal, or reach exposed services right in your browser.",
      bullets: [
        "Live logs, stats &amp; inspection",
        "Built-in terminal console",
        "Works the same for Podman, Docker &amp; Apple&trade; Container",
      ],
      img: "/img/podman/Containers.png",
      alt: "Containers",
      flip: false,
    },
    {
      eyebrow: "Settings",
      title: "Yours to configure, top to bottom",
      copy: "Set the theme and monospace font, decide how it starts and sits in the system tray, pick your log level, and always see exactly where settings and logs are stored.",
      bullets: [
        "Theme &amp; monospace font to taste",
        "Startup, tray &amp; update controls",
        "Transparent storage &amp; log paths",
      ],
      img: "/img/podman/UserSettings.png",
      alt: "Settings",
      flip: true,
    },
  ],
  grid: [
    {
      tag: "IMAGES",
      title: "Images",
      copy: "Pull, build, inspect and spawn containers with custom ports and mounts.",
      img: "/img/podman/006-ImageActions.png",
    },
    {
      tag: "SECURITY",
      title: "Image security",
      copy: "Be aware of known vulnerabilities and keep your systems secure.",
      img: "/img/podman/ImageSecurity.png",
    },
    {
      tag: "PODS",
      title: "Pods",
      copy: "Full power of pods — logs, processes, details, and generate kube.",
      img: "/img/podman/Pods.png",
    },
    {
      tag: "NETWORKS",
      title: "Networks",
      copy: "Create and reuse networks anytime with detailed setup per network.",
      img: "/img/podman/NetworkCreate.png",
    },
    {
      tag: "SECRETS",
      title: "Secrets",
      copy: "Define, inspect and purge secrets across your environment.",
      img: "/img/podman/Secrets.png",
    },
    {
      tag: "VOLUMES",
      title: "Volumes",
      copy: "Share volumes across containers — portable and repeat-free.",
      img: "/img/podman/015-VolumeActions.png",
    },
  ],
  books: [
    {
      url: "https://www.manning.com/books/podman-in-action",
      img: "/img/book-podman-in-action.png",
      title: "Podman in Action",
    },
    {
      url: "https://www.packtpub.com/en-be/product/podman-for-devops-9781803248233",
      img: "/img/book-podman-for-devops.png",
      title: "Podman for DevOps",
    },
  ],
};
