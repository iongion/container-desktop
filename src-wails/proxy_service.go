package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ProxyService is the engine-API proxy — the Go side of ICommand.ProxyRequest, the analog of src-tauri/src/proxy.rs.
// It dials the engine's REST API over a LOCAL transport (unix socket on Linux/macOS, named pipe on Windows — see
// proxy_dial_*.go) and re-synthesizes the EXACT shapes container-client/Api.clients.ts consumes:
//
//	buffered ok      → { stream:false, ok:true,  status, statusText, headers, data }
//	buffered failure → { stream:false, ok:false, status, statusText, headers, data, message }  (never an error)
//
// One http.Client per socket (connection-pool reuse, mirroring the keep-alive agent). Streaming (proxy_request_stream
// over Events) is Phase 2b — buffered requests (the container/image listing) go through here.
type ProxyService struct {
	mu      sync.Mutex
	clients map[string]*http.Client
	streams map[string]context.CancelFunc
	counter atomic.Uint64
	// emit sends a stream event to the renderer; nil → the live Wails app emitter (application.Get). Injectable
	// so the streaming logic is unit-testable without a running webview.
	emit func(name string, data any)
}

const (
	proxyDefaultTimeoutMs    = 3000
	proxyStreamOpenTimeoutMs = 15000
)

// Input — deserialized from the JS binding (unknown fields ignored). The invoke wraps it as { payload: {...} }.
type proxyRequestArgs struct {
	Payload proxyRequestPayload `json:"payload"`
}

type proxyRequestPayload struct {
	Req        proxyReq        `json:"req"`
	Connection proxyConnection `json:"connection"`
	// Present for an SSH/WSL remote (BridgeService must bring it up first — Phase 2b); nil for a direct local dial.
	Bridge *bridgeSpec `json:"bridge"`
}

type proxyReq struct {
	Method       string            `json:"method"`
	URL          string            `json:"url"`
	BaseURL      string            `json:"baseURL"`
	Params       json.RawMessage   `json:"params"`
	Data         json.RawMessage   `json:"data"`
	Headers      map[string]string `json:"headers"`
	ResponseType string            `json:"responseType"`
	Timeout      uint64            `json:"timeout"`
}

type proxyConnection struct {
	Settings struct {
		API struct {
			Connection struct {
				URI   string `json:"uri"`
				Relay string `json:"relay"`
			} `json:"connection"`
		} `json:"api"`
	} `json:"settings"`
}

// bridgeSpec mirrors src/platform/wails/exec/proxy-request.ts BridgeSpec — consumed by BridgeService in Phase 2b.
type bridgeSpec struct {
	Kind         string   `json:"kind"`
	Key          string   `json:"key"`
	LocalAddress string   `json:"localAddress"`
	Launcher     string   `json:"launcher"`
	Argv         []string `json:"argv"`
}

// Output — matches src-tauri/src/proxy.rs ProxyResponse field-for-field.
type ProxyResponse struct {
	Stream     bool              `json:"stream"`
	OK         bool              `json:"ok"`
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	Headers    map[string]string `json:"headers"`
	Data       any               `json:"data"`
	Message    *string           `json:"message"`
}

// Request performs a buffered request: resolve the socket, send, read the whole body, return a serializable
// response. Transport/timeout/build errors come back as ok:false with a message — NEVER a returned error, so the
// JS binding can always shape a __proxyError envelope instead of rejecting. Mirrors proxy.rs proxy_request.
func (s *ProxyService) Request(args proxyRequestArgs) ProxyResponse {
	payload := args.Payload
	socket, err := resolveProxyTarget(payload)
	if err != nil {
		return proxyErrorResponse(err)
	}
	resp, err := s.doBuffered(payload, socket)
	if err != nil {
		return proxyErrorResponse(err)
	}
	return resp
}

func proxyErrorResponse(err error) ProxyResponse {
	message := err.Error()
	return ProxyResponse{Stream: false, OK: false, Headers: map[string]string{}, Message: &message}
}

// The socket/pipe to dial. A direct connection reads connection.settings.api.connection.{relay|uri}; an SSH/WSL
// remote (bridge present) is Phase 2b.
func resolveProxyTarget(payload proxyRequestPayload) (string, error) {
	if payload.Bridge != nil {
		// SSH/WSL remote: bring up (or reuse) the dial-stdio bridge / ssh -NL tunnel and dial its LOCAL end.
		return bridges.ensure(*payload.Bridge)
	}
	return resolveSocketPath(payload.Connection)
}

