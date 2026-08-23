package connectors

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

const (
	configVersion       = 1
	maxConfigBytes      = 1 << 20
	maxBearerTokenBytes = 8 << 10
)

const (
	TransportPublicHTTPS  = "public_https"
	TransportPrivateAllow = "private_allowlist"
	TransportUnixSocket   = "unix_socket"
)

var installationIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

type Config struct {
	Version       int
	Installations []InstallationConfig
}

type InstallationConfig struct {
	ID                 string
	Required           bool
	WorkspaceAllowlist []string
	Endpoint           EndpointConfig
	BearerTokenFile    string
	BearerToken        string
}

type EndpointConfig struct {
	Mode         string
	BaseURL      string
	SocketPath   string
	AllowedHosts []string
	AllowedCIDRs []netip.Prefix
	AllowedPorts []int
}

type configFile struct {
	Version       int                      `json:"version"`
	Installations []installationConfigFile `json:"installations"`
}

type installationConfigFile struct {
	ID                 string             `json:"id"`
	Required           bool               `json:"required"`
	WorkspaceAllowlist []string           `json:"workspace_allowlist"`
	Endpoint           endpointConfigFile `json:"endpoint"`
	Auth               authConfigFile     `json:"auth"`
}

type endpointConfigFile struct {
	Mode         string   `json:"mode"`
	BaseURL      string   `json:"base_url"`
	SocketPath   string   `json:"socket_path"`
	AllowedHosts []string `json:"allowed_hosts"`
	AllowedCIDRs []string `json:"allowed_cidrs"`
	AllowedPorts []int    `json:"allowed_ports"`
}

type authConfigFile struct {
	BearerTokenFile string `json:"bearer_token_file"`
}

func LoadConfig(path string) (Config, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return Config{Version: configVersion}, nil
	}
	if !filepath.IsAbs(path) {
		return Config{}, fmt.Errorf("connector config path must be an absolute path")
	}
	raw, err := readBoundedFile(path, maxConfigBytes)
	if err != nil {
		return Config{}, fmt.Errorf("read connector config: %w", err)
	}
	var source configFile
	if err := decodeStrictJSON(raw, &source); err != nil {
		return Config{}, fmt.Errorf("decode connector config: %w", err)
	}
	if source.Version != configVersion {
		return Config{}, fmt.Errorf("unsupported connector config version %d", source.Version)
	}

	result := Config{Version: source.Version, Installations: make([]InstallationConfig, 0, len(source.Installations))}
	seen := make(map[string]struct{}, len(source.Installations))
	for index, item := range source.Installations {
		installation, err := loadInstallation(item)
		if err != nil {
			return Config{}, fmt.Errorf("connector installation %d: %w", index, err)
		}
		if _, ok := seen[installation.ID]; ok {
			return Config{}, fmt.Errorf("duplicate connector installation id %q", installation.ID)
		}
		seen[installation.ID] = struct{}{}
		result.Installations = append(result.Installations, installation)
	}
	return result, nil
}

func loadInstallation(source installationConfigFile) (InstallationConfig, error) {
	id := strings.TrimSpace(source.ID)
	if !installationIDPattern.MatchString(id) {
		return InstallationConfig{}, fmt.Errorf("id %q must match %s", id, installationIDPattern)
	}
	endpoint, err := normalizeEndpoint(source.Endpoint)
	if err != nil {
		return InstallationConfig{}, err
	}
	tokenFile := strings.TrimSpace(source.Auth.BearerTokenFile)
	if !filepath.IsAbs(tokenFile) {
		return InstallationConfig{}, fmt.Errorf("bearer_token_file must be an absolute path")
	}
	tokenBytes, err := readBoundedFile(tokenFile, maxBearerTokenBytes)
	if err != nil {
		return InstallationConfig{}, fmt.Errorf("read bearer_token_file: %w", err)
	}
	token := strings.TrimSpace(string(tokenBytes))
	if token == "" {
		return InstallationConfig{}, fmt.Errorf("bearer_token_file is empty")
	}
	if strings.ContainsRune(token, '\x00') || strings.ContainsAny(token, "\r\n") {
		return InstallationConfig{}, fmt.Errorf("bearer_token_file must contain one token")
	}
	workspaces, err := normalizedUniqueStrings(source.WorkspaceAllowlist, "workspace_allowlist")
	if err != nil {
		return InstallationConfig{}, err
	}
	return InstallationConfig{
		ID: id, Required: source.Required, WorkspaceAllowlist: workspaces,
		Endpoint: endpoint, BearerTokenFile: tokenFile, BearerToken: token,
	}, nil
}

