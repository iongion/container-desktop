//! Where `user-settings.json` lives, resolved exactly as the app resolves it.
//!
//! Pure on purpose: the environment arrives as data and the OS is a parameter, so the Windows and
//! macOS branches are checkable from a Linux workstation. `cfg!` would make two thirds of this rule
//! unverifiable anywhere one developer sits.

use crate::domain::pathing::{is_absolute, join};
use crate::domain::types::os::OperatingSystem;

/// `import.meta.env.PROJECT_NAME || "container-desktop"` in the JS host, a literal in Tauri. Both
/// resolve to the package name, and it is the directory the shipping app is using today.
const APP_DIRECTORY: &str = "container-desktop";

const SETTINGS_FILE: &str = "user-settings.json";

/// Everything the resolution reads from the process, as data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserDataEnvironment {
    /// `CONTAINER_DESKTOP_USER_DATA_DIR`. Absolute wins outright; relative resolves against
    /// `current_dir`.
    pub explicit_user_data_dir: Option<String>,
    pub home: String,
    /// `XDG_CONFIG_HOME`, Linux only.
    pub xdg_config_home: Option<String>,
    pub current_dir: String,
}

pub fn user_data_path(os: OperatingSystem, environment: &UserDataEnvironment) -> String {
    if let Some(explicit) = non_empty(environment.explicit_user_data_dir.as_deref()) {
        return if is_absolute(os, explicit) {
            explicit.to_string()
        } else {
            join(os, &environment.current_dir, explicit)
        };
    }
    match os {
        OperatingSystem::WindowsNt => join(
            os,
            &join(os, &environment.home, "AppData\\Roaming"),
            APP_DIRECTORY,
        ),
        OperatingSystem::Darwin => join(
            os,
            &join(os, &environment.home, "Library/Application Support"),
            APP_DIRECTORY,
        ),
        _ => match non_empty(environment.xdg_config_home.as_deref()) {
            Some(xdg) => join(os, xdg, APP_DIRECTORY),
            None => join(os, &join(os, &environment.home, ".config"), APP_DIRECTORY),
        },
    }
}

pub fn user_settings_path(os: OperatingSystem, environment: &UserDataEnvironment) -> String {
    join(os, &user_data_path(os, environment), SETTINGS_FILE)
}

/// An empty string is unset. `if (VALUE)` in TypeScript and `!value.is_empty()` in the Tauri host
/// agree on that, and an empty `XDG_CONFIG_HOME` is common enough to matter.
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|it| !it.is_empty())
}
