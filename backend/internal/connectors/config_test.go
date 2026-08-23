package connectors

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadConfigAcceptsOnePrivateConnectorInstallation(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "connector-token")
	require.NoError(t, os.WriteFile(tokenPath, []byte("transport-secret\n"), 0o600))
	configPath := filepath.Join(dir, "connectors.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{
  "version": 1,
  "installations": [{
    "id": "directus-main",
    "required": false,
    "workspace_allowlist": ["workspace-1"],
    "endpoint": {
      "mode": "private_allowlist",
      "base_url": "http://directus-connector:8090",
      "allowed_hosts": ["directus-connector"],
      "allowed_cidrs": ["172.18.0.0/16"],
      "allowed_ports": [8090]
    },
    "auth": {
      "bearer_token_file": "`+tokenPath+`"
    }
  }]
}`), 0o600))

	config, err := LoadConfig(configPath)
	require.NoError(t, err)
	require.Equal(t, 1, config.Version)
	require.Len(t, config.Installations, 1)
	require.Equal(t, "directus-main", config.Installations[0].ID)
	require.Equal(t, "transport-secret", config.Installations[0].BearerToken)
	require.Equal(t, []string{"workspace-1"}, config.Installations[0].WorkspaceAllowlist)
}

func TestLoadConfigRejectsInlineSecretsAndUnknownFields(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "connectors.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{
  "version": 1,
  "installations": [{
    "id": "directus-main",
    "endpoint": {
      "mode": "public_https",
      "base_url": "https://connector.example.com"
    },
    "auth": {
      "bearer_token": "must-not-be-inline"
    }
  }]
}`), 0o600))

	_, err := LoadConfig(configPath)
	require.ErrorContains(t, err, "unknown field")
}

func TestLoadConfigRejectsDuplicateInstallationIDs(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "connector-token")
	require.NoError(t, os.WriteFile(tokenPath, []byte("secret"), 0o600))
	configPath := filepath.Join(dir, "connectors.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{
  "version": 1,
  "installations": [
    {
      "id": "same",
      "endpoint": {"mode": "public_https", "base_url": "https://one.example.com"},
      "auth": {"bearer_token_file": "`+tokenPath+`"}
    },
    {
      "id": "same",
      "endpoint": {"mode": "public_https", "base_url": "https://two.example.com"},
      "auth": {"bearer_token_file": "`+tokenPath+`"}
    }
  ]
}`), 0o600))

	_, err := LoadConfig(configPath)
	require.ErrorContains(t, err, `duplicate connector installation id "same"`)
}

func TestLoadConfigRejectsRelativeSecretFiles(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "connectors.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{
  "version": 1,
  "installations": [{
    "id": "directus-main",
    "endpoint": {"mode": "public_https", "base_url": "https://connector.example.com"},
    "auth": {"bearer_token_file": "relative-token"}
  }]
}`), 0o600))

	_, err := LoadConfig(configPath)
	require.ErrorContains(t, err, "must be an absolute path")
}
