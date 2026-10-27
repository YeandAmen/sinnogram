package main

import (
	"context"
	"os"
	"testing"
	"time"
)

// Optional storage integration check. No map-provider requests are made.
func TestLiveSharedGate(t *testing.T) {
	if os.Getenv("SINNOGRAM_LIVE_GATE_TEST") != "1" {
		t.Skip("set SINNOGRAM_LIVE_GATE_TEST=1 with private storage credentials")
	}
	g, e := newSharedGate(os.Getenv("BLOB_READ_WRITE_TOKEN"), os.Getenv("SINNOGRAM_GATE_URL"))
	if e != nil {
		t.Fatal(e)
	}
	release, e := g.acquire(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if _, e = g.acquire(context.Background()); e == nil {
		t.Fatal("a second client acquired the same lease")
	}
	release()
	if _, e = g.acquire(context.Background()); e == nil {
		t.Fatal("cooldown was bypassed")
	}
	time.Sleep(4 * time.Second)
	release, e = g.acquire(context.Background())
	if e != nil {
		t.Fatal("could not acquire after cooldown", e)
	}
	release()
}
