//! Resolving the path against the real environment.
//!
//! The per-OS rule is pinned in `cdc-runtime/tests/settings_paths.rs`, where the OS is data. This is
//! the other half: that the impure edge feeds it the right variables on the machine it runs on.

use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime_host_native::paths::{
    current_os, current_user_data_path, current_user_settings_path, home_variable, os_for_target,
};

#[test]
fn every_target_maps_to_the_oracles_own_vocabulary() {
    // `os.type()` in the app, casing and all. The target is data rather than `cfg!` so the two
    // answers this machine cannot produce are still checkable from it.
    assert_eq!(os_for_target("windows"), OperatingSystem::WindowsNt);
    assert_eq!(os_for_target("macos"), OperatingSystem::Darwin);
    assert_eq!(os_for_target("linux"), OperatingSystem::Linux);
    assert_eq!(
        os_for_target("freebsd"),
        OperatingSystem::Linux,
        "anything POSIX resolves its settings the way Linux does"
    );
    assert_eq!(current_os(), os_for_target(std::env::consts::OS));
}

#[test]
fn the_home_directory_comes_from_a_different_variable_on_windows() {
    assert_eq!(home_variable("windows"), "USERPROFILE");
    assert_eq!(home_variable("linux"), "HOME");
    assert_eq!(home_variable("macos"), "HOME");
}

#[test]
fn the_settings_file_sits_in_the_resolved_user_data_directory() {
    assert_eq!(
        current_user_settings_path(),
        current_user_data_path().join("user-settings.json")
    );
}

#[cfg(target_os = "linux")]
#[test]
fn linux_resolves_under_the_config_home() {
    let resolved = current_user_data_path();
    let expected = match std::env::var("XDG_CONFIG_HOME") {
        Ok(xdg) if !xdg.is_empty() => std::path::PathBuf::from(xdg),
        _ => std::path::PathBuf::from(std::env::var("HOME").expect("HOME is set")).join(".config"),
    };
    // Skipped rather than falsely green when the harness pins the directory elsewhere.
    if std::env::var("CONTAINER_DESKTOP_USER_DATA_DIR").is_ok() {
        return;
    }
    assert_eq!(resolved, expected.join("container-desktop"));
}

#[test]
fn the_real_file_on_this_machine_is_read_and_re_serialized_unchanged() {
    // The end of the path claim: not "a plausible path" but the very file the shipping app is
    // using, parsed and re-emitted byte for byte. Skipped, loudly, where there is no app.
    let path = current_user_settings_path();
    let Ok(contents) = std::fs::read_to_string(&path) else {
        eprintln!("skipped: no desktop app settings at {}", path.display());
        return;
    };
    let document = cdc_runtime::domain::settings::document::SettingsDocument::parse(&contents)
        .expect("the app's own settings file must parse");
    assert!(
        !document
            .connections()
            .expect("connections parse")
            .is_empty()
            || document.as_value().contains_key("connections"),
        "the app's file should carry a connections key"
    );
    assert_eq!(
        document.to_json(),
        contents,
        "re-serializing must not rewrite a single line of the user's file"
    );
}