func (s *ProxyService) doBuffered(payload proxyRequestPayload, socket string) (ProxyResponse, error) {
	timeoutMs := payload.Req.Timeout
	if timeoutMs == 0 {
		timeoutMs = proxyDefaultTimeoutMs
	}
	httpReq, err := buildProxyRequest(payload.Req)
	if err != nil {
		return ProxyResponse{}, err
	}
	ctx := context.Background()
	if timeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
		defer cancel()
	}
	response, err := s.clientFor(socket).Do(httpReq.WithContext(ctx))
	if err != nil {
		return ProxyResponse{}, err
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return ProxyResponse{}, err
	}
	status := response.StatusCode
	ok := status >= 200 && status < 300
	out := ProxyResponse{
		Stream:     false,
		OK:         ok,
		Status:     status,
		StatusText: http.StatusText(status),
		Headers:    collectHeaders(response.Header),
		Data:       parseBody(body, payload.Req.ResponseType),
	}
	if !ok {
		message := fmt.Sprintf("Request failed with status code %d", status)
		out.Message = &message
	}
	return out, nil
}

// clientFor returns (creating+caching) the http.Client bound to one local transport (every request over it), so
// the connection pool is reused per socket. The dial is platform-specific (proxy_dial_{unix,windows}.go).
func (s *ProxyService) clientFor(socket string) *http.Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clients == nil {
		s.clients = map[string]*http.Client{}
	}
	if client, ok := s.clients[socket]; ok {
		return client
	}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialLocalTransport(ctx, socket)
		},
	}
	client := &http.Client{Transport: transport}
	s.clients[socket] = client
	return client
}

// buildProxyRequest builds <baseURL>/<url> with query params, default headers overlaid by req.headers (request
// wins), and a JSON body from `data`. baseURL defaults to http://d (the socket transport ignores the host).
func buildProxyRequest(req proxyReq) (*http.Request, error) {
	method := strings.ToUpper(req.Method)
	if method == "" {
		method = http.MethodGet
	}
	baseURL := req.BaseURL
	if baseURL == "" {
		baseURL = "http://d"
	}
	target := strings.TrimRight(baseURL, "/") + req.URL
	if len(req.Params) > 0 {
		var params map[string]any
		if json.Unmarshal(req.Params, &params) == nil && len(params) > 0 {
			query := url.Values{}
			for key, value := range params {
				if value != nil {
					query.Set(key, fmt.Sprint(value))
				}
			}
			if encoded := query.Encode(); encoded != "" {
				target += "?" + encoded
			}
		}
	}

	var body io.Reader
	if len(req.Data) > 0 && string(req.Data) != "null" {
		body = bytes.NewReader(req.Data)
	}
	httpReq, err := http.NewRequest(method, target, body)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("User-Agent", "Container Desktop")
	for key, value := range req.Headers {
		httpReq.Header.Set(key, value)
	}
	return httpReq, nil
}

// parseBody matches axios parsing: arraybuffer → the raw bytes as a (utf8-lossy) string; else parse JSON, falling
// back to a string on non-JSON.
func parseBody(body []byte, responseType string) any {
	if responseType == "arraybuffer" {
		return string(body)
	}
	var value any
	if json.Unmarshal(body, &value) == nil {
		return value
	}
	return string(body)
}

// collectHeaders flattens response headers to a lowercase-keyed string map (matching reqwest's lowercase names
// that Api.clients.ts reads).
func collectHeaders(header http.Header) map[string]string {
	out := make(map[string]string, len(header))
	for key, values := range header {
		if len(values) > 0 {
			out[strings.ToLower(key)] = values[len(values)-1]
		}
	}
	return out
}

// resolveSocketPath reads connection.settings.api.connection.{relay|uri} (relay wins), strips the unix://|npipe://
// scheme, then applies the Flatpak remap. Empty → error (the caller shapes a __proxyError). Mirrors proxy.rs.
func resolveSocketPath(connection proxyConnection) (string, error) {
	raw := connection.Settings.API.Connection.Relay
	if raw == "" {
		raw = connection.Settings.API.Connection.URI
	}
	stripped := strings.ReplaceAll(strings.ReplaceAll(raw, "npipe://", ""), "unix://", "")
	if stripped == "" {
		return "", errors.New("no socket path (connection.settings.api.connection.uri is empty)")
	}
	return flatpakRemap(stripped), nil
}

