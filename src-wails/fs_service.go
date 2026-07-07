package main

import "os"

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

func (s *FsService) IsFilePresent(req ReadTextFileRequest) bool {
	info, err := os.Stat(req.Path)
	return err == nil && !info.IsDir()
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
