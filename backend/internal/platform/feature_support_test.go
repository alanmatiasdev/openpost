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

func TestPlatformSupportsAnalyticsLinkedInCommunityManagementParsing(t *testing.T) {
	tests := []struct {
		name     string
		capState string
		want     bool
	}{
		{"exact match", `{"linkedin_account_type":"community_management"}`, false},
		{"person type", `{"linkedin_account_type":"person"}`, true},
		{"organization type", `{"linkedin_account_type":"organization"}`, true},
		{"unrelated key with community_management value", `{"other_key":"community_management"}`, true},
		{"unrelated string containing substring", `{"note":"not_community_management_related"}`, true},
		{"similar value with suffix", `{"linkedin_account_type":"community_management_extra"}`, true},
		{"similar value with prefix", `{"linkedin_account_type":"xcommunity_management"}`, true},
		{"extra fields alongside exact match", `{"linkedin_account_type":"community_management","extra":"foo"}`, false},
		{"malformed JSON fail-safe", `not-json`, true},
		{"malformed JSON with substring fail-safe", `{"linkedin_account_type":"community_management"`, true},
		{"empty object", `{}`, true},
		{"null JSON", `null`, true},
		{"whitespace around JSON", `  {"linkedin_account_type":"community_management"}  `, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := PlatformSupportsAnalytics("linkedin", tc.capState)
			if got != tc.want {
				t.Errorf("PlatformSupportsAnalytics(linkedin,%q)=%v want %v", tc.capState, got, tc.want)
			}
		})
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
