package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/zalando/go-keyring"
)

// KeychainService backs the renderer's IKeychain capability (the AI provider-key store) via the OS secret
// vault — go-keyring's Secret Service (Linux) / Keychain (macOS) / Credential Manager (Windows) backends, the
// Go analog of src-tauri/src/keychain.rs. The wails invoke shim maps keychain_* onto these methods. One vault
// entry per key, keyed by the generic account (a provider id). Mirrors the Tauri keychain policy.
//
// Degraded fallback: when the OS vault is UNREACHABLE and the caller explicitly opts into degraded storage,
// secrets are kept in a 0600 file (keychain-fallback.json, base64 per account) instead — the Tauri parity for
// degraded-vault path. This is NOT OS encryption (the opt-in gate warns the
// user); the owner-only file mode is the real protection, base64 only keeps keys off disk in plaintext.
type KeychainService struct{}

const (
	keychainService      = "container-desktop"
	keychainProbeAccount = "__availability_probe__"
	// Degraded-vault fallback store (see Set). A base64 account→secret map at 0600. Same filename as the
	// Tauri shell writes (keychain-fallback.json) — the format is identical, and both shells share userData.
	keychainFallbackFile = "keychain-fallback.json"
	// The token a caller leaves where the secret belongs. Mirrors src-tauri/src/keychain.rs SECRET_PLACEHOLDER
	// and the renderer's KEYCHAIN_SECRET_PLACEHOLDER — the vocabulary travels as a value, not a shared module.
	keychainSecretPlaceholder = "__CD_KEYCHAIN_SECRET__"
)

// EncryptionStatus mirrors the renderer's EncryptionStatus (@/platform/capabilities); JSON field names lower.
type EncryptionStatus struct {
	Available bool   `json:"available"`
	Backend   string `json:"backend,omitempty"`
	Degraded  bool   `json:"degraded"`
}

// keychainBackend names the platform vault, surfaced in the Settings degraded-security notice ("no OS keychain
// is available (<backend>)") — so it is reported regardless of reachability, matching keychain.rs.
func keychainBackend() string {
	switch runtime.GOOS {
	case "darwin":
		return "keychain"
	case "windows":
		return "wincred"
	default:
		return "libsecret"
	}
}

// Degraded-vault fallback file helpers (parity with keychain.rs fallback_{path,read,write,set,get,clear}).

func keychainFallbackPath() (string, error) {
	dir, err := userDataPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, keychainFallbackFile), nil
}

// readKeychainFallback returns the account→base64 map; a missing or corrupt file reads as an empty map.
func readKeychainFallback() map[string]string {
	path, err := keychainFallbackPath()
	if err != nil {
		return map[string]string{}
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return map[string]string{}
	}
	out := map[string]string{}
	if json.Unmarshal(contents, &out) != nil {
		return map[string]string{}
	}
	return out
}

