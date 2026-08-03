package main

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// isPublicAddress reports whether an IP literal is ordinary public unicast — mirroring isBlockedAddress in
// adapters/webSearch.ts plus the documented bypass ranges (0.0.0.0, CGNAT, IPv4-mapped-private, benchmarking).
func isPublicAddress(s string) bool {
	host := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(s), "["), "]")
	if i := strings.IndexByte(host, '%'); i >= 0 {
		host = host[:i]
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() || // IsPrivate covers 10/8,172.16/12,192.168/16,fc00::/7
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		switch {
		case v4[0] == 0: // 0.0.0.0/8
			return false
		case v4[0] == 100 && v4[1]&0xc0 == 64: // CGNAT 100.64/10
			return false
		case v4[0] == 192 && v4[1] == 0 && v4[2] == 0: // 192.0.0.0/24
			return false
		case v4[0] == 198 && (v4[1] == 18 || v4[1] == 19): // 198.18/15 benchmarking
			return false
		case v4[0] >= 240: // 240/4 reserved
			return false
		}
	} else if ip[0] == 0x20 && ip[1] == 0x01 && ip[2] == 0x0d && ip[3] == 0xb8 { // 2001:db8::/32 documentation
		return false
	}
	return true
}

// PublicWebFetchService is the Go analog of src-tauri/src/public_web_fetch.rs: an address-pinned public web fetch
// for the AI web-search tool. The webview names a URL and the addresses its SSRF guard already validated public;
// this service independently RE-validates each is public (defense in depth — the JS guard stays authoritative),
// dials ONLY the validated address (no re-resolution) while keeping the URL Host + TLS SNI, follows NO redirect
// (the guard walks them), and streams the body back over the same Wails-event contract ProxyService uses. No
// keychain/credential access ever happens on this path — that is a deliberate difference from the provider proxy.
type PublicWebFetchService struct {
	isPublic func(string) bool           // injectable for tests; production = isPublicAddress
	emit     func(name string, data any) // nil → the live Wails app emitter (application.Get), as ProxyService
	mu       sync.Mutex
	streams  map[string]context.CancelFunc
	counter  atomic.Uint64
}

func newPublicWebFetchService(isPublic func(string) bool) *PublicWebFetchService {
	return &PublicWebFetchService{isPublic: isPublic}
}

// Input — deserialized from the JS adapter. The invoke wraps it as { payload: {...}, channel }; channel is the
// WailsChannel's numeric id (bridge.ts), so stream events are emitted to "stream://<channel>".
type publicFetchArgs struct {
	Payload publicFetchPayload `json:"payload"`
	Channel uint64             `json:"channel"`
}

