package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// sharedGate holds only an opaque lease token and time, never a user's trip.
// Conditional writes are atomic across all instances; uncached private reads
// provide current state. A stale read cannot win a conditional write.
type sharedGate struct {
	token, objectURL, apiURL, storeID string
	client                            *http.Client
}
type providerLease struct {
	Owner       string `json:"owner"`
	AvailableAt int64  `json:"available_at"`
}

func newSharedGate(token, objectURL string) (*sharedGate, error) {
	u, e := url.Parse(objectURL)
	parts := strings.Split(token, "_")
	if e != nil || u.Scheme != "https" || !strings.HasSuffix(u.Hostname(), ".private.blob.vercel-storage.com") || u.User != nil || u.RawQuery != "" || !strings.HasPrefix(token, "vercel_blob_rw_") || len(parts) < 5 {
		return nil, errors.New("invalid shared request limiter configuration")
	}
	return &sharedGate{token: token, objectURL: objectURL, apiURL: "https://vercel.com/api/blob/?" + url.Values{"pathname": {strings.TrimPrefix(u.Path, "/")}}.Encode(), storeID: parts[3], client: &http.Client{Timeout: 8 * time.Second}}, nil
}
func (g *sharedGate) read(ctx context.Context) (providerLease, string, time.Time, error) {
	var lease providerLease
	req, e := http.NewRequestWithContext(ctx, "GET", g.objectURL+"?cache=0", nil)
	if e != nil {
		return lease, "", time.Time{}, errors.New("request limiter unavailable")
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	response, e := g.client.Do(req)
	if e != nil {
		return lease, "", time.Time{}, errors.New("request limiter unavailable; please try again shortly")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return lease, "", time.Time{}, errors.New("request limiter unavailable; please try again shortly")
	}
	now, e := http.ParseTime(response.Header.Get("Date"))
	etag := response.Header.Get("ETag")
	if e != nil || etag == "" || json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&lease) != nil {
		return lease, "", time.Time{}, errors.New("invalid request limiter response")
	}
	return lease, etag, now, nil
}
func (g *sharedGate) write(ctx context.Context, lease providerLease, etag string) error {
	b, _ := json.Marshal(lease)
	req, e := http.NewRequestWithContext(ctx, "PUT", g.apiURL, bytes.NewReader(b))
	if e != nil {
		return errors.New("request limiter unavailable")
	}
	for k, v := range map[string]string{"Authorization": "Bearer " + g.token, "Content-Type": "application/json", "x-content-type": "application/json", "x-vercel-blob-access": "private", "x-add-random-suffix": "0", "x-allow-overwrite": "1", "x-if-match": etag, "x-api-version": "13", "x-vercel-blob-store-id": g.storeID} {
		req.Header.Set(k, v)
	}
	response, e := g.client.Do(req)
	if e != nil {
		return errors.New("request limiter unavailable; please try again shortly")
	}
	defer response.Body.Close()
	io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode == http.StatusPreconditionFailed {
		return errors.New("the shared map service is busy; wait a few seconds, then try again")
	}
	if response.StatusCode != 200 {
		return errors.New("request limiter unavailable; please try again shortly")
	}
	return nil
}
func (g *sharedGate) acquire(ctx context.Context) (func(), error) {
	lease, etag, now, e := g.read(ctx)
	if e != nil {
		return nil, e
	}
	if lease.AvailableAt > now.UnixMilli() {
		return nil, errors.New("the shared map service is busy; wait a few seconds, then try again")
	}
	token := make([]byte, 16)
	if _, e = rand.Read(token); e != nil {
		return nil, errors.New("request limiter unavailable")
	}
	owner := hex.EncodeToString(token)
	if e = g.write(ctx, providerLease{Owner: owner, AvailableAt: now.Add(60 * time.Second).UnixMilli()}, etag); e != nil {
		return nil, e
	}
	return func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
		defer cancel()
		current, currentTag, clock, e := g.read(releaseCtx)
		if e != nil || current.Owner != owner {
			return
		}
		// Date headers have second precision. 2.3 seconds plus floor comparison
		// keeps the next request safely more than a second after this one ends.
		_ = g.write(releaseCtx, providerLease{Owner: "", AvailableAt: clock.Add(2300 * time.Millisecond).UnixMilli()}, currentTag)
	}, nil
}
