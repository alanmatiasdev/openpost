package platform

import (
	"encoding/json"
	"strings"
)

// PlatformSupportsAnalytics reports whether the given platform has an analytics adapter
// that is enabled by default. This is the canonical source for migration backfill
// and must stay in sync with the per-adapter AnalyticsSupport implementations.
func PlatformSupportsAnalytics(platform string, capabilityState string) bool {
	switch platform {
	case "x", "bluesky", "mastodon", "facebook", "instagram", "threads", "youtube", "tiktok":
		return true
	case "linkedin":
		if isLinkedInCommunityManagementState(capabilityState) {
			return false
		}
		return true
	default:
		return false
	}
}

// PlatformSupportsEngagement reports whether the given platform has an engagement adapter
// that is enabled. Canonical for migration backfill.
func PlatformSupportsEngagement(platform string) bool {
	switch platform {
	case "facebook", "instagram", "linkedin", "threads", "mastodon", "bluesky", "x", "youtube":
		return true
	default:
		return false
	}
}

// PlatformSupportsMessaging reports whether the platform has a messaging adapter.
// Used only for documentation parity; messaging backfill uses capability_state.
func PlatformSupportsMessaging(platform string) bool {
	switch platform {
	case "x", "bluesky", "mastodon", "facebook", "instagram":
		return true
	default:
		return false
	}
}

// PlatformSupportsGrow reports whether the platform supports grow discovery.
func PlatformSupportsGrow(platform string) bool {
	switch platform {
	case "bluesky", "mastodon":
		return true
	default:
		return false
	}
}

func isLinkedInCommunityManagementState(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	var state map[string]string
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return false
	}
	return state["linkedin_account_type"] == "community_management"
}
