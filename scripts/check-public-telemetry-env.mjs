const isProductionPublicBuild =
  process.env.VITE_OPENPOST_ENVIRONMENT === "production" ||
  (process.env.CF_PAGES === "1" && process.env.CF_PAGES_BRANCH === "main");
const managedAPIHost = "https://cool.openpost.social";
const managedUIHost = "https://eu.posthog.com";

if (isProductionPublicBuild) {
  const required = ["VITE_POSTHOG_PROJECT_TOKEN", "VITE_POSTHOG_API_HOST", "VITE_POSTHOG_UI_HOST"];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Production public-site telemetry is missing: ${missing.join(", ")}`);
  }

  const apiHost = new URL(process.env.VITE_POSTHOG_API_HOST);
  if (apiHost.href.replace(/\/$/u, "") !== managedAPIHost) {
    throw new Error(`VITE_POSTHOG_API_HOST must be ${managedAPIHost} in production`);
  }

  const uiHost = new URL(process.env.VITE_POSTHOG_UI_HOST);
  if (uiHost.href.replace(/\/$/u, "") !== managedUIHost) {
    throw new Error(`VITE_POSTHOG_UI_HOST must be ${managedUIHost} in production`);
  }
}
