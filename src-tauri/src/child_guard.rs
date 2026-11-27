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
//! | Linux | `PR_SET_PDEATHSIG` — the kernel signals the child when the spawning thread dies | live |
//! | Windows | a Job object with `KILL_ON_JOB_CLOSE` — the kernel ends the job when its last handle closes | live |
//! | macOS | nothing exists | never |
//!
//! **The two mechanisms attach on OPPOSITE sides of the spawn**, which is why `spawn_bound_to_app` owns the spawn
//! rather than leaving a caller two things to remember: Linux arms the child before it execs, Windows can only adopt
//! a process that already exists. A call site that did one and forgot the other would be silently unguarded on that
//! platform, and nothing would say so until the ports ran out.
//!
//! **Two caveats on the Linux one, both real and both accepted.** `PR_SET_PDEATHSIG` is keyed to the spawning
//! THREAD, not the process: a tokio worker thread that exited while the app lived would take the child with it. The
//! multi-threaded runtime's workers live for the runtime's lifetime, so in practice the thread and the app die
//! together — measured, with a forward held well past any idle timeout and still up. And the signal is armed by the
//! child AFTER the fork, so a parent that died in between would never be seen: the `getppid` check below is what
//! closes that window, by refusing to become the child at all.
//!
//! **Three on the Windows one, in descending order of how much they matter.**
//!
//! 1. **The app itself is deliberately NOT in the job**, even though putting it there would close the race below for
//!    free — a process's children join its job automatically. It must not be: a provider sign-in opens the user's
//!    own BROWSER, and a browser inside a `KILL_ON_JOB_CLOSE` job is torn down when the app dies. Killing the user's
//!    browser session is far worse than the leak this module exists to fix, so only the children this app names are
//!    adopted.
//! 2. **A child is adopted just AFTER `CreateProcess` returns**, so an app killed in that window leaves it behind —
//!    the analogue of the Linux fork window, and the one thing here with no equivalent of the `getppid` check.
//!    Closing it needs the job handed to the kernel AT creation (`PROC_THREAD_ATTRIBUTE_JOB_LIST`), which
//!    `std::process::Command` does not expose; reaching it means hand-rolling `CreateProcessW` and giving up tokio's
//!    pipe plumbing. Not worth it for a window measured in microseconds, and there is no in-child hook to close it
//!    with either — the child is `ssh.exe`, not code of ours.
//! 3. **Assignment is best effort.** It is refused when the child has already exited, and on pre-Windows-8 when the
//!    app is itself inside someone else's job (nested jobs are legal from Win8 on). A refusal leaves exactly the
//!    behaviour the child had before this module existed, so it is not worth failing a spawn over.

/// Spawn a child this app is responsible for, tied to the app's own lifetime by the kernel wherever the kernel
/// offers that. Elsewhere it is a plain spawn, which leaves exactly the behaviour these children had before.
pub fn spawn_bound_to_app(
    cmd: &mut tokio::process::Command,
) -> std::io::Result<tokio::process::Child> {
    #[cfg(target_os = "linux")]
    arm_parent_death_signal(cmd);
    let child = cmd.spawn()?;
    #[cfg(windows)]
    windows_job::adopt(&child);
    Ok(child)
}

/// Ask the kernel to SIGKILL this child when the thread that forked it dies.
#[cfg(target_os = "linux")]
fn arm_parent_death_signal(cmd: &mut tokio::process::Command) {
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

#[cfg(windows)]
mod windows_job {
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // The app's job, as a usize because a raw pointer is not Sync. 0 means "there is none" — every failure to build
    // one lands there, and every caller then does nothing, which is the pre-guard behaviour.
    static APP_JOB: OnceLock<usize> = OnceLock::new();

    // One job for the whole app, built on first use. The handle is DELIBERATELY never closed: the kernel closes it
    // when this process ends, and that close IS the mechanism — closing it early would kill every live child.
    fn app_job() -> HANDLE {
        *APP_JOB.get_or_init(|| {
            // Unnamed and with no security attributes of its own: nothing else may open it, and only this process
            // ever holds a handle to it.
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return 0;
            }
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let set = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if set == 0 {
                // Closing is safe HERE and nowhere else in this module: no child has been adopted yet, so the
                // kill-on-close this just failed to set cannot take anything down with it.
                unsafe { CloseHandle(job) };
                return 0;
            }
            job as usize
        }) as HANDLE
    }

    /// Put a freshly spawned child in the app's job, so the kernel ends it when the app's handles close.
    pub fn adopt(child: &tokio::process::Child) {
        let job = app_job();
        if job.is_null() {
            return;
        }
        // The child's own handle, not its pid: a pid can be recycled the instant the process exits, and adopting
        // the wrong process would put a stranger under this app's kill-on-close.
        let Some(handle) = child.raw_handle() else {
            return;
        };
        // Best effort by construction — see caveat 3 in this module's docs.
        unsafe { AssignProcessToJobObject(job, handle) };
    }
}

