import manifest from "./manifest.json" with { type: "json" };
import managedServiceManifest from "./managed-service.json" with { type: "json" };

export const legalPolicy = Object.freeze(manifest);
export const managedService = Object.freeze(managedServiceManifest);

export function formatPolicyEffectiveDate(policy, locale = "en-GB") {
  const date = new Date(`${policy.effective_date}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid policy effective date ${policy.effective_date}`);
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
