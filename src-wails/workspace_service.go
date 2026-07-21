package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// WorkspaceService is the confined workspace-access capability — the Go analog of the workspace_* commands in
// src-tauri/src/host.rs, backing the IWorkspaceAccess host port (src/packages/host-contract/src/workspaceAccess.ts).
// The wails invoke shim maps workspace_read → ReadFile, workspace_glob → Glob, and so on.
//
// SECURITY (non-negotiable): confinement lives HERE, never in the JS tool layer that calls it. Every model-supplied
// path is normalized lexically, resolved through EvalSymlinks, and checked component-wise against the canonical
// root, so `..` traversal and symlink escapes are both rejected natively. This mirrors the Rust `confine` exactly,
// including rejecting absolute request paths outright (Rust's PathBuf::join would swallow the root for those).
type WorkspaceService struct{}

const (
	maxWalkFiles       = 20000
	maxGlobResults     = 1000
	defaultGrepResults = 200
	hardMaxGrepResults = 1000
	maxGrepFileBytes   = 1000000
	maxGrepLineChars   = 500
	maxExecOutputBytes = 64 * 1024
	workspaceExecTimeo = 120 * time.Second
)

// Directories never walked by glob/grep — they dominate a repo's file count and never hold source the model wants.
var workspaceIgnores = map[string]bool{".git": true, "node_modules": true}

// Only these process-env keys reach an exec'd command — enough for dev tools without forwarding secrets.
var workspaceExecEnvAllowlist = []string{"PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ", "SHELL"}

type WorkspaceDirEntry struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type WorkspaceStat struct {
	Path       string `json:"path"`
	Kind       string `json:"kind"`
	Size       int64  `json:"size"`
	ModifiedMs int64  `json:"modifiedMs"`
}

type WorkspaceEditResult struct {
	Path         string `json:"path"`
	Before       string `json:"before"`
	After        string `json:"after"`
	Replacements uint32 `json:"replacements"`
}

type WorkspaceGrepMatch struct {
	Path string `json:"path"`
	Line uint32 `json:"line"`
	Text string `json:"text"`
}

type WorkspaceExecResult struct {
	Program   string   `json:"program"`
	Args      []string `json:"args"`
	Code      *int     `json:"code"`
	Stdout    string   `json:"stdout"`
	Stderr    string   `json:"stderr"`
	Truncated bool     `json:"truncated"`
}

// Request payloads mirror the object each IWorkspaceAccess binding sends through Call.ByName.
type WorkspaceRootRequest struct {
	Root string `json:"root"`
}

type WorkspacePathRequest struct {
	Root string `json:"root"`
	Path string `json:"path"`
}

type WorkspaceWriteRequest struct {
	Root     string `json:"root"`
	Path     string `json:"path"`
	Contents string `json:"contents"`
}

type WorkspaceEditRequest struct {
	Root       string `json:"root"`
	Path       string `json:"path"`
	OldString  string `json:"oldString"`
	NewString  string `json:"newString"`
	ReplaceAll bool   `json:"replaceAll"`
}

type WorkspaceListRequest struct {
	Root string `json:"root"`
	Path string `json:"path"`
}

type WorkspaceGlobRequest struct {
	Root    string `json:"root"`
	Pattern string `json:"pattern"`
}

type WorkspaceGrepRequest struct {
	Root       string `json:"root"`
	Pattern    string `json:"pattern"`
	Glob       string `json:"glob"`
	MaxResults int    `json:"maxResults"`
}

type WorkspaceExecRequest struct {
	Root    string   `json:"root"`
	Program string   `json:"program"`
	Args    []string `json:"args"`
}

func canonicalRoot(root string) (string, error) {
	if strings.TrimSpace(root) == "" {
		return "", errors.New("No workspace is configured. Choose a workspace folder in Settings → AI.")
	}
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("workspace root is unavailable: %w", err)
	}
	abs, err := filepath.Abs(real)
	if err != nil {
		return "", fmt.Errorf("workspace root is unavailable: %w", err)
	}
	return abs, nil
}

