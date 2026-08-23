package memes

import (
	"bytes"
	"context"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuiltinProviderOwnsTheCompletePinnedCatalog(t *testing.T) {
	t.Parallel()

	provider, err := NewBuiltinProvider()
	require.NoError(t, err)
	require.Equal(t, BuiltinProviderKey, provider.Key())
	require.True(t, provider.Available())

	catalog, err := provider.Templates(context.Background())
	require.NoError(t, err)
	require.Len(t, catalog.Templates, 209)
	require.False(t, catalog.Stale)

	byID := make(map[string]Template, len(catalog.Templates))
	for _, template := range catalog.Templates {
		byID[template.ID] = template
	}
	require.Equal(t, 2, byID["drake"].Lines)
	require.Equal(t, 3, byID["3hd"].Overlays)
	require.True(t, byID["bongo"].Animated)
	require.NotEmpty(t, byID["gru"].Semantic.Meaning)
	require.Len(t, byID["gru"].Semantic.CaptionRoles, byID["gru"].Lines)
}

func TestBuiltinProviderRendersLocallyWithoutWatermark(t *testing.T) {
	t.Parallel()

	provider, err := NewBuiltinProvider()
	require.NoError(t, err)

	blank, err := provider.Render(context.Background(), RenderRequest{
		TemplateID: "drake",
		Text:       []string{"", ""},
		Extension:  "png",
	})
	require.NoError(t, err)
	rendered, err := provider.Render(context.Background(), RenderRequest{
		TemplateID: "drake",
		Text:       []string{"Remote renderer", "OpenPost renderer"},
		Extension:  "png",
	})
	require.NoError(t, err)
	require.Equal(t, "image/png", rendered.MIMEType)
	require.Equal(t, "png", rendered.Extension)
	require.Equal(t, "drake", rendered.TemplateID)
	require.NotEqual(t, blank.Data, rendered.Data)

	blankConfig, _, err := image.DecodeConfig(bytes.NewReader(blank.Data))
	require.NoError(t, err)
	renderedConfig, _, err := image.DecodeConfig(bytes.NewReader(rendered.Data))
	require.NoError(t, err)
	require.Equal(t, blankConfig, renderedConfig)
}

func TestBuiltinProviderReturnsSmallCacheableTemplateImages(t *testing.T) {
	t.Parallel()

	provider, err := NewBuiltinProvider()
	require.NoError(t, err)

	thumbnail, err := provider.TemplateImage(context.Background(), "drake")
	require.NoError(t, err)
	require.Equal(t, "drake", thumbnail.TemplateID)
	require.Less(t, len(thumbnail.Data), 100_000)

	config, _, err := image.DecodeConfig(bytes.NewReader(thumbnail.Data))
	require.NoError(t, err)
	require.LessOrEqual(t, config.Width, 480)
	require.LessOrEqual(t, config.Height, 480)
}