// flatpakRemap: Linux Flatpak sandbox → host socket remap (mirrors Api.clients.ts). No-op outside Flatpak / off Linux.
func flatpakRemap(path string) string {
	if runtime.GOOS != "linux" {
		return path
	}
	inFlatpak := os.Getenv("FLATPAK_ID") != ""
	if !inFlatpak {
		if _, err := os.Stat("/.flatpak-info"); err == nil {
			inFlatpak = true
		}
	}
	if !inFlatpak {
		return path
	}
	if strings.HasPrefix(path, "/run/user") {
		return "/var" + path
	}
	return "/var/run/host" + path
}

// Connectivity test — the analog of proxy.rs proxy_test_connectivity. Invoked as { payload: { proxy, url, timeoutMs } }.

type proxyTestArgs struct {
	Payload proxyTestPayload `json:"payload"`
}

type proxyTestPayload struct {
	Proxy     proxyTestConfig `json:"proxy"`
	URL       string          `json:"url"`
	TimeoutMs uint64          `json:"timeoutMs"`
}

type proxyTestConfig struct {
	Mode     string   `json:"mode"`
	Protocol string   `json:"protocol"`
	Host     string   `json:"host"`
	Port     uint16   `json:"port"`
	Username string   `json:"username"`
	Password string   `json:"password"`
	Bypass   []string `json:"bypass"`
}

// ProxyConnectivityResult matches src-tauri/src/proxy.rs ProxyConnectivityResult.
type ProxyConnectivityResult struct {
	OK          bool    `json:"ok"`
	URL         string  `json:"url"`
	Status      *int    `json:"status"`
	ElapsedMs   int64   `json:"elapsedMs"`
	ProxyActive bool    `json:"proxyActive"`
	Error       *string `json:"error"`
}

// TestConnectivity GETs url (optionally through the configured manual proxy) and reports reachability + latency.
func (s *ProxyService) TestConnectivity(args proxyTestArgs) ProxyConnectivityResult {
	payload := args.Payload
	start := time.Now()
	target := payload.URL
	if target == "" {
		target = "http://example.com/"
	}
	proxyActive := payload.Proxy.Mode == "manual" && strings.TrimSpace(payload.Proxy.Host) != "" && payload.Proxy.Port > 0
	timeoutMs := payload.TimeoutMs
	if timeoutMs == 0 {
		timeoutMs = 10000
	}

	transport := &http.Transport{}
	if proxyActive {
		proxyURL, err := proxyURLForTest(payload.Proxy)
		if err != nil {
			return connectivityError(target, start, proxyActive, err)
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	client := &http.Client{Timeout: time.Duration(timeoutMs) * time.Millisecond, Transport: transport}
	response, err := client.Get(target)
	if err != nil {
		return connectivityError(target, start, proxyActive, err)
	}
	defer func() { _ = response.Body.Close() }()
	status := response.StatusCode
	return ProxyConnectivityResult{
		OK:          status < 500,
		URL:         target,
		Status:      &status,
		ElapsedMs:   time.Since(start).Milliseconds(),
		ProxyActive: proxyActive,
	}
}

func connectivityError(target string, start time.Time, proxyActive bool, err error) ProxyConnectivityResult {
	message := err.Error()
	return ProxyConnectivityResult{
		OK:          false,
		URL:         target,
		ElapsedMs:   time.Since(start).Milliseconds(),
		ProxyActive: proxyActive,
		Error:       &message,
	}
}

func proxyURLForTest(config proxyTestConfig) (*url.URL, error) {
	scheme := config.Protocol
	if scheme == "" {
		scheme = "http"
	}
	host := config.Host
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") && !strings.HasSuffix(host, "]") {
		host = "[" + host + "]"
	}
	proxyURL, err := url.Parse(fmt.Sprintf("%s://%s:%d", scheme, host, config.Port))
	if err != nil {
		return nil, err
	}
	if config.Username != "" {
		if config.Password != "" {
			proxyURL.User = url.UserPassword(config.Username, config.Password)
		} else {
			proxyURL.User = url.User(config.Username)
		}
	}
	return proxyURL, nil
}
