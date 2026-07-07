//go:build unix

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Mirrors src-tauri/src/keychain.rs `degraded_fallback_round_trips_through_the_0600_file`: the degraded
// fallback must round-trip a secret through an owner-only, non-plaintext file. userDataPath honors
// CONTAINER_DESKTOP_USER_DATA_DIR, so point it at a temp dir for a hermetic check (no real OS vault).
func TestKeychainDegradedFallbackRoundTrips0600File(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONTAINER_DESKTOP_USER_DATA_DIR", dir)

	if _, ok := keychainFallbackGet("openai"); ok {
		t.Fatal("expected no secret before set")
	}
	if err := keychainFallbackSet("openai", "sk-secret"); err != nil {
		t.Fatalf("fallback set: %v", err)
	}
	if got, ok := keychainFallbackGet("openai"); !ok || got != "sk-secret" {
		t.Fatalf("fallback get = %q,%v; want sk-secret,true", got, ok)
	}

	// Stored base64-encoded, never as plaintext on disk.
	raw, err := os.ReadFile(filepath.Join(dir, keychainFallbackFile))
	if err != nil {
		t.Fatalf("read fallback file: %v", err)
	}
	if strings.Contains(string(raw), "sk-secret") {
		t.Fatalf("secret must not be on disk in plaintext: %s", raw)
	}

	// Owner-only (0600) permissions.
	info, err := os.Stat(filepath.Join(dir, keychainFallbackFile))
	if err != nil {
		t.Fatalf("stat fallback file: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("fallback file mode = %o; want 600 (owner-only)", mode)
	}

	keychainFallbackClear("openai")
	if _, ok := keychainFallbackGet("openai"); ok {
		t.Fatal("expected no secret after clear")
	}
}
