//go:build windows

package main

import (
	"os/exec"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// configureDeathWithParent is a no-op on Windows: there is no flag to set before the start here. The whole mechanism
// is the job object adoptIntoAppJob puts the started child into.
func configureDeathWithParent(_ *exec.Cmd) {}

var (
	appJobOnce sync.Once
	appJob     windows.Handle
)

// appJobHandle returns the app's one job, built on first use. The handle is DELIBERATELY never closed: the kernel
// closes it when this process ends, and that close IS the mechanism — closing it early would kill every live child. A
// zero handle means there is none, and every caller then does nothing, which is the pre-guard behaviour.
func appJobHandle() windows.Handle {
	appJobOnce.Do(func() {
		// Unnamed and with no security attributes of its own: nothing else may open it, and only this process ever
		// holds a handle to it.
		job, err := windows.CreateJobObject(nil, nil)
		if err != nil {
			return
		}
		var limits windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
		limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		if _, err := windows.SetInformationJobObject(
			job,
			windows.JobObjectExtendedLimitInformation,
			uintptr(unsafe.Pointer(&limits)),
			uint32(unsafe.Sizeof(limits)),
		); err != nil {
			// Closing is safe HERE and nowhere else in this file: no child has been adopted yet, so the
			// kill-on-close this just failed to set cannot take anything down with it.
			_ = windows.CloseHandle(job)
			return
		}
		appJob = job
	})
	return appJob
}

// adoptIntoAppJob puts a freshly started child in the app's job, so the kernel ends it when the app's last handle to
// that job closes — which is what a KILLED app does and what nothing else here can arrange. Best effort: refused when
// the child has already exited, and on pre-Windows-8 when this app is itself inside someone else's job. A refusal
// leaves exactly the behaviour the child had before this existed.
func adoptIntoAppJob(cmd *exec.Cmd) {
	job := appJobHandle()
	if job == 0 || cmd.Process == nil {
		return
	}
	// Reopened by pid because os.Process does not expose its handle. The window for a recycled pid is the few
	// microseconds since Start returned, during which the child is still running and therefore still holding its own
	// pid — the Rust twin has the child's handle directly and does not need this.
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		return
	}
	defer func() { _ = windows.CloseHandle(process) }()
	_ = windows.AssignProcessToJobObject(job, process)
}
