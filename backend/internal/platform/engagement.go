package platform

// EngagementSupport describes a provider's normalized comment and reply capabilities.
type EngagementSupport struct {
	Enabled        bool
	RequiredScopes []string
	CanReply       bool
	CanHide        bool
	CanDelete      bool
	CanLike        bool
	Unavailable    string
}

// EngagementAdapter is the optional provider seam used by Engagement.
type EngagementAdapter interface {
	CommentAdapter
	EngagementSupport() EngagementSupport
}
