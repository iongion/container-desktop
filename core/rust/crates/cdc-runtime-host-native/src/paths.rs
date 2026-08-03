//! Reading the process environment the path rule needs.
//!
//! The rule itself is pure and lives in `cdc_runtime::domain::settings::paths`. This is the three-line
//! impure edge that hands it the real `HOME`, `XDG_CONFIG_HOME` and
//! `CONTAINER_DESKTOP_USER_DATA_DIR` — kept apart precisely so the rule stays checkable for every
//! OS from any one of them.

use std::path::PathBuf;

use cdc_runtime::domain::settings::paths::{
    UserDataEnvironment, user_data_path, user_settings_path,
};
use cdc_runtime::domain::types::os::OperatingSystem;

/// The OS this binary was built for, in the oracle's vocabulary.
pub fn current_os() -> OperatingSystem {
    os_for_target(std::env::consts::OS)
}

/// The mapping, with the target as data.
///
/// `cfg!` would make two thirds of this unverifiable from any one machine — the same reason
/// `cdc_runtime::domain::settings::paths` takes the OS as a parameter. `Windows_NT` and `Darwin` are what
/// `os.type()` reports in the app, and the casing really is inconsistent.
pub fn os_for_target(target_os: &str) -> OperatingSystem {
    match target_os {
        "windows" => OperatingSystem::WindowsNt,
        "macos" => OperatingSystem::Darwin,
        _ => OperatingSystem::Linux,
    }
}

pub fn current_environment() -> UserDataEnvironment {
    UserDataEnvironment {
        explicit_user_data_dir: std::env::var("CONTAINER_DESKTOP_USER_DATA_DIR").ok(),
        home: home_directory(),
        xdg_config_home: std::env::var("XDG_CONFIG_HOME").ok(),
        current_dir: std::env::current_dir()
            .map(|it| it.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

/// The directory the desktop app keeps `user-settings.json`, its logs and its sockets in.
pub fn current_user_data_path() -> PathBuf {
    PathBuf::from(user_data_path(current_os(), &current_environment()))
}

/// The file the desktop app is using right now. A core that resolves anything else looks like it
/// works while managing a parallel universe of connections.
pub fn current_user_settings_path() -> PathBuf {
    PathBuf::from(user_settings_path(current_os(), &current_environment()))
}

fn home_directory() -> String {
    std::env::var(home_variable(std::env::consts::OS)).unwrap_or_default()
}

/// Windows has no `HOME`. Data again, for the same reason as [`os_for_target`].
pub fn home_variable(target_os: &str) -> &'static str {
    match target_os {
        "windows" => "USERPROFILE",
        _ => "HOME",
    }
}
