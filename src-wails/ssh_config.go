package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// SSHHost mirrors env/Types.ts SSHHost (PascalCase wire keys). GetSSHConfig parses ~/.ssh/config into these so the
// SSH controller-scope picker lists configured hosts — a faithful port of src-tauri/src/ssh_config.rs (itself a
// port of the subset node.ts reads from the ssh-config npm parser, which can't bundle into the webview). Fidelity
// (do NOT "improve"): only Host blocks; HostName/Port/User/IdentityFile via case-insensitive FIRST match; one
// host per CONCRETE pattern (`*`, `!neg`, glob tokens dropped); Port defaults 22; HostName defaults to the alias.
type SSHHost struct {
	Name         string `json:"Name"`
	Host         string `json:"Host"`
	Port         uint32 `json:"Port"`
	HostName     string `json:"HostName"`
	User         string `json:"User"`
	Type         string `json:"Type"`
	IdentityFile string `json:"IdentityFile"`
	ConfigHost   string `json:"ConfigHost"`
	Connected    bool   `json:"Connected"`
	Usable       bool   `json:"Usable"`
}

// GetSSHConfig reads + parses ~/.ssh/config. Infallible: a missing/unreadable file yields [] (mirrors the
// consumer's try/catch → []), so the SSH picker shows no hosts rather than erroring.
func (s *PlatformService) GetSSHConfig() []SSHHost {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return []SSHHost{}
	}
	contents, err := os.ReadFile(filepath.Join(home, ".ssh", "config"))
	if err != nil {
		return []SSHHost{}
	}
	return parseSSHConfig(string(contents))
}

type sshHostBlock struct {
	patterns     string
	hostName     *string
	port         *string
	user         *string
	identityFile *string
}

// concreteHostPatterns: split on whitespace, drop empty, "*", "!negations", and glob tokens (?/*).
func concreteHostPatterns(value string) []string {
	out := []string{}
	for item := range strings.FieldsSeq(value) {
		item = strings.TrimSpace(item)
		if item == "" || item == "*" || strings.HasPrefix(item, "!") || strings.ContainsAny(item, "?*") {
			continue
		}
		out = append(out, item)
	}
	return out
}

// splitDirective: OpenSSH allows "Key Value", "Key=Value", "Key = Value"; a surrounding pair of double quotes on
// the value is stripped. Returns ok=false for a keyword-only (empty-key) line.
func splitDirective(line string) (key, value string, ok bool) {
	idx := strings.IndexAny(line, " \t=")
	var rest string
	if idx >= 0 {
		key, rest = line[:idx], line[idx:]
	} else {
		key, rest = line, ""
	}
	if key == "" {
		return "", "", false
	}
	value = strings.TrimLeft(rest, " \t")
	value = strings.TrimPrefix(value, "=")
	value = strings.TrimSpace(value)
	if len(value) >= 2 && strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`) {
		value = value[1 : len(value)-1]
	}
	return key, value, true
}

func flushSSHBlock(block sshHostBlock, hosts *[]SSHHost) {
	// The whole `Host *` block contributes nothing (concrete filtering would drop it anyway).
	if strings.TrimSpace(block.patterns) == "*" {
		return
	}
	hostName := strings.TrimSpace(derefString(block.hostName))
	user := strings.TrimSpace(derefString(block.user))
	identityFile := strings.TrimSpace(derefString(block.identityFile))
	port := uint32(22)
	if block.port != nil {
		if trimmed := strings.TrimSpace(*block.port); trimmed != "" {
			if parsed, err := strconv.ParseUint(trimmed, 10, 32); err == nil {
				port = uint32(parsed)
			}
		}
	}
	for _, alias := range concreteHostPatterns(block.patterns) {
		resolvedHostName := hostName
		if resolvedHostName == "" {
			resolvedHostName = alias
		}
		*hosts = append(*hosts, SSHHost{
			Name:         alias,
			Host:         alias,
			Port:         port,
			HostName:     resolvedHostName,
			User:         user,
			Type:         "SSHConnection",
			IdentityFile: identityFile,
			ConfigHost:   alias,
			Connected:    false,
			Usable:       false,
		})
	}
}

func parseSSHConfig(contents string) []SSHHost {
	hosts := []SSHHost{}
	var current *sshHostBlock
	flush := func() {
		if current != nil {
			flushSSHBlock(*current, &hosts)
			current = nil
		}
	}
	for rawLine := range strings.SplitSeq(contents, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := splitDirective(line)
		if !ok {
			continue
		}
		switch strings.ToLower(key) {
		case "host":
			flush()
			current = &sshHostBlock{patterns: value}
		case "match":
			// A Match block is not a Host — stop attributing directives to the previous Host.
			flush()
		case "hostname":
			if current != nil && current.hostName == nil {
				current.hostName = &value
			}
		case "port":
			if current != nil && current.port == nil {
				current.port = &value
			}
		case "user":
			if current != nil && current.user == nil {
				current.user = &value
			}
		case "identityfile":
			if current != nil && current.identityFile == nil {
				current.identityFile = &value
			}
		}
	}
	flush()
	return hosts
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
