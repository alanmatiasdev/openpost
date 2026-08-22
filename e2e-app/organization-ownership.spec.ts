import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, password, registerUser } from "./helpers";

async function navigateWithinApp(page: Page, href: string) {
  await page.locator("body").evaluate((body, target) => {
    const link = document.createElement("a");
    link.href = target;
    body.append(link);
    link.click();
  }, href);
  await expect.poll(() => page.evaluate(() => location.pathname + location.search)).toBe(href);
}

test("Owner and nominee see truthful ownership-transfer boundaries", async ({
  page,
  request,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `ownership-${unique}@example.com`);
  const nomineeEmail = `ownership-nominee-${unique}@example.com`;
  const nomineeAuth = await registerUser(request, nomineeEmail);
  const workspace = await createWorkspace(request, auth.token, "Ownership browser proof");
  const me = await (
    await request.get("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
  ).json();
  const nominee = await (
    await request.get("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${nomineeAuth.token}` },
    })
  ).json();
  const organizationID = workspace.organization_id;
  const invitationResponse = await request.post(`/api/v1/workspaces/${workspace.id}/invitations`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { email: nomineeEmail, role: "viewer" },
  });
  expect(invitationResponse.ok()).toBeTruthy();
  const invitation = await invitationResponse.json();
  const invitationToken = new URL(invitation.accept_url).searchParams.get("token");
  expect(invitationToken).toBeTruthy();
  const acceptanceResponse = await request.post("/api/v1/workspace-invitations/accept", {
    headers: { Authorization: `Bearer ${nomineeAuth.token}` },
    data: { token: invitationToken },
  });
  expect(acceptanceResponse.ok()).toBeTruthy();
  const removalResponse = await request.delete(
    `/api/v1/workspaces/${workspace.id}/members/${nominee.id}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(removalResponse.ok()).toBeTruthy();
  await page.route(`**/api/v1/organizations/${organizationID}/team`, (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        members: [
          { user_id: me.id, email: me.email, role: "owner" },
          { user_id: nominee.id, email: nomineeEmail, role: "member" },
        ],
        current_seats: 2,
      },
    }),
  );
  await page.route("**/api/v1/auth/security", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        user: { password_usable: true },
        passkeys: [],
        totp_enabled: false,
      },
    }),
  );
  await page.route("**/api/v1/auth/oidc/identities", (route) =>
    route.fulfill({ contentType: "application/json", json: [] }),
  );
  await page.route("**/api/v1/workspaces", (route) =>
    route.fulfill({ contentType: "application/json", json: [] }),
  );
  await page.route("**/api/v1/organizations", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: organizationID,
          name: "Ownership browser proof",
          role: "owner",
          created_at: "2026-08-14T12:00:00Z",
        },
        {
          id: "organization-unavailable",
          name: "Unavailable ownership state",
          role: "owner",
          created_at: "2026-08-14T12:00:00Z",
        },
      ],
    }),
  );
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/settings?tab=ownership&organization=${organizationID}`);
  await expect(page.getByRole("heading", { name: "Ownership", level: 1 })).toBeVisible();
  await page.getByLabel("Successor").click();
  await page.getByRole("option", { name: new RegExp(nomineeEmail) }).click();
  await page.getByLabel("Enter Ownership browser proof to confirm").fill("Ownership browser proof");
  await page.getByLabel("Current password").fill(password);
  const passwordReauth = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/reauth/password",
  );
  const ownershipInitiation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/organizations/${organizationID}/ownership-transfer`,
  );
  await page.getByRole("button", { name: "Nominate successor" }).click();
  expect((await passwordReauth).ok()).toBeTruthy();
  expect((await ownershipInitiation).ok()).toBeTruthy();
  await expect(page.getByText("Ownership transfer pending")).toBeVisible();
  expect(browserErrors).toEqual([]);
  browserErrors.length = 0;
  const transferResponse = await request.get(
    `/api/v1/organizations/${organizationID}/ownership-transfer`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(transferResponse.ok()).toBeTruthy();
  const ownershipState = await transferResponse.json();
  expect(ownershipState.pending).toBe(true);
  const transfer = ownershipState.transfer;

  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "phone", width: 320, height: 760 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(
      viewport.name === "desktop"
        ? "/settings#ownership"
        : `/settings?tab=ownership&organization=${organizationID}`,
    );
    await expect(page.getByRole("heading", { name: "Ownership", level: 1 })).toBeVisible();
    await expect(page.getByText(`Current Owner: ${me.email}`)).toBeVisible();
    await expect(page.getByText("Ownership transfer pending")).toBeVisible();
    await expect(page.getByText(/You remain Owner until acceptance/)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`organization-ownership-${viewport.name}.png`),
      fullPage: true,
    });
  }

  await page.route("**/api/v1/organizations/organization-unavailable/team", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        members: [
          { user_id: me.id, email: me.email, role: "owner" },
          { user_id: nominee.id, email: nomineeEmail, role: "member" },
        ],
        current_seats: 2,
      },
    }),
  );
  await page.route("**/api/v1/organizations/organization-unavailable/ownership-transfer", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      json: {
        status: 500,
        title: "Internal Server Error",
        detail: "Ownership state unavailable",
      },
    }),
  );
  await page.getByLabel("Organization").click();
  await page.getByRole("option", { name: "Unavailable ownership state" }).click();
  await expect(page.getByText("Ownership state unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nominate successor" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke transfer" })).toHaveCount(0);
  expect(browserErrors).toEqual([
    "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
  ]);
  browserErrors.length = 0;

  await page.unroute("**/api/v1/workspaces");
  const nomineeWorkspaces = await request.get("/api/v1/workspaces", {
    headers: { Authorization: `Bearer ${nomineeAuth.token}` },
  });
  expect(nomineeWorkspaces.ok()).toBeTruthy();
  expect(await nomineeWorkspaces.json()).toEqual([]);
  const nomineeOrganizations = await request.get("/api/v1/organizations", {
    headers: { Authorization: `Bearer ${nomineeAuth.token}` },
  });
  expect(nomineeOrganizations.ok()).toBeTruthy();
  expect(await nomineeOrganizations.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: organizationID, role: "member" })]),
  );
  await authenticatePage(page, nomineeAuth.token);
  for (const viewport of [
    { name: "recipient-desktop", width: 1280, height: 900 },
    { name: "recipient-phone", width: 320, height: 760 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/ownership-transfer?id=${transfer.id}`);
    await expect(page.getByText(/nominated you to become the only Owner/)).toBeVisible();
    await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`organization-ownership-${viewport.name}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Accept ownership" }).click();
  await expect(page.getByText(/prior Owner is now an Administrator/)).toBeVisible();
  const acceptedTeamResponse = await request.get(`/api/v1/organizations/${organizationID}/team`, {
    headers: { Authorization: `Bearer ${nomineeAuth.token}` },
  });
  expect(acceptedTeamResponse.ok()).toBeTruthy();
  const acceptedTeam = await acceptedTeamResponse.json();
  expect(acceptedTeam.members).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ user_id: nominee.id, role: "owner" }),
      expect.objectContaining({ user_id: me.id, role: "admin" }),
    ]),
  );

  const pendingTransfer = (id: string) => ({
    ...transfer,
    id,
    status: "pending",
  });
  await page.route("**/api/v1/organization-ownership-transfers/resolve?**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id") ?? "";
    return route.fulfill({
      contentType: "application/json",
      json: pendingTransfer(id),
    });
  });
  await page.route("**/api/v1/organization-ownership-transfers/decline", async (route) => {
    const requestBody = route.request().postDataJSON() as { id: string };
    return route.fulfill({
      contentType: "application/json",
      json: { ...pendingTransfer(requestBody.id), status: "declined" },
    });
  });
  await navigateWithinApp(page, "/ownership-transfer?id=decline-transfer");
  await expect(page.getByText(/nominated you to become the only Owner/)).toBeVisible();
  await expect(page.getByText(/You are now the Organization Owner/)).toHaveCount(0);
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText(/You declined the nomination/)).toBeVisible();

  await navigateWithinApp(page, "/ownership-transfer?id=replacement-transfer");
  await expect(page.getByText(/nominated you to become the only Owner/)).toBeVisible();
  await expect(page.getByText(/You declined the nomination/)).toHaveCount(0);

  await navigateWithinApp(page, "/ownership-transfer");
  await expect(page.getByText("This ownership-transfer link is incomplete.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept ownership" })).toHaveCount(0);
  await expect(page.getByText(/nominated you to become the only Owner/)).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});
