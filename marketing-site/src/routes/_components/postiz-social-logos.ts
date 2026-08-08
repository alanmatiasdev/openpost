export const postizSocialLogos = {
	bluesky: 'Bluesky.svg',
	devto: 'Devto.svg',
	discord: 'Discord.svg',
	dribbble: 'Dribbble.svg',
	facebook: 'Facebook.svg',
	gmb: 'Gmb.svg',
	hashnode: 'Hashnode.svg',
	instagram: 'Instagram.svg',
	kick: 'Kick.svg',
	lemmy: 'Lemmy.svg',
	linkedin: 'Linkedin.svg',
	listmonk: 'Listmonk.svg',
	mastodon: 'Mastodon.svg',
	medium: 'Medium.svg',
	mewe: 'Mewe.svg',
	nostr: 'Nostr.svg',
	pinterest: 'Pinterest.svg',
	reddit: 'Reddit.svg',
	skool: 'Skool.svg',
	slack: 'Slack.svg',
	telegram: 'Telegram.svg',
	threads: 'Threads.svg',
	tiktok: 'TikTok.svg',
	twitch: 'Twitch.svg',
	vk: 'Vk.svg',
	farcaster: 'Warpcast.svg',
	whop: 'Whop.svg',
	wordpress: 'Wordpress.svg',
	x: 'X.svg',
	youtube: 'Youtube.svg'
} as const;

export type PostizSocialLogo = keyof typeof postizSocialLogos;

export function postizSocialLogoSource(platform: PostizSocialLogo) {
	return `/assets/postiz-socials/${postizSocialLogos[platform]}`;
}