// Component-wise containment: a sibling like /ws-evil must never count as inside /ws, which a plain string prefix
// check would wrongly accept.
func withinRoot(rootReal string, candidate string) bool {
	return candidate == rootReal || strings.HasPrefix(candidate, rootReal+string(filepath.Separator))
}

// Lexical guard + symlink resolution — where `..` and symlink escapes are stopped. An absolute requested path is
// rejected outright rather than being joined under the root, matching the Rust behaviour.
func confine(rootReal string, requested string, mustExist bool) (string, error) {
	if filepath.IsAbs(requested) {
		return "", fmt.Errorf("Path escapes the workspace: %s", requested)
	}
	lexical := filepath.Join(rootReal, requested)
	if !withinRoot(rootReal, lexical) {
		return "", fmt.Errorf("Path escapes the workspace: %s", requested)
	}
	real, err := filepath.EvalSymlinks(lexical)
	if err == nil {
		if !withinRoot(rootReal, real) {
			return "", fmt.Errorf("Path escapes the workspace: %s", requested)
		}
		return real, nil
	}
	if mustExist {
		return "", fmt.Errorf("Path not found in the workspace: %s", requested)
	}
	// The target does not exist yet (a create). Its PARENT must still resolve inside the root.
	if parentReal, parentErr := filepath.EvalSymlinks(filepath.Dir(lexical)); parentErr == nil {
		if !withinRoot(rootReal, parentReal) {
			return "", fmt.Errorf("Path escapes the workspace: %s", requested)
		}
	}
	return lexical, nil
}

