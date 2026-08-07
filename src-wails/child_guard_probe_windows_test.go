//go:build windows

package main

import "golang.org/x/sys/windows"

func processAlive(pid int) bool {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return false
	}
	defer func() { _ = windows.CloseHandle(handle) }()
	// Waited on rather than asked for an exit code: a terminated process's object lingers for as long as any handle to
	// it is open, so "OpenProcess succeeded" is not "still running" — and an exit code of 259 is indistinguishable
	// from STILL_ACTIVE. A zero-timeout wait is unambiguous.
	event, err := windows.WaitForSingleObject(handle, 0)
	if err != nil {
		return false
	}
	return event == uint32(windows.WAIT_TIMEOUT)
}

func endProcess(pid int) {
	handle, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return
	}
	defer func() { _ = windows.CloseHandle(handle) }()
	_ = windows.TerminateProcess(handle, 1)
}
