package platform

import "testing"

func TestPlatformSupportsAnalyticsParity(t *testing.T) {
	tests := []struct {
		platform string
		capState string
		want     bool
	}{
		{"x", "", true},
		{"bluesky", "", true},
		{"mastodon", "", true},
		{"facebook", "", true},
		{"instagram", "", true},
		{"threads", "", true},
		{"youtube", "", true},
		{"tiktok", "", true},
		{"linkedin", "", true},
		{"linkedin", `{"linkedin_account_type":"community_management"}`, false},
		{"discord", "", false},
		{"unknown", "", false},
	}
	for _, tc := range tests {
		if got := PlatformSupportsAnalytics(tc.platform, tc.capState); got != tc.want {
			t.Errorf("PlatformSupportsAnalytics(%q,%q)=%v want %v", tc.platform, tc.capState, got, tc.want)
		}
	}
}

func TestPlatformSupportsEngagementParity(t *testing.T) {
	enabled := map[string]bool{
		"facebook": true, "instagram": true, "linkedin": true, "threads": true,
		"mastodon": true, "bluesky": true, "x": true, "youtube": true,
	}
	for _, p := range []string{"facebook", "instagram", "linkedin", "threads", "mastodon", "bluesky", "x", "youtube", "discord", "tiktok"} {
		got := PlatformSupportsEngagement(p)
		want := enabled[p]
		if got != want {
			t.Errorf("PlatformSupportsEngagement(%q)=%v want %v", p, got, want)
		}
	}
}

func TestPlatformSupportsGrowParity(t *testing.T) {
	if !PlatformSupportsGrow("bluesky") || !PlatformSupportsGrow("mastodon") {
		t.Error("grow should support bluesky and mastodon")
	}
	if PlatformSupportsGrow("x") || PlatformSupportsGrow("discord") {
		t.Error("grow should not support x or discord")
	}
}
