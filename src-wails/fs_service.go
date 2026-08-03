package main

import (
	"os"
	"path/filepath"
	"strings"
)

// FsService backs the renderer's IFileSystem port — the Go analog of the host.rs fs_* commands.
// Request structs mirror the Tauri invoke payloads 1:1 so the wails invoke shim forwards
// { path, contents } verbatim. Errors reject the JS promise (Wails v3 rejects with error objects).
type FsService struct{}

// ReadTextFileRequest mirrors the Tauri fs_read_text_file / fs_is_file_present payload.
type ReadTextFileRequest struct {
	Path string `json:"path"`
}

func (s *FsService) ReadTextFile(req ReadTextFileRequest) (string, error) {
	data, err := os.ReadFile(req.Path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteTextFileRequest mirrors the Tauri fs_write_text_file / fs_write_private_text_file payload.
type WriteTextFileRequest struct {
	Path     string `json:"path"`
	Contents string `json:"contents"`
}

func (s *FsService) WriteTextFile(req WriteTextFileRequest) error {
	return os.WriteFile(req.Path, []byte(req.Contents), 0o644)
}

// WritePrivateTextFile writes 0600 owner-only (AI credentials), mirroring host.rs
// fs_write_private_text_file. Best-effort mode on Windows (no unix perms).
func (s *FsService) WritePrivateTextFile(req WriteTextFileRequest) error {
	if err := os.WriteFile(req.Path, []byte(req.Contents), 0o600); err != nil {
		return err
	}
	return os.Chmod(req.Path, 0o600)
}

// windowsPipeDirectory is the named-pipe filesystem, which Windows lets you LIST.
const windowsPipeDirectory = `\\.\pipe\`

// windowsPipeName returns the pipe's own name when this path is a Windows named pipe (utils:getWindowsPipeName).
// The predicate runs before the name is read, or a POSIX path that merely contains a `pipe/` directory would
// be treated as one.
func windowsPipeName(path string) (string, bool) {
	trimmed := strings.TrimSpace(path)
	slashed := strings.ReplaceAll(trimmed, `\`, "/")
	normalized := strings.ToLower(slashed)
	if !strings.HasPrefix(normalized, "npipe://") &&
		!strings.HasPrefix(normalized, "//./pipe/") &&
		!strings.HasPrefix(normalized, "//?/pipe/") {
		return "", false
	}
	segments := strings.Split(strings.TrimRight(slashed, "/"), "/")
	if len(segments) < 2 {
		return "", false
	}
	name := segments[len(segments)-1]
	parent := segments[len(segments)-2]
	if name == "" || !strings.EqualFold(parent, "pipe") {
		return "", false
	}
	return name, true
}

// IsFilePresent answers "is anything at this path", matching the FS port contract the renderer is
// written against — a DIRECTORY counts, because callers pass one (container-client config.ts and
// transports/native.ts both check a base directory this way) and expect true. The previous !IsDir() made this
// shell answer false on exactly those calls while the other two answered true.
//
// A Windows named pipe cannot be answered by Stat at all: Stat OPENS the path, and opening a pipe means
// becoming a CLIENT of it. Measured against a live Docker Desktop on Windows 11 — the check consumed one of the
// server's instances, and a pipe whose instances are all busy then reads as ABSENT. Listing the pipe filesystem
// answers it and touches nothing.
func (s *FsService) IsFilePresent(req ReadTextFileRequest) bool {
	if name, ok := windowsPipeName(req.Path); ok {
		entries, err := os.ReadDir(windowsPipeDirectory)
		if err != nil {
			return false
		}
		for _, entry := range entries {
			if strings.EqualFold(entry.Name(), name) {
				return true
			}
		}
		return false
	}
	_, err := os.Stat(req.Path)
	return err == nil
}

// MkdirRequest mirrors the Tauri fs_mkdir payload.
type MkdirRequest struct {
	Path      string `json:"path"`
	Recursive bool   `json:"recursive"`
}

func (s *FsService) Mkdir(req MkdirRequest) error {
	if req.Recursive {
		return os.MkdirAll(req.Path, 0o755)
	}
	return os.Mkdir(req.Path, 0o755)
}

// RenameRequest mirrors the Tauri fs_rename payload (camelCase keys map onto the struct tags).
type RenameRequest struct {
	OldPath string `json:"oldPath"`
	NewPath string `json:"newPath"`
}

func (s *FsService) Rename(req RenameRequest) error {
	return os.Rename(req.OldPath, req.NewPath)
}

type FileSystemDirEntry struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type FileSystemStat struct {
	Kind       string `json:"kind"`
	Size       int64  `json:"size"`
	ModifiedMs int64  `json:"modifiedMs"`
}

func fileSystemKind(info os.FileInfo) string {
	if info.Mode()&os.ModeSymlink != 0 {
		return "symlink"
	}
	if info.Mode().IsRegular() {
		return "file"
	}
	if info.IsDir() {
		return "directory"
	}
	return "other"
}

func (s *FsService) ListDirectory(req ReadTextFileRequest) ([]FileSystemDirEntry, error) {
	entries, err := os.ReadDir(req.Path)
	if err != nil {
		return nil, err
	}
	result := make([]FileSystemDirEntry, 0, len(entries))
	for _, entry := range entries {
		info, infoErr := os.Lstat(filepath.Join(req.Path, entry.Name()))
		if infoErr != nil {
			return nil, infoErr
		}
		result = append(result, FileSystemDirEntry{Name: entry.Name(), Kind: fileSystemKind(info)})
	}
	return result, nil
}

func (s *FsService) Lstat(req ReadTextFileRequest) (FileSystemStat, error) {
	info, err := os.Lstat(req.Path)
	if err != nil {
		return FileSystemStat{}, err
	}
	return FileSystemStat{Kind: fileSystemKind(info), Size: info.Size(), ModifiedMs: info.ModTime().UnixMilli()}, nil
}

func (s *FsService) RealPath(req ReadTextFileRequest) (string, error) {
	return filepath.EvalSymlinks(req.Path)
}

type IsPathWithinRequest struct {
	Root string `json:"root"`
	Path string `json:"path"`
}

func (s *FsService) IsPathWithin(req IsPathWithinRequest) (bool, error) {
	root, err := filepath.EvalSymlinks(req.Root)
	if err != nil {
		return false, err
	}
	path, err := filepath.EvalSymlinks(req.Path)
	if err != nil {
		return false, err
	}
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return false, err
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)) && !filepath.IsAbs(relative)), nil
}