// writeKeychainFallback persists the map with owner-only (0600) perms — parity with fs_write_private_text_file.
// Open with the mode AND chmod so the result is 0600 regardless of umask.
func writeKeychainFallback(m map[string]string) error {
	path, err := keychainFallbackPath()
	if err != nil {
		return err
	}
	if mkErr := os.MkdirAll(filepath.Dir(path), 0o755); mkErr != nil {
		return mkErr
	}
	contents, err := json.Marshal(m)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(contents); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func keychainFallbackSet(account, secret string) error {
	m := readKeychainFallback()
	m[account] = base64.StdEncoding.EncodeToString([]byte(secret))
	return writeKeychainFallback(m)
}

func keychainFallbackGet(account string) (string, bool) {
	encoded, ok := readKeychainFallback()[account]
	if !ok {
		return "", false
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", false
	}
	return string(decoded), true
}

func keychainFallbackClear(account string) {
	m := readKeychainFallback()
	if _, ok := m[account]; ok {
		delete(m, account)
		_ = writeKeychainFallback(m)
	}
}

// Status round-trips a sentinel secret through the vault (set→get→delete). Any failure ⇒ unavailable +
// degraded (the consumer then requires explicit opt-in before storing a key, mirroring the shared
// degraded path). backend names the platform vault regardless of reachability. The renderer caches this per
// session, so the one write probe never causes repeated keychain-access prompts.
func (s *KeychainService) Status() EncryptionStatus {
	available := func() bool {
		if err := keyring.Set(keychainService, keychainProbeAccount, "1"); err != nil {
			return false
		}
		value, err := keyring.Get(keychainService, keychainProbeAccount)
		_ = keyring.Delete(keychainService, keychainProbeAccount)
		return err == nil && value == "1"
	}()
	return EncryptionStatus{Available: available, Backend: keychainBackend(), Degraded: !available}
}

// KeychainAccountRequest carries the account (provider id) for has/get/clear.
type KeychainAccountRequest struct {
	Account string `json:"account"`
}

// Has reports whether a non-empty secret is stored for the account (OS vault OR degraded fallback).
func (s *KeychainService) Has(req KeychainAccountRequest) bool {
	if secret, err := keyring.Get(keychainService, req.Account); err == nil && secret != "" {
		return true
	}
	fallback, ok := keychainFallbackGet(req.Account)
	return ok && fallback != ""
}

// lookupSecret reads the stored secret for an account, or "" when there is none. Deliberately NOT a service method:
// the web view must not be able to read a provider key, on either shell, and the only caller that needs one is
// WriteSecretFile — which substitutes it into a file the web view is refused read access to. Present in the vault →
// use it; otherwise (absent OR the vault unreachable) consult the degraded fallback, matching keychain.rs.
func lookupSecret(account string) string {
	if secret, err := keyring.Get(keychainService, account); err == nil {
		return secret
	}
	if fallback, ok := keychainFallbackGet(account); ok {
		return fallback
	}
	return ""
}

// KeychainSetRequest carries the secret to store. AllowDegraded is the renderer's opt-in for storing while the
// vault is unavailable: on a vault-write failure the secret goes to the 0600 file instead (the shared
// parity); on a healthy vault the flag is inert and any stale degraded copy is dropped.
type KeychainSetRequest struct {
	Account       string `json:"account"`
	Secret        string `json:"secret"`
	AllowDegraded bool   `json:"allowDegraded"`
}

func (s *KeychainService) Set(req KeychainSetRequest) error {
	if err := keyring.Set(keychainService, req.Account, req.Secret); err == nil {
		// Vault write succeeded — drop any stale degraded copy so the two never diverge.
		keychainFallbackClear(req.Account)
		return nil
	} else if req.AllowDegraded {
		return keychainFallbackSet(req.Account, req.Secret)
	} else {
		return err
	}
}

// Clear removes the secret for the account from BOTH the OS vault and the degraded fallback (a no-op where there
// is none). Best-effort vault delete: a missing entry or unreachable vault is not an error for "clear".
func (s *KeychainService) Clear(req KeychainAccountRequest) error {
	_ = keyring.Delete(keychainService, req.Account)
	keychainFallbackClear(req.Account)
	return nil
}

// KeychainWriteSecretFileRequest names the account whose secret is substituted, and the file to write it into.
type KeychainWriteSecretFileRequest struct {
	Account  string `json:"account"`
	FileName string `json:"fileName"`
	Contents string `json:"contents"`
}

// WriteSecretFile writes a private (0600) file into the protected agent directory, substituting
// keychainSecretPlaceholder with the secret stored for the account. This is how a credential reaches a
// container's env file without the web view ever handling it: the caller supplies the SHAPE, this process
// supplies the secret, and every web-view-reachable read refuses that directory (fs_service.go).
// An absent secret writes an empty value, which is correct for a keyless local server.
func (s *KeychainService) WriteSecretFile(req KeychainWriteSecretFileRequest) (string, error) {
	if !isSafeAgentFileName(req.FileName) {
		return "", fmt.Errorf("invalid agent file name")
	}
	// Fail closed: a body with nowhere to put the secret would silently produce an unauthenticated env file.
	if !strings.Contains(req.Contents, keychainSecretPlaceholder) {
		return "", fmt.Errorf("the agent environment carries no secret placeholder")
	}
	secret := lookupSecret(req.Account)
	if strings.ContainsAny(secret, "\r\n") {
		return "", fmt.Errorf("a stored secret cannot contain a newline")
	}
	dir, err := agentSecretsDir()
	if err != nil {
		return "", err
	}
	if mkErr := os.MkdirAll(dir, 0o700); mkErr != nil {
		return "", mkErr
	}
	path := filepath.Join(dir, req.FileName)
	if writeErr := os.WriteFile(path, []byte(strings.ReplaceAll(req.Contents, keychainSecretPlaceholder, secret)), 0o600); writeErr != nil {
		return "", writeErr
	}
	return path, nil
}

// KeychainWriteAgentFileRequest names only the file to write; there is no account because there is no secret.
type KeychainWriteAgentFileRequest struct {
	FileName string `json:"fileName"`
	Contents string `json:"contents"`
}

// WriteAgentFile writes a private (0600) file into the same protected agent directory, with NO secret to
// substitute. This is the agent container's own env file: it carries the bridge token but never a provider
// credential.
//
// It lives beside the gateway's rather than in a directory of its own so ONE guard covers both — the bridge token
// is a secret too, and a second directory would have been outside fs_service.go's refusal. Deliberately separate
// from WriteSecretFile, whose placeholder requirement is a fail-closed check worth keeping.
func (s *KeychainService) WriteAgentFile(req KeychainWriteAgentFileRequest) (string, error) {
	if !isSafeAgentFileName(req.FileName) {
		return "", fmt.Errorf("invalid agent file name")
	}
	// The opposite fail-closed check to WriteSecretFile's: a placeholder HERE means a caller expected a credential
	// to be substituted and it silently was not.
	if strings.Contains(req.Contents, keychainSecretPlaceholder) {
		return "", fmt.Errorf("this file carries a secret placeholder and must be written as a secret file")
	}
	dir, err := agentSecretsDir()
	if err != nil {
		return "", err
	}
	if mkErr := os.MkdirAll(dir, 0o700); mkErr != nil {
		return "", mkErr
	}
	path := filepath.Join(dir, req.FileName)
	if writeErr := os.WriteFile(path, []byte(req.Contents), 0o600); writeErr != nil {
		return "", writeErr
	}
	return path, nil
}

// isSafeAgentFileName keeps the caller to naming a FILE — never a directory, never a traversal.
func isSafeAgentFileName(name string) bool {
	if name == "" || len(name) > 128 || strings.HasPrefix(name, ".") {
		return false
	}
	for _, c := range name {
		isAllowed := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-'
		if !isAllowed {
			return false
		}
	}
	return true
}
