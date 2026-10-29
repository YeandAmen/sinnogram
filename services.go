package main

import (
	"errors"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

// The service directory keeps its existing accounts and data. Only these public
// and owner-scoped APIs are exposed; admin endpoints are never bridged.
func servicePath(method, path string) (string, bool) {
	auth := map[string]bool{"/api/auth/get-session": true, "/api/auth/sign-in/email": true, "/api/auth/sign-up/email": true, "/api/auth/email-otp/send-verification-otp": true, "/api/auth/sign-in/email-otp": true, "/api/auth/sign-out": true}
	if auth[path] {
		return path, (method == "GET" && path == "/api/auth/get-session") || (method == "POST" && path != "/api/auth/get-session")
	}
	if !strings.HasPrefix(path, "/api/services/") {
		return "", false
	}
	target := "/api/" + strings.TrimPrefix(path, "/api/services/")
	bits := strings.Split(strings.TrimPrefix(target, "/api/"), "/")
	if len(bits) == 1 {
		if method == "GET" && (bits[0] == "providers" || bits[0] == "session" || bits[0] == "enquiries" || bits[0] == "my-profile") {
			return target, true
		}
		if method == "POST" && (bits[0] == "providers" || bits[0] == "photos") {
			return target, true
		}
	}
	if len(bits) >= 2 && validServiceID(bits[1]) {
		if method == "GET" && bits[0] == "providers" && (len(bits) == 2 || (len(bits) == 3 && bits[2] == "reviews")) {
			return target, true
		}
		if method == "POST" && len(bits) == 3 && ((bits[0] == "providers" && bits[2] == "enquiries") || (bits[0] == "enquiries" && bits[2] == "reply")) {
			return target, true
		}
	}
	return "", false
}
func validServiceID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
func newServicesBridge(target *url.URL, transport http.RoundTripper) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = transport
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Host = target.Host
		// CSRF is checked against the browser-facing origin before translation.
		r.Header.Set("Origin", target.Scheme+"://"+target.Host)
		r.Header.Set("Referer", target.Scheme+"://"+target.Host+"/")
		for _, h := range []string{"Forwarded", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-For", "Authorization"} {
			r.Header.Del(h)
		}
		cookies := r.Cookies()
		r.Header.Del("Cookie")
		for _, c := range cookies {
			if strings.HasPrefix(c.Name, "better-auth.") || strings.HasPrefix(c.Name, "__Secure-better-auth.") {
				r.AddCookie(c)
			}
		}
	}
	proxy.ModifyResponse = func(r *http.Response) error {
		if r.Header.Get("Location") != "" {
			return errors.New("unexpected service redirect")
		}
		cookies := r.Cookies()
		r.Header.Del("Set-Cookie")
		for _, c := range cookies {
			if strings.HasPrefix(c.Name, "better-auth.") || strings.HasPrefix(c.Name, "__Secure-better-auth.") {
				c.Domain = ""
				c.Path = "/"
				r.Header.Add("Set-Cookie", c.String())
			}
		}
		r.Header.Set("Cache-Control", "no-store")
		r.Header.Del("Access-Control-Allow-Origin")
		r.Header.Del("Access-Control-Allow-Credentials")
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		fail(w, 502, "Services are temporarily unavailable. Please try again.")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, ok := servicePath(r.Method, r.URL.Path)
		if !ok {
			fail(w, 404, "Service endpoint not found.")
			return
		}
		if r.Method == "POST" {
			origin := r.Header.Get("Origin")
			expected := "https://" + r.Host
			if r.Host == "localhost:8080" || r.Host == "127.0.0.1:8080" {
				expected = "http://" + r.Host
			}
			if origin != expected {
				fail(w, 403, "Open Sinnogram to continue.")
				return
			}
			if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
				fail(w, 415, "JSON request required.")
				return
			}
			if r.ContentLength > 2<<20 {
				fail(w, 413, "This upload is too large.")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
		}
		r.URL.Path = path
		r.URL.RawPath = ""
		r.URL.RawQuery = ""
		proxy.ServeHTTP(w, r)
	})
}
func servicesBridge() http.Handler {
	target, _ := url.Parse("https://fyield-services.vercel.app")
	return newServicesBridge(target, &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 20 * time.Second, TLSHandshakeTimeout: 10 * time.Second, IdleConnTimeout: 60 * time.Second, MaxIdleConnsPerHost: 4})
}
