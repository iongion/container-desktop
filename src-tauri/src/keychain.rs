// Generic OS secret-store (keychain) capability — a thin wrapper over the `keyring` crate's per-key vault
// (Windows Credential Manager / macOS Keychain / Linux Secret Service). Each secret is a discrete entry keyed
// by (service, account); the app never persists plaintext itself. Nothing here is AI-specific — the current
// consumer is the AI provider-key store (the Rust side of the AIKeyStore port), but the primitive is a
// standalone keychain usable by anything that needs to keep a secret out of app storage.
//
// keyring's API is SYNCHRONOUS and, on Linux, a Secret-Service D-Bus round-trip (tens-to-hundreds of ms) — so
// every command is async and does the blocking work on a blocking thread, never on the webview's main thread.
//
// Degraded fallback: when the OS vault is UNREACHABLE and the caller explicitly opts into degraded storage,
// secrets are kept in a 0600 file (keychain-fallback.json, base64 per account) instead — the Tauri parity for
// Electron's credentialsFs (safeStorage basic_text) path. This is NOT OS encryption (the opt-in gate warns the
// user); the owner-only file mode is the real protection, base64 only keeps keys off disk in plaintext.

use base64::Engine as _;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;

// One service namespace for every stored account; the account id is the entry "username". Matches the bundle-id
// convention (tauri.conf.json identifier) plus the consumer's own id validation, as defense in depth.
const KEYCHAIN_SERVICE: &str = "com.iongion.container-desktop.keychain";
// A sentinel entry used ONLY to probe whether the OS secret store is reachable (the encryption-available check).
const PROBE_SERVICE: &str = "com.iongion.container-desktop.keychain-probe";
const PROBE_USER: &str = "probe";
// Degraded-vault fallback store (see file header). A distinct filename from Electron's ai-credentials.json
// (different content) since both shells share the userData dir.
const FALLBACK_FILE: &str = "keychain-fallback.json";

// Mirrors the EncryptionStatus the IKeychain port reports. `degraded` drives the renderer's "store the key
// anyway" opt-in gate: when the OS vault is unreachable, storing a key requires explicit consent. `backend`
// names the platform vault, surfaced in the Settings degraded-security notice.
#[derive(Serialize)]
pub struct KeychainStatus {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    backend: Option<String>,
    degraded: bool,
}

fn entry(service: &str, user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, user).map_err(|e| e.to_string())
}

/// The OS secret-store backend name for the current platform — shown in the Settings degraded-security notice
/// ("no OS keychain is available (…)"). Mirrors what Electron surfaces via safeStorage.getSelectedStorageBackend.
fn keychain_backend_name() -> Option<String> {
    if cfg!(target_os = "macos") {
        Some("macOS Keychain".into())
    } else if cfg!(target_os = "windows") {
        Some("Windows Credential Manager".into())
    } else if cfg!(unix) {
        Some("Secret Service".into())
    } else {
        None
    }
}

// Degraded-vault fallback file helpers.

fn fallback_path() -> PathBuf {
    PathBuf::from(crate::host::get_user_data_path()).join(FALLBACK_FILE)
}

