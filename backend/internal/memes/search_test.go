package memes

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSearchTemplatesUsesSemanticMeaningAndTags(t *testing.T) {
	t.Parallel()

	template := Template{
		ID:   "choice",
		Name: "Two panels",
		Semantic: TemplateSemantic{
			Meaning: "Reject the weak option and prefer the stronger one.",
			Tags:    []string{"preference", "comparison"},
		},
	}
	template.SearchTerms, template.searchText = buildSearchMetadata(template)

	byMeaning := searchTemplates([]Template{template}, "stronger option", 10)
	require.Len(t, byMeaning, 1)
	require.Equal(t, template.ID, byMeaning[0].ID)

	byTag := searchTemplates([]Template{template}, "preference", 10)
	require.Len(t, byTag, 1)
	require.Equal(t, template.ID, byTag[0].ID)
}
