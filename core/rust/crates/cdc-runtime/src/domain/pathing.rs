//! Path joining and absoluteness, with the OS as a parameter.
//!
//! `std::path` uses the host's separator, which would make every Windows rule unverifiable from a
//! Linux workstation — and the Windows rules are the ones nobody can check by running them here.
//! Passing the OS in is what keeps them testable at all.

use crate::domain::types::os::OperatingSystem;

pub fn separator(os: OperatingSystem) -> char {
    match os {
        OperatingSystem::WindowsNt => '\\',
        _ => '/',
    }
}

/// Join one segment onto a base, normalising the separator to the target OS. `path.join` in Node
/// does the same normalisation, which is why a Windows path built from a `/`-joined literal still
/// comes out with backslashes.
pub fn join(os: OperatingSystem, base: &str, segment: &str) -> String {
    let separator = separator(os);
    let base = base.trim_end_matches(['/', '\\']);
    let segment = normalize_separators(os, segment.trim_start_matches(['/', '\\']));
    format!("{base}{separator}{segment}")
}

/// Rewrite every separator in a path to the target OS's.
pub fn normalize_separators(os: OperatingSystem, path: &str) -> String {
    let separator = separator(os);
    path.chars()
        .map(|it| {
            if it == '/' || it == '\\' {
                separator
            } else {
                it
            }
        })
        .collect()
}

/// `path.isAbsolute` — a leading separator anywhere, plus a drive letter or a UNC root on Windows.
pub fn is_absolute(os: OperatingSystem, path: &str) -> bool {
    if path.starts_with('/') {
        return true;
    }
    if os != OperatingSystem::WindowsNt {
        return false;
    }
    path.starts_with('\\') || has_drive_letter_prefix(path)
}

/// `utils:expandHome` — substitute the home directory for a leading `~` or the first `$HOME`.
///
/// Both spellings appear in `~/.ssh/config` and both reach an `IdentityFile`, so both are handled;
/// `ssh` itself expands neither when the path arrives through `-i`. The home directory is a
/// parameter for the same reason the OS is: it is the caller's knowledge, and taking it here would
/// make the rule unverifiable from any one machine.
pub fn expand_home(path: &str, home: &str) -> String {
    let expanded = match path.strip_prefix('~') {
        Some(rest) => format!("{home}{rest}"),
        None => path.to_string(),
    };
    // `String.replace` with a string argument substitutes the FIRST occurrence only.
    expanded.replacen("$HOME", home, 1)
}

/// `C:\` or `C:/`. Lives here rather than beside its two callers because it is one rule: the argv
/// quoting asks the same question of a program path that this module asks of a directory.
pub fn has_drive_letter_prefix(path: &str) -> bool {
    let mut characters = path.chars();
    let (Some(drive), Some(':'), Some('\\' | '/')) =
        (characters.next(), characters.next(), characters.next())
    else {
        return false;
    };
    drive.is_ascii_alphabetic()
}
