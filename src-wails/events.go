package main

import "github.com/wailsapp/wails/v3/pkg/application"

// emitToRenderer pushes a stream event to the renderer over Wails Events — the injected test emitter (override),
// or the live Wails app emitter (application.Get). Shared by ProxyService + ProcessService, which both stream to
// "stream://<channel>" where <channel> is the JS WailsChannel's numeric id (bridge.ts).
func emitToRenderer(override func(name string, data any), name string, data any) {
	if override != nil {
		override(name, data)
		return
	}
	application.Get().Event.EmitEvent(&application.CustomEvent{Name: name, Data: data})
}
