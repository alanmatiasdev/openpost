<script lang="ts">
  import Github from "lucide-svelte/icons/github";
  import MessageCircle from "lucide-svelte/icons/message-circle";
  import Logo from "$lib/components/Logo.svelte";
  import PlatformIcon from "$lib/components/platform-icon.svelte";
  import {
    developerDocsUrl,
    githubUrl,
    platforms,
    resourceItems,
    selfHostingDocsUrl,
    userDocsUrl,
  } from "../_marketing";

  const discordCommunityUrl = "https://discord.gg/u2QwukmY4W";
  const groups = [
    {
      title: "Product",
      links: [
        { label: "Overview", href: "/#product" },
        { label: "Platforms", href: "/platforms" },
        { label: "Pricing", href: "/pricing" },
        { label: "Free tools", href: "/tools" },
        { label: "Compare", href: "/compare" },
      ],
    },
    {
      title: "Resources",
      links: resourceItems
        .filter((item) => !["/platforms", "/compare"].includes(item.href))
        .map((item) => ({ label: item.label, href: item.href })),
    },
    {
      title: "Documentation",
      links: [
        { label: "User docs", href: userDocsUrl },
        { label: "Self-hosting", href: selfHostingDocsUrl },
        { label: "Developer docs", href: developerDocsUrl },
        ...platforms.slice(0, 3).map((platform) => ({
          label: `${platform.name} guide`,
          href: `/platforms/${platform.slug}`,
        })),
      ],
    },
  ];
</script>

<footer class="border-t bg-muted/30">
  <div
    class="marketing-shell grid gap-12 py-14 lg:grid-cols-[1.15fr_1.85fr] lg:py-16"
  >
    <div>
      <a
        href="/"
        class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
        aria-label="OpenPost home"
      >
        <Logo width={36} height={28} />
        <span class="text-sm font-semibold">OpenPost</span>
      </a>
      <p class="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
        The content workspace for solo founders. Create once, adapt for every
        platform, stay visible everywhere.
      </p>
      <div class="mt-5 flex flex-wrap gap-x-5">
        <a
          href={githubUrl}
          target="_blank"
          rel="noreferrer"
          class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Github class="size-4" />
          GitHub source
        </a>
        <a
          href={discordCommunityUrl}
          target="_blank"
          rel="noreferrer"
          class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <MessageCircle class="size-4" />
          Discord
        </a>
      </div>
      <div
        class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground"
        aria-label="Supported platforms"
      >
        {#each platforms as platform (platform.slug)}
          <a
            href={`/platforms/${platform.slug}`}
            class="focus-ring inline-flex min-h-8 items-center rounded-md text-muted-foreground/75 transition-colors hover:text-primary"
            aria-label={`${platform.name} guide`}
          >
            <PlatformIcon platform={platform.short} class="size-4" />
          </a>
        {/each}
      </div>
    </div>

    <div class="grid gap-8 sm:grid-cols-3">
      {#each groups as group (group.title)}
        <div>
          <h2 class="text-sm font-semibold">{group.title}</h2>
          <ul class="mt-3 grid gap-1">
            {#each group.links as link (link.href)}
              <li>
                <a
                  href={link.href}
                  class="focus-ring inline-flex min-h-11 items-center rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </div>

  <div class="border-t">
    <div
      class="marketing-shell flex flex-col gap-3 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
    >
      <span>© 2026 OpenPost Contributors · AGPL-3.0-only</span>
      <span class="flex items-center gap-5">
        <span class="hidden sm:inline">Made for companies of one</span>
        <a
          class="focus-ring inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground"
          href="/privacy">Privacy</a
        >
        <a
          class="focus-ring inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground"
          href="/terms">Terms</a
        >
      </span>
    </div>
  </div>
</footer>