// Translate a glob (`*` within a segment, `**` across segments, `?` one non-slash char) into an anchored regex.
func globToRegex(pattern string) (*regexp.Regexp, error) {
	chars := []rune(pattern)
	var source strings.Builder
	source.WriteString("^")
	for i := 0; i < len(chars); i++ {
		c := chars[i]
		switch {
		case c == '*':
			if i+1 < len(chars) && chars[i+1] == '*' {
				source.WriteString(".*")
				i++
				if i+1 < len(chars) && chars[i+1] == '/' {
					i++
				}
			} else {
				source.WriteString("[^/]*")
			}
		case c == '?':
			source.WriteString("[^/]")
		default:
			if strings.ContainsRune(`\^$.|+()[]{}`, c) {
				source.WriteString(`\`)
			}
			source.WriteRune(c)
		}
	}
	source.WriteString("$")
	return regexp.Compile(source.String())
}

// Workspace-relative file paths (POSIX separators), skipping the ignore set and capped at maxWalkFiles.
func walkFiles(rootReal string) []string {
	files := make([]string, 0, 64)
	stack := []string{""}
	for len(stack) > 0 {
		relDir := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		absDir := rootReal
		if relDir != "" {
			absDir = filepath.Join(rootReal, filepath.FromSlash(relDir))
		}
		entries, err := os.ReadDir(absDir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name := entry.Name()
			if workspaceIgnores[name] {
				continue
			}
			rel := name
			if relDir != "" {
				rel = relDir + "/" + name
			}
			if entry.IsDir() {
				stack = append(stack, rel)
				continue
			}
			if entry.Type().IsRegular() {
				files = append(files, rel)
				if len(files) >= maxWalkFiles {
					return files
				}
			}
		}
	}
	sort.Strings(files)
	return files
}

// Replace oldString with newString; without replaceAll it must occur exactly once (unambiguous).
func applyStringEdit(content string, oldString string, newString string, replaceAll bool) (string, uint32, error) {
	if oldString == "" {
		return "", 0, errors.New("editFile: oldString must not be empty")
	}
	count := strings.Count(content, oldString)
	if count == 0 {
		return "", 0, errors.New("editFile: oldString not found in the file")
	}
	if replaceAll {
		return strings.ReplaceAll(content, oldString, newString), uint32(count), nil
	}
	if count > 1 {
		return "", 0, errors.New("editFile: oldString is not unique; add surrounding context or set replaceAll")
	}
	return strings.Replace(content, oldString, newString, 1), 1, nil
}

func capOutput(text string) (string, bool) {
	if len(text) <= maxExecOutputBytes {
		return text, false
	}
	runes := []rune(text)
	if len(runes) > maxExecOutputBytes {
		runes = runes[:maxExecOutputBytes]
	}
	return string(runes), true
}

func entryKind(info os.FileInfo) string {
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		return "symlink"
	case info.IsDir():
		return "directory"
	case info.Mode().IsRegular():
		return "file"
	default:
		return "other"
	}
}

func (w *WorkspaceService) Root(req WorkspaceRootRequest) (string, error) {
	return canonicalRoot(req.Root)
}

func (w *WorkspaceService) ReadFile(req WorkspacePathRequest) (string, error) {
	rootReal, err := canonicalRoot(req.Root)
	if err != nil {
		return "", err
	}
	abs, err := confine(rootReal, req.Path, true)
	if err != nil {
		return "", err
	}
	contents, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(contents), nil
}

func (w *WorkspaceService) WriteFile(req WorkspaceWriteRequest) error {
	rootReal, err := canonicalRoot(req.Root)
	if err != nil {
		return err
	}
	abs, err := confine(rootReal, req.Path, false)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(req.Contents), 0o644)
}

func (w *WorkspaceService) EditFile(req WorkspaceEditRequest) (WorkspaceEditResult, error) {
	rootReal, err := canonicalRoot(req.Root)
	if err != nil {
		return WorkspaceEditResult{}, err
	}
	abs, err := confine(rootReal, req.Path, true)
	if err != nil {
		return WorkspaceEditResult{}, err
	}
	beforeBytes, err := os.ReadFile(abs)
	if err != nil {
		return WorkspaceEditResult{}, err
	}
	before := string(beforeBytes)
	after, replacements, err := applyStringEdit(before, req.OldString, req.NewString, req.ReplaceAll)
	if err != nil {
		return WorkspaceEditResult{}, err
	}
	if err := os.WriteFile(abs, []byte(after), 0o644); err != nil {
		return WorkspaceEditResult{}, err
	}
	return WorkspaceEditResult{Path: req.Path, Before: before, After: after, Replacements: replacements}, nil
}

func (w *WorkspaceService) List(req WorkspaceListRequest) ([]WorkspaceDirEntry, error) {
	rootReal, err := canonicalRoot(req.Root)
	if err != nil {
		return nil, err
	}
	requested := req.Path
	if strings.TrimSpace(requested) == "" {
		requested = "."
	}
	abs, err := confine(rootReal, requested, true)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	out := make([]WorkspaceDirEntry, 0, len(entries))
	for _, entry := range entries {
		info, infoErr := entry.Info()
		kind := "other"
		if infoErr == nil {
			kind = entryKind(info)
		}
		out = append(out, WorkspaceDirEntry{Name: entry.Name(), Kind: kind})
	}
	return out, nil
}

func (w *WorkspaceService) Stat(req WorkspacePathRequest) (WorkspaceStat, error) {
	rootReal, err := canonicalRoot(req.Root)
	if err != nil {
		return WorkspaceStat{}, err
	}
	abs, err := confine(rootReal, req.Path, true)
	if err != nil {
		return WorkspaceStat{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return WorkspaceStat{}, err
	}
	kind := "other"
	switch {
	case info.IsDir():
		kind = "directory"
	case info.Mode().IsRegular():
		kind = "file"
	}
	return WorkspaceStat{
		Path:       req.Path,
		Kind:       kind,
		Size:       info.Size(),
		ModifiedMs: info.ModTime().UnixMilli(),
	}, nil
}

func (w *WorkspaceService) Remove(req WorkspacePathRequest) error {
	rootReal, err := canonicalRoot(req.Root)
	if err != nil {
		return err
	}
	abs, err := confine(rootReal, req.Path, true)
	if err != nil {
		return err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return os.RemoveAll(abs)
	}
	return os.Remove(abs)
}

func (w *WorkspaceService) Glob(req WorkspaceGlobRequest) ([]string, error) {
	rootReal, err := canonicalRoot(req.Root)
	if err != nil {
		return nil, err
	}
	matcher, err := globToRegex(req.Pattern)
	if err != nil {
		return nil, err
	}
	found := make([]string, 0, 32)
	for _, rel := range walkFiles(rootReal) {
		if matcher.MatchString(rel) {
			found = append(found, rel)
			if len(found) >= maxGlobResults {
				break
			}
		}
	}
	return found, nil
}

func (w *WorkspaceService) Grep(req WorkspaceGrepRequest) ([]WorkspaceGrepMatch, error) {
	rootReal, err := canonicalRoot(req.Root)
	if err != nil {
		return nil, err
	}
	matcher, err := regexp.Compile(req.Pattern)
	if err != nil {
		return nil, err
	}
	var globMatcher *regexp.Regexp
	if strings.TrimSpace(req.Glob) != "" {
		globMatcher, err = globToRegex(req.Glob)
		if err != nil {
			return nil, err
		}
	}
	limit := req.MaxResults
	if limit <= 0 {
		limit = defaultGrepResults
	}
	if limit > hardMaxGrepResults {
		limit = hardMaxGrepResults
	}
	matches := make([]WorkspaceGrepMatch, 0, 32)
	for _, rel := range walkFiles(rootReal) {
		if globMatcher != nil && !globMatcher.MatchString(rel) {
			continue
		}
		abs := filepath.Join(rootReal, filepath.FromSlash(rel))
		info, statErr := os.Stat(abs)
		if statErr != nil || info.Size() > maxGrepFileBytes {
			continue
		}
		contents, readErr := os.ReadFile(abs)
		if readErr != nil {
			continue
		}
		// Cheap binary sniff: skip files containing a NUL byte (expressed numerically, never as a literal).
		if strings.IndexByte(string(contents), byte(0)) >= 0 {
			continue
		}
		for index, line := range strings.Split(string(contents), "\n") {
			line = strings.TrimSuffix(line, "\r")
			if !matcher.MatchString(line) {
				continue
			}
			runes := []rune(line)
			if len(runes) > maxGrepLineChars {
				runes = runes[:maxGrepLineChars]
			}
			matches = append(matches, WorkspaceGrepMatch{Path: rel, Line: uint32(index + 1), Text: string(runes)})
			if len(matches) >= limit {
				return matches, nil
			}
		}
	}
	return matches, nil
}

func (w *WorkspaceService) Exec(req WorkspaceExecRequest) (WorkspaceExecResult, error) {
	rootReal, err := canonicalRoot(req.Root)
	if err != nil {
		return WorkspaceExecResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), workspaceExecTimeo)
	defer cancel()

	cmd := exec.CommandContext(ctx, req.Program, req.Args...)
	cmd.Dir = rootReal
	// Cleared environment plus the allowlist — a workspace command never inherits the app's secrets.
	env := make([]string, 0, len(workspaceExecEnvAllowlist))
	for _, key := range workspaceExecEnvAllowlist {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	cmd.Env = env
	configureHiddenWindow(cmd)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	var code *int
	if cmd.ProcessState != nil {
		exitCode := cmd.ProcessState.ExitCode()
		// ExitCode() reports -1 for a signal-terminated process; the port models that as a null code.
		if exitCode >= 0 {
			code = &exitCode
		}
	} else if runErr != nil {
		// The program never started (not found, not executable) — surface it as stderr rather than an error, so
		// the model sees what happened and can adjust instead of the whole tool call failing opaquely.
		stderr.WriteString(runErr.Error())
	}

	cappedOut, outTruncated := capOutput(stdout.String())
	cappedErr, errTruncated := capOutput(stderr.String())
	return WorkspaceExecResult{
		Program:   req.Program,
		Args:      req.Args,
		Code:      code,
		Stdout:    cappedOut,
		Stderr:    cappedErr,
		Truncated: outTruncated || errTruncated,
	}, nil
}
