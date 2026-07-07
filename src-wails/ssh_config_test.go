package main

import "testing"

// Ported from src-tauri/src/ssh_config.rs tests — the parser must stay byte-faithful to the node.ts subset.

func TestParseSSHConfigBasicBlock(t *testing.T) {
	hosts := parseSSHConfig("Host prod\n  HostName 10.0.0.1\n  Port 2222\n  User deploy\n  IdentityFile ~/.ssh/id_ed25519\n")
	if len(hosts) != 1 {
		t.Fatalf("len = %d, want 1", len(hosts))
	}
	h := hosts[0]
	if h.Name != "prod" || h.Host != "prod" || h.ConfigHost != "prod" {
		t.Errorf("name/host/configHost = %q/%q/%q, want prod", h.Name, h.Host, h.ConfigHost)
	}
	if h.HostName != "10.0.0.1" || h.Port != 2222 || h.User != "deploy" || h.IdentityFile != "~/.ssh/id_ed25519" {
		t.Errorf("unexpected host: %+v", h)
	}
	if h.Type != "SSHConnection" || h.Connected || h.Usable {
		t.Errorf("type/connected/usable = %q/%v/%v", h.Type, h.Connected, h.Usable)
	}
}

func TestParseSSHConfigDefaults(t *testing.T) {
	hosts := parseSSHConfig("Host box\n  User me\n")
	if len(hosts) != 1 || hosts[0].Port != 22 || hosts[0].HostName != "box" || hosts[0].IdentityFile != "" {
		t.Fatalf("unexpected: %+v", hosts)
	}
}

func TestParseSSHConfigNonNumericPort(t *testing.T) {
	hosts := parseSSHConfig("Host x\n  Port not-a-number\n")
	if hosts[0].Port != 22 {
		t.Errorf("port = %d, want 22", hosts[0].Port)
	}
}

func TestParseSSHConfigConcretePatterns(t *testing.T) {
	hosts := parseSSHConfig("Host foo bar *.example !nope\n  HostName shared\n  Port 42\n")
	names := []string{}
	for _, h := range hosts {
		names = append(names, h.Name)
	}
	if len(names) != 2 || names[0] != "foo" || names[1] != "bar" {
		t.Fatalf("names = %v, want [foo bar]", names)
	}
	for _, h := range hosts {
		if h.HostName != "shared" || h.Port != 42 {
			t.Errorf("shared settings lost: %+v", h)
		}
	}
}

func TestParseSSHConfigSkipsWildcardOnlyBlock(t *testing.T) {
	hosts := parseSSHConfig("Host *\n  User global\nHost real\n  HostName r\n")
	if len(hosts) != 1 || hosts[0].Name != "real" {
		t.Fatalf("names = %+v, want [real]", hosts)
	}
}

func TestParseSSHConfigCaseInsensitiveEqualsAndComments(t *testing.T) {
	hosts := parseSSHConfig("# a comment\n\nHOST gw\n  hostname=192.168.1.1\n  PORT = 2200\n  user=admin\n  # trailing\n")
	if len(hosts) != 1 || hosts[0].HostName != "192.168.1.1" || hosts[0].Port != 2200 || hosts[0].User != "admin" {
		t.Fatalf("unexpected: %+v", hosts)
	}
}

func TestParseSSHConfigFirstValueWinsQuotesStripped(t *testing.T) {
	hosts := parseSSHConfig("Host q\n  IdentityFile \"~/.ssh/key one\"\n  HostName a\n  HostName b\n")
	if hosts[0].IdentityFile != "~/.ssh/key one" || hosts[0].HostName != "a" {
		t.Fatalf("unexpected: %+v", hosts[0])
	}
}

func TestParseSSHConfigMatchNotAttributedToPriorHost(t *testing.T) {
	hosts := parseSSHConfig("Host h\n  HostName real\nMatch host *\n  User should-be-ignored\n")
	if len(hosts) != 1 || hosts[0].HostName != "real" || hosts[0].User != "" {
		t.Fatalf("unexpected: %+v", hosts)
	}
}

func TestParseSSHConfigEmpty(t *testing.T) {
	if len(parseSSHConfig("")) != 0 || len(parseSSHConfig("# only comments\n\n")) != 0 {
		t.Fatal("empty/comment-only config should yield no hosts")
	}
}
