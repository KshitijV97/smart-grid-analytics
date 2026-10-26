// Package mlclient calls the Python ML service.
package mlclient

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// Client forwards requests to the ML service. On Cloud Run the ML service is
// private, so each call carries a Google-signed ID token for Audience.
type Client struct {
	BaseURL  string
	Audience string
	HTTP     *http.Client

	mu       sync.Mutex
	token    string
	tokenExp time.Time
}

// New creates a client. Training and ingestion are asynchronous on the ML side,
// so only forecasts take long; a generous timeout covers them.
func New(baseURL, audience string) *Client {
	return &Client{BaseURL: baseURL, Audience: audience, HTTP: &http.Client{Timeout: 5 * time.Minute}}
}

// Response is a raw upstream response.
type Response struct {
	Status int
	Body   []byte
}

// Do sends method+path with an optional JSON body and returns the raw response.
func (c *Client) Do(ctx context.Context, method, path string, body []byte) (Response, error) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, rd)
	if err != nil {
		return Response{}, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Audience != "" {
		tok, err := c.idToken(ctx)
		if err != nil {
			return Response{}, fmt.Errorf("fetch id token: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return Response{}, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return Response{}, err
	}
	return Response{Status: resp.StatusCode, Body: data}, nil
}

// idToken fetches (and caches) an ID token from the Cloud Run metadata server.
func (c *Client) idToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.tokenExp) {
		return c.token, nil
	}
	u := "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=" +
		url.QueryEscape(c.Audience)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Metadata-Flavor", "Google")
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metadata server: HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	// Tokens live one hour; refresh well before expiry.
	c.token, c.tokenExp = string(b), time.Now().Add(45*time.Minute)
	return c.token, nil
}
