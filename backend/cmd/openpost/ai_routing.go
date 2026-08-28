package main

import (
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/config"
)

const (
	contentAIRequestTimeout      = 25 * time.Second
	contentAIRetryMaxElapsedTime = 20 * time.Second
)

func openRouterConfigs(cfg *config.Config) (ai.OpenRouterConfig, ai.OpenRouterConfig) {
	base := ai.OpenRouterConfig{
		APIKey:      cfg.OpenRouterAPIKey,
		HTTPReferer: cfg.PublicURL,
		XTitle:      "OpenPost",
	}
	imageConfig := base
	imageConfig.Provider = cfg.ImageCaptionProvider
	imageConfig.RequireZDR = cfg.ImageCaptionRequireZDR
	contentConfig := base
	contentConfig.Timeout = contentAIRequestTimeout
	contentConfig.Provider = cfg.ContentAIProvider
	contentConfig.RequireZDR = cfg.ContentAIRequireZDR
	contentConfig.RetryMaxElapsedTime = contentAIRetryMaxElapsedTime
	return imageConfig, contentConfig
}