// Kernel behaviour, measured rather than assumed — the whole point of this module is what happens when NO code of
// ours runs, so a test that stubs the kill has tested nothing. Proving it needs three processes: this test, a parent
// it can kill, and the guarded grandchild that must not survive. The parent is a second copy of the test binary,
// which is the cheapest process that can call the helper being tested. ONE test for both platforms, because
// everything hard-won about it — libtest's output shape, the buffering, the multi-threaded runtime — is the same on
// each; only "what stays alive" and "is that pid alive" differ, and those are the two shims below.
#[cfg(all(test, any(target_os = "linux", windows)))]
mod tests {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    // Set by the test on the copy it spawns; that copy takes the helper branch instead of asserting anything.
    const HELPER: &str = "CD_CHILD_GUARD_HELPER";

    #[cfg(target_os = "linux")]
    mod platform {
        // 600s of doing nothing, from a binary every Linux has.
        pub fn long_lived() -> tokio::process::Command {
            let mut command = tokio::process::Command::new("/bin/sleep");
            command.arg("600");
            command
        }

        pub fn alive(pid: u32) -> bool {
            // Signal 0 delivers nothing and only asks whether the process is there to receive one.
            unsafe { libc::kill(pid as i32, 0) == 0 }
        }

        pub fn end(pid: u32) {
            unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        }
    }

    #[cfg(windows)]
    mod platform {
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_TERMINATE,
        };

        // SYNCHRONIZE: the right to wait on the object. (winnt.h — windows-sys only exposes it as a FILE_ access
        // right, in a feature this crate has no other use for.)
        const SYNCHRONIZE: u32 = 0x0010_0000;

        // Pings loopback until stopped: the longest-lived process available from a stock Windows with no console
        // and no stdin.
        pub fn long_lived() -> tokio::process::Command {
            let mut command = tokio::process::Command::new("ping");
            command.args(["-t", "127.0.0.1"]);
            command
        }

        pub fn alive(pid: u32) -> bool {
            let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
            if handle.is_null() {
                return false;
            }
            // Waited on rather than asked for an exit code: a terminated process's object lingers while any handle
            // to it is open, so "OpenProcess succeeded" is not "still running" — and an exit code of 259 is
            // indistinguishable from STILL_ACTIVE. A zero-timeout wait is unambiguous.
            let signalled = unsafe { WaitForSingleObject(handle, 0) };
            unsafe { CloseHandle(handle) };
            signalled == WAIT_TIMEOUT
        }

        pub fn end(pid: u32) {
            let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
            if handle.is_null() {
                return;
            }
            unsafe { TerminateProcess(handle, 1) };
            unsafe { CloseHandle(handle) };
        }
    }

    #[test]
    fn a_guarded_child_does_not_outlive_the_process_that_spawned_it() {
        if std::env::var(HELPER).is_ok() {
            // A MULTI-THREADED runtime, because that is what the app runs and because the thread is the whole
            // question on Linux: PR_SET_PDEATHSIG is keyed to the thread that forked, so a child spawned on a worker
            // would be killed early if that worker were ever retired, and never killed at all if the signal were
            // keyed somewhere this arrangement does not reach. Testing it on a current-thread runtime would prove
            // the easy case and leave the app's own untested.
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(4)
                .enable_all()
                .build()
                .expect("runtime");
            runtime.block_on(async {
                let mut command = platform::long_lived();
                command
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                let child = super::spawn_bound_to_app(&mut command).expect("the long-lived child");
                // Flushed, because stdout is BLOCK-buffered when it is a pipe rather than a terminal: without this
                // the line sits in this process's buffer, the test above waits for a pid that never arrives, and the
                // run hangs instead of failing. Measured.
                println!("GRANDCHILD {}", child.id().expect("pid"));
                let _ = std::io::Write::flush(&mut std::io::stdout());
                // Deliberately never reaped and never killed: this process is about to be killed outright, so
                // anything written after this line would be cleanup the real case does not get either.
                tokio::time::sleep(Duration::from_secs(600)).await;
            });
            return;
        }

        let mut parent = std::process::Command::new(std::env::current_exe().expect("test binary"))
            // A substring of the test's own name, not `--exact`: libtest matches on the FULL path
            // (`child_guard::tests::…`), so an exact filter of the bare function name selects nothing and the copy
            // runs no test at all — measured, it reported "running 0 tests" and printed no pid.
            .args([
                "a_guarded_child_does_not_outlive",
                "--nocapture",
                "--test-threads",
                "1",
            ])
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
        let grandchild: u32 = loop {
            let line = lines
                .next()
                .expect("the parent never named its child")
                .expect("stdout");
            if let Some(at) = line.find(MARKER) {
                break line[at + MARKER.len()..].trim().parse().expect("a pid");
            }
        };
        // Without this the assertion below is vacuous: "the child is gone" says nothing unless it was ever there.
        assert!(
            platform::alive(grandchild),
            "the guarded child never started"
        );

        // `kill` and not a request to stop: SIGKILL on Unix, TerminateProcess on Windows. The case this exists for
        // is the app getting no chance to clean up after itself.
        parent.kill().expect("kill the parent under test");
        let _ = parent.wait();

        let deadline = Instant::now() + Duration::from_secs(5);
        while platform::alive(grandchild) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        if platform::alive(grandchild) {
            // Ended by hand before failing: a red test must not leave the very kind of orphan it was measuring.
            platform::end(grandchild);
            panic!("the child outlived the process that spawned it — the kernel was never asked to end it");
        }
    }
}
