#!/usr/bin/env bash
# mem-guard.sh — run a command under a hard, kernel-enforced memory ceiling.
#
# WHY: `cargo mutants` builds and runs the suite once per mutant, several at a time, and a mutant
# that removed a loop bound allocates until its timeout. Unbounded, that starves the whole desktop
# rather than the run — it has already timed out an unrelated Vitest suite on this machine. This
# wrapper runs the command inside a transient systemd *user* cgroup scope joined to a shared slice
# carrying an aggregate MemoryMax, so a runaway is OOM-killed inside its own cgroup and the build
# fails loudly (exit 137) instead of freezing the session.
#
# Safe to prefix onto any ad-hoc command:
#   core/rust/mk/mem-guard.sh cargo test --workspace
#
# Knobs (environment):
#   CDC_TEST_MEM_MAX    aggregate ceiling, a systemd size (e.g. 24G). Default 24G.
#   CDC_TEST_SWAP_MAX   swap allowance for the cgroup. Default 0 — fail fast, never thrash.
#   CDC_TEST_SLICE      shared slice name. Default cdc-rust-test.slice.
#   CDC_TEST_GUARD      set to 0/off/no to skip the guard (run the command directly).
#
# Where cgroup v2 + a delegated user memory controller are unavailable (CI, macOS, no user session),
# it warns and runs the command UNGUARDED rather than failing — the ceiling is a safety net, not a
# hard dependency.
set -euo pipefail

MEM_MAX="${CDC_TEST_MEM_MAX:-24G}"
SWAP_MAX="${CDC_TEST_SWAP_MAX:-0}"
SLICE="${CDC_TEST_SLICE:-cdc-rust-test.slice}"
GUARD="${CDC_TEST_GUARD:-1}"

if [ "$#" -eq 0 ]; then
	echo "mem-guard.sh: no command given" >&2
	exit 2
fi

# Explicit opt-out, or an empty/"off" ceiling: just run the command.
case "$GUARD" in
	0 | off | no | false | OFF | NO | FALSE) exec "$@" ;;
esac
case "$MEM_MAX" in
	off | none | OFF | NONE | "") exec "$@" ;;
esac

reason=""
guard_available() {
	[ "$(uname -s)" = Linux ] || { reason="not Linux"; return 1; }
	command -v systemd-run >/dev/null 2>&1 || { reason="systemd-run not found"; return 1; }
	command -v systemctl >/dev/null 2>&1 || { reason="systemctl not found"; return 1; }
	[ "$(stat -fc %T /sys/fs/cgroup 2>/dev/null)" = cgroup2fs ] ||
		{ reason="no cgroup v2 unified hierarchy"; return 1; }
	systemctl --user show --property=Version >/dev/null 2>&1 ||
		{ reason="no reachable systemd --user manager"; return 1; }
	local uid ctl
	uid="$(id -u)"
	ctl="/sys/fs/cgroup/user.slice/user-${uid}.slice/user@${uid}.service/cgroup.controllers"
	grep -qw memory "$ctl" 2>/dev/null ||
		{ reason="memory controller not delegated to the user session"; return 1; }
	return 0
}

if guard_available; then
	# Best-effort: give the shared slice the aggregate cap so CONCURRENT guarded runs share one
	# ceiling instead of N × cap. Harmless if it cannot be set; the per-scope MemoryMax still bounds
	# this single run.
	systemctl --user set-property "$SLICE" \
		MemoryMax="$MEM_MAX" MemorySwapMax="$SWAP_MAX" >/dev/null 2>&1 || true
	echo "[mem-guard] cgroup ceiling MemoryMax=$MEM_MAX MemorySwapMax=$SWAP_MAX slice=$SLICE" >&2
	exec systemd-run --user --scope --slice="$SLICE" --collect --quiet \
		-p MemoryMax="$MEM_MAX" -p MemorySwapMax="$SWAP_MAX" \
		-- "$@"
else
	echo "[mem-guard] WARNING: no enforceable memory ceiling ($reason); running UNGUARDED" >&2
	exec "$@"
fi
