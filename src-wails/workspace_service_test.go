package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Confinement is the whole point of this service, so the escape cases are asserted directly against `confine`
// rather than only through the exported methods. Mirrors the Rust workspace_tests in src-tauri/src/host.rs.
func TestConfineAcceptsInRootPathsAndRejectsEscapes(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	root, err := canonicalRoot(dir)
	if err != nil {
		t.Fatalf("canonicalRoot: %v", err)
	}

	for _, ok := range []string{"src", ".", "src/../src"} {
		if _, err := confine(root, ok, true); err != nil {
			t.Errorf("confine(%q) should be allowed, got %v", ok, err)
		}
	}
	for _, bad := range []string{"../etc/passwd", "..", "/etc/passwd"} {
		if _, err := confine(root, bad, false); err == nil {
			t.Errorf("confine(%q) should have been rejected", bad)
		}
	}
}

// A sibling directory sharing the root's name prefix must not be treated as inside it — the reason containment is
// component-wise rather than a string prefix test.
func TestWithinRootRejectsSiblingPrefix(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "ws")
	if withinRoot(root, filepath.Join(string(filepath.Separator), "ws-evil", "secret")) {
		t.Error("/ws-evil/secret must not count as inside /ws")
	}
	if !withinRoot(root, filepath.Join(root, "src", "a.ts")) {
		t.Error("/ws/src/a.ts must count as inside /ws")
	}
	if !withinRoot(root, root) {
		t.Error("the root itself must count as inside itself")
	}
}

// A symlink pointing outside the workspace must be rejected even though its lexical path looks contained.
func TestConfineRejectsSymlinkEscape(t *testing.T) {
	outside := t.TempDir()
	dir := t.TempDir()
	root, err := canonicalRoot(dir)
	if err != nil {
		t.Fatalf("canonicalRoot: %v", err)
	}
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("nope"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	link := filepath.Join(root, "escape.txt")
	if err := os.Symlink(secret, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := confine(root, "escape.txt", true); err == nil {
		t.Error("a symlink resolving outside the workspace must be rejected")
	}
}

func TestCanonicalRootRejectsEmpty(t *testing.T) {
	if _, err := canonicalRoot("   "); err == nil {
		t.Error("an unconfigured workspace root must be rejected")
	}
}

func TestApplyStringEditRequiresUniquenessUnlessReplaceAll(t *testing.T) {
	if _, _, err := applyStringEdit("a a", "a", "b", false); err == nil {
		t.Error("an ambiguous edit must be rejected without replaceAll")
	}
	after, count, err := applyStringEdit("a a", "a", "b", true)
	if err != nil || after != "b b" || count != 2 {
		t.Errorf("replaceAll: got (%q, %d, %v)", after, count, err)
	}
	after, count, err = applyStringEdit("x a y", "a", "b", false)
	if err != nil || after != "x b y" || count != 1 {
		t.Errorf("single replace: got (%q, %d, %v)", after, count, err)
	}
	if _, _, err := applyStringEdit("abc", "", "b", false); err == nil {
		t.Error("an empty oldString must be rejected")
	}
	if _, _, err := applyStringEdit("abc", "zzz", "b", false); err == nil {
		t.Error("a missing oldString must be rejected")
	}
}

func TestGlobToRegexMatchesSegmentsAndRecursion(t *testing.T) {
	star, err := globToRegex("*.ts")
	if err != nil {
		t.Fatalf("globToRegex: %v", err)
	}
	if !star.MatchString("a.ts") || star.MatchString("src/a.ts") {
		t.Error("`*` must stay within one path segment")
	}
	deep, err := globToRegex("**/*.ts")
	if err != nil {
		t.Fatalf("globToRegex: %v", err)
	}
	if !deep.MatchString("src/deep/a.ts") || !deep.MatchString("a.ts") {
		t.Error("`**/` must cross segments and also match at the root")
	}
}

func TestWalkFilesSkipsIgnoredDirectories(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "node_modules", "pkg"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "a.ts"), []byte("x"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "node_modules", "pkg", "b.ts"), []byte("x"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	root, err := canonicalRoot(dir)
	if err != nil {
		t.Fatalf("canonicalRoot: %v", err)
	}
	files := walkFiles(root)
	for _, rel := range files {
		if rel == "node_modules/pkg/b.ts" {
			t.Error("node_modules must not be walked")
		}
	}
	found := false
	for _, rel := range files {
		if rel == "src/a.ts" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected src/a.ts in %v", files)
	}
}
