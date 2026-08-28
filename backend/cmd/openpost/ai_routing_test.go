package main

import (
	"testing"

	"github.com/openpost/backend/internal/config"
	"github.com/stretchr/testify/require"
)

func TestOpenRouterConfigsGiveContentGenerationAnIndependentRetryBudget(t *testing.T) {
	cfg := &config.Config{
		OpenRouterAPIKey:       "test-key",
		PublicURL:              "https://app.example.test",
		ContentAIProvider:      "azure/eu",
		ContentAIRequireZDR:    true,
		ImageCaptionProvider:   "azure/eu",
		ImageCaptionRequireZDR: true,
	}

	imageConfig, contentConfig := openRouterConfigs(cfg)

	require.Equal(t, "azure/eu", imageConfig.Provider)
	require.True(t, imageConfig.RequireZDR)
	require.Equal(t, "azure/eu", contentConfig.Provider)
	require.True(t, contentConfig.RequireZDR)
	require.Equal(t, contentAIRequestTimeout, contentConfig.Timeout)
	require.Equal(t, contentAIRetryMaxElapsedTime, contentConfig.RetryMaxElapsedTime)
	require.Zero(t, imageConfig.RetryMaxElapsedTime)
	require.Equal(t, imageConfig.APIKey, contentConfig.APIKey)
	require.Equal(t, imageConfig.HTTPReferer, contentConfig.HTTPReferer)
}
