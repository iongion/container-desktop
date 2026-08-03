package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// Search + exec workspace operations (Glob / Grep / Exec) — the heavier, walk-driven half of WorkspaceService.
// Types, confinement helpers and the file ops (Read/Write/Edit/List/Stat/Remove) live in workspace_service.go.

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
