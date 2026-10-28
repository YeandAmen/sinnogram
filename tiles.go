package main

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Only visible map tiles are requested. The fixed upstream, bounded cache and
// provider cache headers keep this a tile relay, not an arbitrary URL proxy.
type cachedTile struct {
	body    []byte
	headers http.Header
	expires time.Time
}
type tileRelay struct {
	client *http.Client
	base   string
	mu     sync.Mutex
	cache  map[string]cachedTile
	slots  chan struct{}
}

func newTileRelay() *tileRelay {
	return &tileRelay{client: &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, base: "https://tile.openstreetmap.org", cache: make(map[string]cachedTile), slots: make(chan struct{}, 8)}
}
func tilePath(path string) (string, bool) {
	parts := strings.Split(strings.TrimPrefix(path, "/api/tiles/"), "/")
	if len(parts) != 3 || !strings.HasSuffix(parts[2], ".png") {
		return "", false
	}
	parts[2] = strings.TrimSuffix(parts[2], ".png")
	values := make([]int, 3)
	for i, p := range parts {
		v, e := strconv.Atoi(p)
		if e != nil || v < 0 || strconv.Itoa(v) != p {
			return "", false
		}
		values[i] = v
	}
	if values[0] > 19 || values[1] >= 1<<values[0] || values[2] >= 1<<values[0] {
		return "", false
	}
	return strings.Join(parts, "/") + ".png", true
}
func tileExpiry(h http.Header, now time.Time) time.Time {
	for _, v := range strings.Split(h.Get("Cache-Control"), ",") {
		v = strings.TrimSpace(v)
		if v == "no-store" || v == "no-cache" || v == "private" {
			return now
		}
	}
	for _, v := range strings.Split(h.Get("Cache-Control"), ",") {
		if raw, ok := strings.CutPrefix(strings.TrimSpace(v), "max-age="); ok {
			if n, e := strconv.ParseInt(strings.Trim(raw, "\""), 10, 32); e == nil && n >= 0 {
				if age, err := strconv.ParseInt(h.Get("Age"), 10, 32); err == nil && age > 0 {
					n -= age
					if n < 0 {
						n = 0
					}
				}
				return now.Add(time.Duration(n) * time.Second)
			}
		}
	}
	if expiry, e := http.ParseTime(h.Get("Expires")); e == nil {
		return expiry
	}
	h.Set("Cache-Control", "public, max-age=604800")
	return now.Add(7 * 24 * time.Hour)
}
func (t *tileRelay) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	key, ok := tilePath(r.URL.Path)
	if !ok {
		fail(w, 400, "invalid map tile")
		return
	}
	referer, e := url.Parse(r.Referer())
	if e != nil || referer.Host != r.Host || (referer.Scheme != "https" && referer.Scheme != "http") || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		fail(w, 403, "open tiles from the Sinnogram map")
		return
	}
	t.mu.Lock()
	cached, found := t.cache[key]
	t.mu.Unlock()
	if found && time.Now().Before(cached.expires) {
		writeTile(w, r, cached)
		return
	}
	select {
	case t.slots <- struct{}{}:
		defer func() { <-t.slots }()
	case <-r.Context().Done():
		return
	}
	// A queued request may now be satisfiable from another request's cache fill.
	t.mu.Lock()
	cached, found = t.cache[key]
	t.mu.Unlock()
	if found && time.Now().Before(cached.expires) {
		writeTile(w, r, cached)
		return
	}
	req, e := http.NewRequestWithContext(r.Context(), http.MethodGet, t.base+"/"+key, nil)
	if e != nil {
		fail(w, 502, "street map unavailable")
		return
	}
	req.Header.Set("User-Agent", "Sinnogram/1.0 (+https://github.com/YeandAmen/sinnogram)")
	req.Header.Set("Referer", r.Referer())
	if found {
		req.Header.Set("If-None-Match", cached.headers.Get("ETag"))
		req.Header.Set("If-Modified-Since", cached.headers.Get("Last-Modified"))
	}
	resp, e := t.client.Do(req)
	if e != nil {
		fail(w, 502, "street map unavailable; retry shortly")
		return
	}
	defer resp.Body.Close()
	entry := cachedTile{headers: make(http.Header)}
	if resp.StatusCode == http.StatusNotModified && found {
		entry = cached
		entry.headers = cached.headers.Clone()
	} else if resp.StatusCode == http.StatusOK {
		body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024+1))
		if err != nil || len(body) > 512*1024 || !bytes.HasPrefix(body, []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
			fail(w, 502, "invalid street map image")
			return
		}
		entry.body = body
	} else {
		fail(w, 502, "street map provider unavailable; retry shortly")
		return
	}
	for _, name := range []string{"Cache-Control", "Expires", "ETag", "Last-Modified"} {
		if v := resp.Header.Get(name); v != "" {
			entry.headers.Set(name, v)
		}
	}
	entry.headers.Set("Age", resp.Header.Get("Age"))
	entry.expires = tileExpiry(entry.headers, time.Now())
	entry.headers.Del("Age")
	t.mu.Lock()
	if len(t.cache) >= 128 {
		var oldest string
		var expiry time.Time
		for k, v := range t.cache {
			if oldest == "" || v.expires.Before(expiry) {
				oldest = k
				expiry = v.expires
			}
		}
		delete(t.cache, oldest)
	}
	if time.Now().Before(entry.expires) {
		t.cache[key] = entry
	} else {
		delete(t.cache, key)
	}
	t.mu.Unlock()
	writeTile(w, r, entry)
}
func writeTile(w http.ResponseWriter, r *http.Request, entry cachedTile) {
	for k, v := range entry.headers {
		w.Header()[k] = v
	}
	w.Header().Set("Content-Type", "image/png")
	// Send remaining freshness, rather than restarting the TTL on cache hits.
	remaining := int64(time.Until(entry.expires).Seconds())
	if remaining < 0 {
		remaining = 0
	}
	cc := entry.headers.Get("Cache-Control")
	if !strings.Contains(cc, "no-store") && !strings.Contains(cc, "private") && !strings.Contains(cc, "no-cache") {
		w.Header().Set("Cache-Control", "public, max-age="+strconv.FormatInt(remaining, 10)+", s-maxage="+strconv.FormatInt(remaining, 10))
	}
	if etag := entry.headers.Get("ETag"); etag != "" && r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Write(entry.body)
}
