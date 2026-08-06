//! A child this app spawned must not outlive an app that was KILLED.
//!
//! Every long-lived child already dies with a CLEAN shutdown: `kill_on_drop(true)` fires when the pump task is
//! dropped, and the process registry kills what it holds. None of that runs when the app is killed rather than
//! stopped — SIGKILL, the task manager, an OOM kill — and what is left behind is not harmless: an `ssh -NL` forward
//! holds a local port AND an SSH connection to the remote for as long as the user's session lasts, and the next
//! forward silently picks another port, so the leak is invisible until the ports run out.
//!
//! The fix has to be in the KERNEL, because by definition no code of ours gets to run. That is only available on some
//! platforms, which is the shape of this module and a deliberate decision rather than an oversight:
//!
//! | Platform | What holds the child | |
//! | --- | --- | --- |
//! | Linux | `PR_SET_PDEATHSIG` — the kernel sends SIGKILL when the spawning thread dies | live |
//! | Windows | a Job object with `KILL_ON_JOB_CLOSE` | NOT DONE — see below |
//! | macOS | nothing exists | never |
//!
//! **Two caveats on the Linux one, both real and both accepted.** `PR_SET_PDEATHSIG` is keyed to the spawning
//! THREAD, not the process: a tokio worker thread that exited while the app lived would take the child with it. The
//! multi-threaded runtime's workers live for the runtime's lifetime, so in practice the thread and the app die
//! together — measured, with a forward held well past any idle timeout and still up. And the signal is armed by the
//! child AFTER the fork, so a parent that died in between would never be seen: the `getppid` check below is what
//! closes that window, by refusing to become the child at all.
//!
//! **Windows is not done here, and this is where to start.** It needs a Job object created once for the app,
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` set on it, and every child assigned to it — roughly thirty lines of `unsafe`
//! FFI over `windows-sys`, which is not currently a direct dependency. It was left out because it cannot be COMPILED
//! on the machine this was written on, let alone run: `cargo check --target x86_64-pc-windows-msvc` fails in
//! `aws-lc-sys`'s C build script on the untouched tree, so the alternative was shipping unverifiable `unsafe` FFI
//! into the release pipeline. The Wails shell's twin (`src-wails/child_guard_*.go`) has the same gap for the same
//! reason, so the two shells stay aligned.

/// Ask the kernel to kill this child when the app dies, on the platforms whose kernel offers that. No-op elsewhere,
/// which leaves exactly the behaviour these children had before.
pub fn die_with_parent_tokio(cmd: &mut tokio::process::Command) {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        // Read HERE, in the parent, so the child can tell whether it is still the same parent it was forked from.
        let spawned_under = unsafe { libc::getpid() };
        // SAFETY: `pre_exec` runs between fork and exec, where only async-signal-safe calls are legal. `prctl`,
        // `getppid` and `_exit` all are; nothing here allocates, locks or touches the runtime.
        unsafe {
            cmd.as_std_mut().pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                // The app may have died in the instant between the fork and the line above, in which case the kernel
                // already delivered its signal to nobody and this child would outlive it after all. Being reparented
                // is how that is visible from in here.
                if libc::getppid() != spawned_under {
                    libc::_exit(1);
                }
                Ok(())
            });
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = cmd;
}

// Kernel behaviour, measured rather than assumed — the whole point of this module is what happens when NO code of
// ours runs, so a test that stubs the kill has tested nothing. Proving it needs three processes: this test, a parent
// it can kill, and the guarded grandchild that must not survive. The parent is a second copy of the test binary,
// which is the cheapest process that can call the helper being tested.
#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    // Set by the test on the copy it spawns; that copy takes the helper branch instead of asserting anything.
    const HELPER: &str = "CD_CHILD_GUARD_HELPER";

    fn alive(pid: i32) -> bool {
        // Signal 0 delivers nothing and only asks whether the process is there to receive one.
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    fn a_guarded_child_does_not_outlive_the_process_that_spawned_it() {
        if std::env::var(HELPER).is_ok() {
            // A MULTI-THREADED runtime, because that is what the app runs and because the thread is the whole
            // question: PR_SET_PDEATHSIG is keyed to the thread that forked, so a child spawned on a worker would be
            // killed early if that worker were ever retired, and never killed at all if the signal were keyed
            // somewhere this arrangement does not reach. Testing it on a current-thread runtime would prove the easy
            // case and leave the app's own untested.
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(4)
                .enable_all()
                .build()
                .expect("runtime");
            runtime.block_on(async {
                let mut command = tokio::process::Command::new("/bin/sleep");
                command.arg("600").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
                super::die_with_parent_tokio(&mut command);
                let child = command.spawn().expect("sleep");
                // Flushed, because stdout is BLOCK-buffered when it is a pipe rather than a terminal: without this
                // the line sits in this process's buffer, the test above waits for a pid that never arrives, and the
                // run hangs instead of failing. Measured.
                println!("GRANDCHILD {}", child.id().expect("pid"));
                let _ = std::io::Write::flush(&mut std::io::stdout());
                // Deliberately never reaped and never killed: this process is about to be SIGKILLed, so anything
                // written after this line would be cleanup the real case does not get either.
                tokio::time::sleep(Duration::from_secs(600)).await;
            });
            return;
        }

        let mut parent = std::process::Command::new(std::env::current_exe().expect("test binary"))
            // A substring of the test's own name, not `--exact`: libtest matches on the FULL path
            // (`child_guard::tests::…`), so an exact filter of the bare function name selects nothing and the copy
            // runs no test at all — measured, it reported "running 0 tests" and printed no pid.
            .args(["a_guarded_child_does_not_outlive", "--nocapture", "--test-threads", "1"])
            .env(HELPER, "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn the parent under test");
        let mut lines = BufReader::new(parent.stdout.take().expect("stdout")).lines();
        // Searched WITHIN the line, not as its prefix: libtest writes `test <name> ... ` with no trailing newline
        // before the test's own output, so the pid arrives on the end of that line. Matching a prefix found nothing
        // and the read then blocked forever on a line that never came — measured, as a hang rather than a failure.
        const MARKER: &str = "GRANDCHILD ";
        let grandchild: i32 = loop {
            let line = lines.next().expect("the parent never named its child").expect("stdout");
            if let Some(at) = line.find(MARKER) {
                break line[at + MARKER.len()..].trim().parse().expect("a pid");
            }
        };
        // Without this the assertion below is vacuous: "the child is gone" says nothing unless it was ever there.
        assert!(alive(grandchild), "the guarded child never started");

        // SIGKILL, not SIGTERM: the case this exists for is the app getting no chance to clean up after itself.
        unsafe { libc::kill(parent.id() as i32, libc::SIGKILL) };
        let _ = parent.wait();

        let deadline = Instant::now() + Duration::from_secs(5);
        while alive(grandchild) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        if alive(grandchild) {
            unsafe { libc::kill(grandchild, libc::SIGKILL) };
            panic!("the child outlived the process that spawned it — the kernel was never asked to end it");
        }
    }
}
