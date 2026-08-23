package connectors

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (fn resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return fn(ctx, host)
}

func TestClientCompletesPreconfiguredConnectionAndPublishes(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	var received PublishRequest
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		require.Equal(t, "Bearer connector-secret", request.Header.Get("Authorization"))
		response.Header().Set("Content-Type", "application/json")
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/v1/manifest":
			manifest := validManifest()
			require.NoError(t, json.NewEncoder(response).Encode(manifest))
		case request.Method == http.MethodGet && request.URL.Path == "/v1/health":
			require.NoError(t, json.NewEncoder(response).Encode(HealthResponse{Status: "ready"}))
		case request.Method == http.MethodPost && request.URL.Path == "/v1/connections":
			require.NoError(t, json.NewEncoder(response).Encode(ConnectionResponse{
				State:         "complete",
				ConnectionRef: "directus/openpost_posts",
				Accounts: []ConnectionAccount{{
					ID: "openpost_posts", Username: "openpost_posts", DisplayName: "OpenPost posts",
				}},
			}))
		case request.Method == http.MethodPost && request.URL.Path == "/v1/publishes":
			defer request.Body.Close()
			mu.Lock()
			defer mu.Unlock()
			require.NoError(t, json.NewDecoder(request.Body).Decode(&received))
			require.NoError(t, json.NewEncoder(response).Encode(PublishResponse{
				Status: "published", ExternalID: "item-42", ExternalURL: "https://cms.example/items/42",
			}))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := newPrivateTestClient(t, server.URL)
	manifest, err := client.Manifest(context.Background())
	require.NoError(t, err)
	require.Equal(t, "io.directus.items", manifest.Provider.ID)
	require.NoError(t, client.Health(context.Background()))

	connection, err := client.Connect(context.Background(), ConnectionRequest{WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.Equal(t, "complete", connection.State)
	require.Equal(t, "directus/openpost_posts", connection.ConnectionRef)

	result, err := client.Publish(context.Background(), PublishRequest{
		OperationID:        "authorization:1:rendition:publish",
		ConnectionRef:      connection.ConnectionRef,
		CapabilityRevision: "directus-items-v1",
		OutputProfile:      "directus.item",
		Content:            "A connector-backed publication",
		Settings:           map[string]any{"status": "published"},
	})
	require.NoError(t, err)
	require.Equal(t, "published", result.Status)
	require.Equal(t, "item-42", result.ExternalID)
	mu.Lock()
	require.Equal(t, "authorization:1:rendition:publish", received.OperationID)
	mu.Unlock()
}

func TestClientRejectsCredentialBearingRedirects(t *testing.T) {
	t.Parallel()

	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("redirect target must not receive connector credentials")
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Redirect(response, request, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	client := newPrivateTestClient(t, source.URL)
	_, err := client.Manifest(context.Background())
	require.ErrorContains(t, err, "HTTP status 307")
}

func TestClientRejectsPrivateAddressOutsideConfiguredCIDR(t *testing.T) {
	t.Parallel()

	parsed, err := url.Parse("http://connector.test:8090")
	require.NoError(t, err)
	client, err := NewClient(InstallationConfig{
		ID: "blocked", BearerToken: "secret",
		Endpoint: EndpointConfig{
			Mode: TransportPrivateAllow, BaseURL: parsed.String(),
			AllowedHosts: []string{"connector.test"},
			AllowedCIDRs: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
			AllowedPorts: []int{8090},
		},
	}, ClientOptions{Resolver: resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
	})})
	require.NoError(t, err)
	_, err = client.Manifest(context.Background())
	require.ErrorContains(t, err, "outside the private connector allowlist")
}

func TestClientCapsConnectorResponses(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"padding":"` + strings.Repeat("x", maxResponseBytes) + `"}`))
	}))
	defer server.Close()

	client := newPrivateTestClient(t, server.URL)
	_, err := client.Manifest(context.Background())
	require.ErrorContains(t, err, "response exceeds")
}

func newPrivateTestClient(t *testing.T, rawURL string) *Client {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	require.NoError(t, err)
	port, err := strconv.Atoi(parsed.Port())
	require.NoError(t, err)
	baseURL := "http://connector.test:" + parsed.Port()
	client, err := NewClient(InstallationConfig{
		ID: "directus-main", BearerToken: "connector-secret",
		Endpoint: EndpointConfig{
			Mode: TransportPrivateAllow, BaseURL: baseURL,
			AllowedHosts: []string{"connector.test"},
			AllowedCIDRs: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")},
			AllowedPorts: []int{port},
		},
	}, ClientOptions{
		Timeout: 2 * time.Second,
		Resolver: resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
			require.Equal(t, "connector.test", host)
			return []net.IPAddr{{IP: net.ParseIP(parsed.Hostname())}}, nil
		}),
	})
	require.NoError(t, err)
	return client
}