type publicFetchPayload struct {
	URL       string            `json:"url"`
	Addresses []string          `json:"addresses"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
}

type publicFetchDestroyArgs struct {
	StreamID string `json:"streamId"`
}

// PublicFetchHandle mirrors src-tauri PublicFetchHandle (camelCase) — the TS adapter reads these fields.
type PublicFetchHandle struct {
	StreamID   string            `json:"streamId"`
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	Headers    map[string]string `json:"headers"`
}

const publicFetchOpenTimeout = 15 * time.Second

// pinnedClient dials ONLY the validated public IP (no re-resolution), keeps Host + TLS SNI, follows no redirect.
func (s *PublicWebFetchService) pinnedClient(host, dialAddr string) *http.Client {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 10 * time.Second}
			return d.DialContext(ctx, network, dialAddr) // dialAddr = validatedIP:port
		},
		TLSClientConfig:   &tls.Config{ServerName: host},
		DisableKeepAlives: true,
	}
	return &http.Client{
		Transport:     transport,
		Timeout:       publicFetchOpenTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// firstPublicDialAddr re-validates each address and returns the first "ip:port" that passes, else an error.
func (s *PublicWebFetchService) firstPublicDialAddr(u *url.URL, addresses []string) (string, error) {
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	for _, a := range addresses {
		if s.isPublic(a) {
			host := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(a), "["), "]")
			if i := strings.IndexByte(host, '%'); i >= 0 {
				host = host[:i]
			}
			return net.JoinHostPort(host, port), nil
		}
	}
	return "", errors.New("AI: no validated public address available")
}

// Request pins to a validated public address, returns the handle once headers arrive, then pumps body chunks to
// "stream://<channel>" (base64 binary frames, so arbitrary bytes survive the JSON-only Wails Events transport)
// until EOF (end) or error. The pump goroutine is cancelable via Destroy.
func (s *PublicWebFetchService) Request(args publicFetchArgs) (PublicFetchHandle, error) {
	payload := args.Payload
	u, err := url.Parse(payload.URL)
	if err != nil {
		return PublicFetchHandle{}, errors.New("AI: invalid URL")
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return PublicFetchHandle{}, errors.New("AI: invalid URL")
	}
	dialAddr, err := s.firstPublicDialAddr(u, payload.Addresses)
	if err != nil {
		return PublicFetchHandle{}, err
	}

	method := strings.ToUpper(strings.TrimSpace(payload.Method))
	if method == "" {
		method = http.MethodGet
	}
	ctx, cancel := context.WithCancel(context.Background())
	httpReq, err := http.NewRequestWithContext(ctx, method, u.String(), nil)
	if err != nil {
		cancel()
		return PublicFetchHandle{}, err
	}
	for name, value := range payload.Headers {
		httpReq.Header.Set(name, value)
	}

	response, err := s.pinnedClient(u.Hostname(), dialAddr).Do(httpReq)
	if err != nil {
		cancel()
		return PublicFetchHandle{}, err
	}

	streamID := fmt.Sprintf("web-%d", s.counter.Add(1))
	eventName := fmt.Sprintf("stream://%d", args.Channel)
	s.registerStream(streamID, cancel)

	go func() {
		defer func() { _ = response.Body.Close() }()
		defer s.removeStream(streamID)
		buf := make([]byte, 32*1024)
		for {
			n, readErr := response.Body.Read(buf)
			if n > 0 {
				s.emitStream(eventName, streamEvent{
					StreamID: streamID,
					Type:     "data",
					Binary:   true,
					Payload:  base64.StdEncoding.EncodeToString(buf[:n]),
				})
			}
			if readErr != nil {
				if ctx.Err() != nil {
					return // destroyed / aborted — suppress the trailing event
				}
				if errors.Is(readErr, io.EOF) {
					s.emitStream(eventName, streamEvent{StreamID: streamID, Type: "end"})
				} else {
					s.emitStream(eventName, streamEvent{StreamID: streamID, Type: "error", Payload: map[string]string{"message": readErr.Error()}})
				}
				return
			}
		}
	}()

	return PublicFetchHandle{
		StreamID:   streamID,
		Status:     response.StatusCode,
		StatusText: http.StatusText(response.StatusCode),
		Headers:    collectHeaders(response.Header),
	}, nil
}

// Destroy aborts a stream's chunk pump (from the JS adapter's abort/cancel).
func (s *PublicWebFetchService) Destroy(args publicFetchDestroyArgs) {
	s.mu.Lock()
	cancel, ok := s.streams[args.StreamID]
	if ok {
		delete(s.streams, args.StreamID)
	}
	s.mu.Unlock()
	if ok {
		cancel()
	}
}

func (s *PublicWebFetchService) registerStream(id string, cancel context.CancelFunc) {
	s.mu.Lock()
	if s.streams == nil {
		s.streams = map[string]context.CancelFunc{}
	}
	s.streams[id] = cancel
	s.mu.Unlock()
}

func (s *PublicWebFetchService) removeStream(id string) {
	s.mu.Lock()
	delete(s.streams, id)
	s.mu.Unlock()
}

func (s *PublicWebFetchService) emitStream(name string, event streamEvent) {
	emitToRenderer(s.emit, name, event)
}
