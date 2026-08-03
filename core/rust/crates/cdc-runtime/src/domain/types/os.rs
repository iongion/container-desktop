//! `types/os.ts` — the operating system, and the scope-type discriminator.
//!
//! `ControllerScopeType` is here because the original declares it here, next to `OperatingSystem`,
//! rather than beside the union it discriminates.

wire_enum! {
    /// Discriminator for the ControllerScope union. Note the SSH member is "SSHConnection", not
    /// "SSHHost".
    ControllerScopeType {
        PodmanMachine = "PodmanMachine",
        WslDistribution = "WSLDistribution",
        LimaInstance = "LIMAInstance",
        SshConnection = "SSHConnection",
    }
}
wire_enum! {
    /// Note the inconsistent casing is deliberate and matches the app:
    /// "Linux"/"Darwin"/"Windows_NT" are capitalised, "browser"/"unknown" are not.
    OperatingSystem {
        Browser = "browser",
        Linux = "Linux",
        Darwin = "Darwin",
        WindowsNt = "Windows_NT",
        Unknown = "unknown",
    }
}
