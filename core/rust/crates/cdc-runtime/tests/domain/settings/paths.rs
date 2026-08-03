//! Finding the same `user-settings.json` the desktop app uses.
//!
//! A core that resolves a different path looks like it works while managing a parallel universe of
//! connections, which is worse than failing. Two oracles agree on the rule and both are ported here:
//! `Host.getUserDataPath()` in the app's JS host and
//! `get_user_data_path()` in `src-tauri/src/host/platform.rs`.
//!
//! The OS is a parameter rather than `cfg!`, so the Windows and macOS branches are checkable from
//! Linux. Untestable-here branches would otherwise be asserted by reading, which is not evidence.

use cdc_runtime::domain::settings::paths::{
    UserDataEnvironment, user_data_path, user_settings_path,
};
use cdc_runtime::domain::types::os::OperatingSystem;

fn env() -> UserDataEnvironment {
    UserDataEnvironment {
        explicit_user_data_dir: None,
        home: "/home/user".to_string(),
        xdg_config_home: None,
        current_dir: "/work".to_string(),
    }
}

#[test]
fn linux_defaults_to_dot_config() {
    assert_eq!(
        user_data_path(OperatingSystem::Linux, &env()),
        "/home/user/.config/container-desktop"
    );
}

#[test]
fn a_windows_root_relative_directory_is_already_absolute() {
    // `path.isAbsolute` accepts a leading separator as well as a drive letter, so a UNC share is
    // taken as it stands rather than being joined onto the working directory.
    let environment = UserDataEnvironment {
        explicit_user_data_dir: Some("\\\\server\\share\\container-desktop".to_string()),
        ..env()
    };

    assert_eq!(
        user_data_path(OperatingSystem::WindowsNt, &environment),
        "\\\\server\\share\\container-desktop"
    );
}

#[test]
fn linux_honours_xdg_config_home() {
    let environment = UserDataEnvironment {
        xdg_config_home: Some("/home/user/.xdg".to_string()),
        ..env()
    };
    assert_eq!(
        user_data_path(OperatingSystem::Linux, &environment),
        "/home/user/.xdg/container-desktop"
    );
}

#[test]
fn an_empty_xdg_config_home_falls_back() {
    // `if (XDG_CONFIG_HOME)` in TypeScript and `!xdg.is_empty()` in Rust agree: empty is unset.
    let environment = UserDataEnvironment {
        xdg_config_home: Some(String::new()),
        ..env()
    };
    assert_eq!(
        user_data_path(OperatingSystem::Linux, &environment),
        "/home/user/.config/container-desktop"
    );
}

#[test]
fn macos_uses_application_support() {
    assert_eq!(
        user_data_path(OperatingSystem::Darwin, &env()),
        "/home/user/Library/Application Support/container-desktop"
    );
}

#[test]
fn windows_uses_roaming_appdata_with_backslashes() {
    let environment = UserDataEnvironment {
        home: "C:\\Users\\user".to_string(),
        ..env()
    };
    assert_eq!(
        user_data_path(OperatingSystem::WindowsNt, &environment),
        "C:\\Users\\user\\AppData\\Roaming\\container-desktop"
    );
}

#[test]
fn an_explicit_absolute_override_wins_on_every_os() {
    let environment = UserDataEnvironment {
        explicit_user_data_dir: Some("/tmp/cdc-test".to_string()),
        xdg_config_home: Some("/ignored".to_string()),
        ..env()
    };
    for os in [
        OperatingSystem::Linux,
        OperatingSystem::Darwin,
        OperatingSystem::WindowsNt,
    ] {
        assert_eq!(user_data_path(os, &environment), "/tmp/cdc-test");
    }
}

#[test]
fn an_explicit_relative_override_resolves_against_the_working_directory() {
    let environment = UserDataEnvironment {
        explicit_user_data_dir: Some("fixtures/data".to_string()),
        ..env()
    };
    assert_eq!(
        user_data_path(OperatingSystem::Linux, &environment),
        "/work/fixtures/data"
    );
}

#[test]
fn a_windows_drive_letter_counts_as_absolute() {
    let environment = UserDataEnvironment {
        explicit_user_data_dir: Some("D:\\data".to_string()),
        home: "C:\\Users\\user".to_string(),
        current_dir: "C:\\work".to_string(),
        ..env()
    };
    assert_eq!(
        user_data_path(OperatingSystem::WindowsNt, &environment),
        "D:\\data"
    );
}

#[test]
fn an_empty_explicit_override_is_ignored() {
    let environment = UserDataEnvironment {
        explicit_user_data_dir: Some(String::new()),
        ..env()
    };
    assert_eq!(
        user_data_path(OperatingSystem::Linux, &environment),
        "/home/user/.config/container-desktop"
    );
}

#[test]
fn the_settings_file_sits_directly_in_the_user_data_directory() {
    assert_eq!(
        user_settings_path(OperatingSystem::Linux, &env()),
        "/home/user/.config/container-desktop/user-settings.json"
    );
    let windows = UserDataEnvironment {
        home: "C:\\Users\\user".to_string(),
        ..env()
    };
    assert_eq!(
        user_settings_path(OperatingSystem::WindowsNt, &windows),
        "C:\\Users\\user\\AppData\\Roaming\\container-desktop\\user-settings.json"
    );
}