/// Read the fallback map (account → base64 secret). A missing or corrupt file reads as an empty map.
fn read_fallback() -> HashMap<String, String> {
    match std::fs::read_to_string(fallback_path()) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

/// Persist the fallback map with owner-only (0600) permissions — parity with fs_write_private_text_file.
fn write_fallback(map: &HashMap<String, String>) -> Result<(), String> {
    let path = fallback_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let contents = serde_json::to_string(map).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn fallback_set(account: &str, secret: &str) -> Result<(), String> {
    let mut map = read_fallback();
    map.insert(account.to_string(), base64::engine::general_purpose::STANDARD.encode(secret.as_bytes()));
    write_fallback(&map)
}

fn fallback_get(account: &str) -> Option<String> {
    let encoded = read_fallback().remove(account)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    String::from_utf8(bytes).ok()
}

fn fallback_clear(account: &str) {
    let mut map = read_fallback();
    if map.remove(account).is_some() {
        let _ = write_fallback(&map);
    }
}

// Commands.

/// Probe whether the OS secret store is usable by round-tripping a sentinel secret. Any failure ⇒ unavailable +
/// degraded (the consumer then requires explicit opt-in before storing a key, mirroring Electron's safeStorage
/// degraded path). `backend` names the platform vault regardless of reachability.
#[tauri::command]
pub async fn keychain_status() -> KeychainStatus {
    let available = tokio::task::spawn_blocking(|| {
        let Ok(probe) = entry(PROBE_SERVICE, PROBE_USER) else {
            return false;
        };
        if probe.set_password("1").is_err() {
            return false;
        }
        let ok = probe.get_password().map(|v| v == "1").unwrap_or(false);
        let _ = probe.delete_credential();
        ok
    })
    .await
    .unwrap_or(false);
    KeychainStatus { available, backend: keychain_backend_name(), degraded: !available }
}

/// Whether a non-empty secret is stored for `account` (in the OS vault or the degraded fallback).
#[tauri::command]
pub async fn keychain_has(account: String) -> bool {
    let account_for_vault = account.clone();
    let in_vault = tokio::task::spawn_blocking(move || {
        entry(KEYCHAIN_SERVICE, &account_for_vault)
            .ok()
            .and_then(|e| e.get_password().ok())
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false);
    in_vault || fallback_get(&account).map(|s| !s.is_empty()).unwrap_or(false)
}

/// The plaintext secret for `account` (None if unset) — from the OS vault, else the degraded fallback.
/// Deliberately NOT a `#[tauri::command]`: the secret stays in this process, and the only caller is the native
/// provider transport, which attaches it to the outbound request without the web view ever seeing it.
pub(crate) async fn keychain_get(account: String) -> Result<Option<String>, String> {
    let account_for_vault = account.clone();
    let from_vault = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let e = entry(KEYCHAIN_SERVICE, &account_for_vault)?;
        match e.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    // Present in the vault → use it; otherwise (absent OR the vault is unreachable) consult the degraded fallback.
    Ok(match from_vault {
        Ok(Some(secret)) => Some(secret),
        Ok(None) | Err(_) => fallback_get(&account),
    })
}

/// Store (or overwrite) the secret for `account` in the OS vault. If the vault write fails and the caller opted
/// into degraded storage, fall back to the 0600 file instead (Electron basic_text parity); otherwise the vault
/// error propagates.
#[tauri::command]
pub async fn keychain_set(account: String, secret: String, allow_degraded: Option<bool>) -> Result<(), String> {
    let account_for_vault = account.clone();
    let secret_for_vault = secret.clone();
    let vault_result = tokio::task::spawn_blocking(move || {
        entry(KEYCHAIN_SERVICE, &account_for_vault)?.set_password(&secret_for_vault).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    match vault_result {
        Ok(()) => {
            // Vault write succeeded — drop any stale degraded copy so the two never diverge.
            fallback_clear(&account);
            Ok(())
        }
        Err(_) if allow_degraded.unwrap_or(false) => fallback_set(&account, &secret),
        Err(err) => Err(err),
    }
}

/// Remove the secret for `account` from BOTH the OS vault and the degraded fallback (a no-op where there is none).
#[tauri::command]
pub async fn keychain_clear(account: String) -> Result<(), String> {
    let account_for_vault = account.clone();
    // Best-effort vault delete: a missing entry or an unreachable vault is not an error for "clear".
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(e) = entry(KEYCHAIN_SERVICE, &account_for_vault) {
            let _ = e.delete_credential();
        }
    })
    .await;
    fallback_clear(&account);
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    // The degraded fallback must round-trip a secret through an owner-only, non-plaintext file. get_user_data_path()
    // honors CONTAINER_DESKTOP_USER_DATA_DIR, so point the fallback at a temp dir for a hermetic check.
    #[test]
    fn degraded_fallback_round_trips_through_the_0600_file() {
        let dir = std::env::temp_dir().join(format!("cd-keychain-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("CONTAINER_DESKTOP_USER_DATA_DIR", &dir);

        assert_eq!(fallback_get("openai"), None);
        fallback_set("openai", "sk-secret").unwrap();
        assert_eq!(fallback_get("openai"), Some("sk-secret".to_string()));

        // Stored base64-encoded, never as plaintext on disk.
        let raw = std::fs::read_to_string(dir.join(FALLBACK_FILE)).unwrap();
        assert!(!raw.contains("sk-secret"), "secret must not be on disk in plaintext: {raw}");

        // Owner-only (0600) permissions.
        let mode = std::fs::metadata(dir.join(FALLBACK_FILE)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "fallback file must be owner-only");

        fallback_clear("openai");
        assert_eq!(fallback_get("openai"), None);

        std::env::remove_var("CONTAINER_DESKTOP_USER_DATA_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
