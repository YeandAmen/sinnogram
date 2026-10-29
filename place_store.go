package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxPlaceStoreBytes = 8 << 20

var errPlaceConflict = errors.New("place registry changed; retry the update")

// Compare-and-swap keeps submissions and approvals atomic across server instances.
type placeStore interface {
	Read(context.Context) ([]byte, string, error)
	Write(context.Context, []byte, string) error
}

type filePlaceStore struct{ path string }

func (s *filePlaceStore) Read(ctx context.Context) ([]byte, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	f, err := os.Open(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxPlaceStoreBytes+1))
	if err != nil || len(b) > maxPlaceStoreBytes {
		return nil, "", errors.New("place registry could not be read")
	}
	return b, fmt.Sprintf("%x", sha256.Sum256(b)), nil
}

func (s *filePlaceStore) Write(ctx context.Context, b []byte, version string) error {
	if len(b) > maxPlaceStoreBytes {
		return errors.New("place registry is full")
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	lock, err := os.OpenFile(s.path+".lock", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		return errPlaceConflict
	}
	if err != nil {
		return err
	}
	defer func() { lock.Close(); os.Remove(s.path + ".lock") }()
	_, current, err := s.Read(ctx)
	if err != nil {
		return err
	}
	if current != version {
		return errPlaceConflict
	}
	f, err := os.CreateTemp(filepath.Dir(s.path), ".places-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), s.path)
}

type blobPlaceStore struct {
	token, objectURL, apiURL, storeID string
	client                            *http.Client
}

func newBlobPlaceStore(token, objectURL string) (*blobPlaceStore, error) {
	g, err := newSharedGate(token, objectURL)
	if err != nil {
		return nil, errors.New("invalid place registry storage configuration")
	}
	return &blobPlaceStore{token: token, objectURL: objectURL, apiURL: g.apiURL, storeID: g.storeID, client: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (s *blobPlaceStore) Read(ctx context.Context) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.objectURL+"?cache=0", nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, "", errors.New("shared place storage is unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, "", nil
	}
	if resp.StatusCode != 200 || resp.Header.Get("ETag") == "" {
		return nil, "", errors.New("shared place storage is unavailable")
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxPlaceStoreBytes+1))
	if err != nil || len(b) > maxPlaceStoreBytes {
		return nil, "", errors.New("invalid shared place storage response")
	}
	return b, resp.Header.Get("ETag"), nil
}

func (s *blobPlaceStore) Write(ctx context.Context, b []byte, version string) error {
	if len(b) > maxPlaceStoreBytes {
		return errors.New("place registry is full")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.apiURL, bytes.NewReader(b))
	if err != nil {
		return err
	}
	for k, v := range map[string]string{"Authorization": "Bearer " + s.token, "Content-Type": "application/json", "x-content-type": "application/json", "x-vercel-blob-access": "private", "x-add-random-suffix": "0", "x-api-version": "13", "x-vercel-blob-store-id": s.storeID} {
		req.Header.Set(k, v)
	}
	if version == "" {
		// First creation may not overwrite another instance's newly created object.
		req.Header.Set("x-allow-overwrite", "0")
	} else {
		req.Header.Set("x-allow-overwrite", "1")
		req.Header.Set("x-if-match", version)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return errors.New("shared place storage is unavailable")
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode == 409 || resp.StatusCode == http.StatusPreconditionFailed {
		return errPlaceConflict
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return errors.New("shared place update could not be saved")
	}
	return nil
}

func configuredPlaceStore() (placeStore, string) {
	if path := os.Getenv("SINNOGRAM_PLACE_FILE"); path != "" {
		if os.Getenv("VERCEL") == "1" {
			return nil, "Use shared Blob storage for Vercel place submissions."
		}
		return &filePlaceStore{path: path}, ""
	}
	token, objectURL := os.Getenv("BLOB_READ_WRITE_TOKEN"), os.Getenv("SINNOGRAM_PLACE_REGISTRY_URL")
	if objectURL == "" && token != "" {
		if gate, err := url.Parse(os.Getenv("SINNOGRAM_GATE_URL")); err == nil && strings.HasSuffix(gate.Hostname(), ".private.blob.vercel-storage.com") {
			gate.Path, gate.RawPath, gate.RawQuery, gate.Fragment = "/sinnogram-place-registry-v1.json", "", "", ""
			objectURL = gate.String()
		}
	}
	if token == "" || objectURL == "" {
		return nil, "Shared place submissions are being configured. You can still use a pin in your trip."
	}
	if objectURL == os.Getenv("SINNOGRAM_GATE_URL") {
		return nil, "The place registry needs its own storage object."
	}
	s, err := newBlobPlaceStore(token, objectURL)
	if err != nil {
		return nil, err.Error()
	}
	return s, ""
}