func normalizeEndpoint(source endpointConfigFile) (EndpointConfig, error) {
	mode := strings.TrimSpace(source.Mode)
	baseURL := strings.TrimRight(strings.TrimSpace(source.BaseURL), "/")
	socketPath := strings.TrimSpace(source.SocketPath)
	hosts, err := normalizedUniqueStrings(source.AllowedHosts, "allowed_hosts")
	if err != nil {
		return EndpointConfig{}, err
	}
	for index := range hosts {
		hosts[index] = strings.ToLower(hosts[index])
	}
	ports := slices.Clone(source.AllowedPorts)
	slices.Sort(ports)
	ports = slices.Compact(ports)
	for _, port := range ports {
		if port < 1 || port > 65535 {
			return EndpointConfig{}, fmt.Errorf("allowed port %d is outside 1 through 65535", port)
		}
	}
	prefixes := make([]netip.Prefix, 0, len(source.AllowedCIDRs))
	for _, raw := range source.AllowedCIDRs {
		prefix, parseErr := netip.ParsePrefix(strings.TrimSpace(raw))
		if parseErr != nil {
			return EndpointConfig{}, fmt.Errorf("invalid allowed CIDR %q", raw)
		}
		prefixes = append(prefixes, prefix.Masked())
	}

	result := EndpointConfig{
		Mode: mode, BaseURL: baseURL, SocketPath: socketPath,
		AllowedHosts: hosts, AllowedCIDRs: prefixes, AllowedPorts: ports,
	}
	switch mode {
	case TransportPublicHTTPS:
		if err := validateBaseURL(baseURL, "https"); err != nil {
			return EndpointConfig{}, err
		}
		if socketPath != "" || len(hosts) != 0 || len(prefixes) != 0 || len(ports) != 0 {
			return EndpointConfig{}, fmt.Errorf("public_https cannot include private or Unix allowlist fields")
		}
	case TransportPrivateAllow:
		if err := validateBaseURL(baseURL, "http", "https"); err != nil {
			return EndpointConfig{}, err
		}
		parsed, _ := url.Parse(baseURL)
		if !slices.Contains(hosts, strings.ToLower(parsed.Hostname())) {
			return EndpointConfig{}, fmt.Errorf("private base_url host must appear in allowed_hosts")
		}
		port := parsed.Port()
		if port == "" {
			if parsed.Scheme == "https" {
				port = "443"
			} else {
				port = "80"
			}
		}
		if len(prefixes) == 0 {
			return EndpointConfig{}, fmt.Errorf("private_allowlist requires allowed_cidrs")
		}
		if len(ports) == 0 || !slices.Contains(ports, parsePort(port)) {
			return EndpointConfig{}, fmt.Errorf("private base_url port must appear in allowed_ports")
		}
		if socketPath != "" {
			return EndpointConfig{}, fmt.Errorf("private_allowlist cannot include socket_path")
		}
	case TransportUnixSocket:
		if !filepath.IsAbs(socketPath) {
			return EndpointConfig{}, fmt.Errorf("socket_path must be an absolute path")
		}
		if baseURL != "" || len(hosts) != 0 || len(prefixes) != 0 || len(ports) != 0 {
			return EndpointConfig{}, fmt.Errorf("unix_socket cannot include HTTP allowlist fields")
		}
		result.BaseURL = "http://connector"
	default:
		return EndpointConfig{}, fmt.Errorf("unsupported endpoint mode %q", mode)
	}
	return result, nil
}

func validateBaseURL(raw string, schemes ...string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return fmt.Errorf("base_url must be an absolute URL")
	}
	if !slices.Contains(schemes, parsed.Scheme) {
		return fmt.Errorf("base_url scheme must be %s", strings.Join(schemes, " or "))
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return fmt.Errorf("base_url cannot include credentials, a path, query, or fragment")
	}
	return nil
}

func parsePort(raw string) int {
	var port int
	_, _ = fmt.Sscanf(raw, "%d", &port)
	return port
}

func normalizedUniqueStrings(values []string, label string) ([]string, error) {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, fmt.Errorf("%s cannot contain an empty value", label)
		}
		if _, ok := seen[value]; ok {
			return nil, fmt.Errorf("%s contains duplicate value %q", label, value)
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result, nil
}

func readBoundedFile(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	return data, nil
}

func decodeStrictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}
