package postgeneration

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/stretchr/testify/require"
)

type generatorFunc func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (f generatorFunc) Generate(ctx context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	return f(ctx, request)
}

func TestBuildReturnsCanonicalCopyAndEveryRequestedRendition(t *testing.T) {
	var request ai.GenerateRequest
	service, err := New(generatorFunc(func(_ context.Context, input ai.GenerateRequest) (ai.GenerateResult, error) {
		request = input
		return ai.GenerateResult{
			Text:  `{"source_text":"We shipped offline mode. Your drafts now keep moving without a connection.","renditions":[{"target":"target_1","body":"Offline mode is live. Keep drafting even when the connection drops."},{"target":"target_2","body":"We shipped offline mode so your publishing work can continue through unreliable connections."}]}`,
			Model: "openai/gpt-5.6-luna",
		}, nil
	}), "openai/gpt-5.6-luna")
	require.NoError(t, err)

	result, err := service.Build(t.Context(), Input{
		Idea: "We shipped offline mode for drafting on bad connections.",
		Destinations: []Destination{
			{AccountID: "account-secret-x", Platform: "x", Profile: "short_text"},
			{AccountID: "account-secret-linkedin", Platform: "linkedin", Profile: "short_text"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "We shipped offline mode. Your drafts now keep moving without a connection.", result.SourceText)
	require.Equal(t, []Rendition{
		{AccountID: "account-secret-x", Body: "Offline mode is live. Keep drafting even when the connection drops."},
		{AccountID: "account-secret-linkedin", Body: "We shipped offline mode so your publishing work can continue through unreliable connections."},
	}, result.Renditions)
	require.Equal(t, "openai/gpt-5.6-luna", result.Model)
	require.NotContains(t, request.UserPrompt, "account-secret")
	require.Contains(t, request.UserPrompt, "target_1")
	require.Contains(t, request.UserPrompt, "linkedin")
	require.Contains(t, request.UserPrompt, `"max_characters":280`)
	require.Contains(t, request.SystemPrompt, "Never use em dashes")
	for _, rule := range []string{
		"Use plain, active language",
		"Cut puffery, promotional language, vague claims, filler, and generic conclusions",
		"Do not force ideas into groups of three",
		"Do not use decorative emoji",
	} {
		require.Contains(t, request.SystemPrompt, rule)
	}
}

func TestBuildRemovesDashPunctuationFromGeneratedCopy(t *testing.T) {
	service, err := New(generatorFunc(func(_ context.Context, _ ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{
			Text: `{"source_text":"Build once—publish everywhere.","renditions":[{"target":"target_1","body":"Write once – adapt for each channel."}]}`,
		}, nil
	}), "openai/gpt-5.6-luna")
	require.NoError(t, err)

	result, err := service.Build(t.Context(), Input{
		Idea:         "Build once and publish everywhere.",
		Destinations: []Destination{{AccountID: "account-1", Platform: "linkedin"}},
	})
	require.NoError(t, err)
	require.Equal(t, "Build once, publish everywhere.", result.SourceText)
	require.Equal(t, "Write once, adapt for each channel.", result.Renditions[0].Body)
	require.NotContains(t, result.SourceText, "—")
	require.NotContains(t, result.Renditions[0].Body, "–")
}

func TestBuildFitsRenditionsToDestinationLimit(t *testing.T) {
	tooLong := strings.Repeat("a", 274) + " 日本語"
	require.Less(t, utf8.RuneCountInString(tooLong), 280)
	service, err := New(generatorFunc(func(_ context.Context, _ ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{
			Text: `{"source_text":"Draft","renditions":[{"target":"target_1","body":"` + tooLong + `"}]}`,
		}, nil
	}), "openai/gpt-5.6-luna")
	require.NoError(t, err)

	result, err := service.Build(t.Context(), Input{
		Idea:         "Draft",
		Destinations: []Destination{{AccountID: "account-x", Platform: "x"}},
	})
	require.NoError(t, err)
	require.Equal(t, strings.Repeat("a", 274), result.Renditions[0].Body)
	require.LessOrEqual(t, capabilities.TextLength("x", result.Renditions[0].Body), 280)
}

func TestBuildRejectsMissingOrInventedDestinationOutput(t *testing.T) {
	service, err := New(generatorFunc(func(_ context.Context, _ ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{
			Text: `{"source_text":"Draft","renditions":[{"target":"target_2","body":"Invented"}]}`,
		}, nil
	}), "openai/gpt-5.6-luna")
	require.NoError(t, err)

	_, err = service.Build(t.Context(), Input{
		Idea:         "Draft",
		Destinations: []Destination{{AccountID: "account-1", Platform: "x"}},
	})
	require.ErrorIs(t, err, ErrInvalidResponse)
}
