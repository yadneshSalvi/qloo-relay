import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Workspace } from "../../src/domain/types";

// An invitation is a bearer capability. Keep its entry out of saved browser traces.
test.use({ trace: "off" });

async function state(page: Page): Promise<Workspace> { return (await (await page.request.get("/api/workspace")).json()).workspace; }
async function act(page: Page, value: unknown) { return page.request.post("/api/command", { headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": crypto.randomUUID() }, data: value }); }

async function createCommunity(page: Page) {
  await page.goto("/community");
  await page.getByRole("button", { name: "Create a private community", exact: true }).click();
  await page.getByLabel("Community name", { exact: true }).fill("E2E Saturday Shelf");
  await page.getByLabel("Your coordinator display name").fill("E2E coordinator");
  await page.getByLabel("Shared handoff location").fill("Test library foyer · exchange desk");
  await page.getByLabel("Handoff date and time").fill("31 October 2026, 5–7 pm IST");
  await page.getByRole("checkbox", { name: /I will share invitations privately/ }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Create community", exact: true }).click();
  await expect(page.getByRole("heading", { name: "E2E Saturday Shelf", exact: true })).toBeVisible();
  expect((await state(page)).items).toHaveLength(0);
  expect((await state(page)).approvals).toHaveLength(0);
}

async function invitation(page: Page, label: string) {
  await page.getByLabel("A label for your records").fill(label);
  await page.getByRole("button", { name: "Create one-use invitation" }).click();
  const link = await page.getByLabel("Share this link privately").inputValue();
  const code = new URLSearchParams(new URL(link).hash.slice(1)).get("invite")!;
  // No screenshots or saved browser history retain the raw one-use capability.
  await page.getByRole("button", { name: "Hide invitation code" }).click();
  return code;
}

async function join(browser: Browser, baseURL: string, code: string, name: string) {
  const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`/community#invite=${code}`);
  await expect.poll(async () => (await page.getByLabel("Your invitation code").inputValue()) === code).toBe(true);
  await page.getByLabel("What should your community call you?").fill(name);
  await page.getByRole("checkbox", { name: /I understand the community visibility/ }).check();
  await page.getByRole("button", { name: "Join with my own session" }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  expect((await context.cookies()).find((cookie) => cookie.name === "relay_private")?.httpOnly).toBe(true);
  return { context, page };
}

async function list(page: Page, workId: string, category: "Book" | "Record" | "Game" = "Book") {
  await page.goto("/inventory/new");
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: category, exact: true }).click();
  await page.getByLabel("What is it?").selectOption(workId);
  await page.getByLabel("Your edition or format").fill(category === "Game" ? "Nintendo Switch · physical cartridge" : "Paperback · English · test copy");
  await page.getByLabel("Anything the next person should know?").fill("A guest-attested copy for an isolated browser test.");
  await page.getByRole("checkbox", { name: /I own this copy/ }).check();
  await page.getByRole("button", { name: "Offer this item", exact: true }).click();
  await expect(modal).toHaveCount(0);
  const current = await state(page);
  return current.items.find((item) => item.ownerId === current.currentMemberId)!;
}

async function approve(page: Page, itemId: string) {
  await page.goto(`/offers/${itemId}`);
  await page.getByRole("checkbox", { name: /I’d give this copy/ }).check();
  await page.getByRole("button", { name: "I’d make this trade" }).click();
  await expect.poll(async () => { const current = await state(page); return current.approvals.filter((approval) => approval.memberId === current.currentMemberId).length; }).toBe(1);
}

test("three independently scoped browser participants approve, confirm, and complete through a separate coordinator", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const contexts: BrowserContext[] = [];
  const origin = baseURL ?? "http://127.0.0.1:3101";
  const coordinatorContext = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" });
  contexts.push(coordinatorContext);
  const coordinator = await coordinatorContext.newPage();
  const errors: string[] = [];
  coordinator.on("pageerror", (error) => errors.push(error.message));
  try {
    await createCommunity(coordinator);
    const aliceInvite = await invitation(coordinator, "E2E Alice invitation");
    const bobInvite = await invitation(coordinator, "E2E Bob invitation");
    const caraInvite = await invitation(coordinator, "E2E Cara invitation");
    const alice = await join(browser, origin, aliceInvite, "E2E Alice"); contexts.push(alice.context);
    const bob = await join(browser, origin, bobInvite, "E2E Bob"); contexts.push(bob.context);
    const cara = await join(browser, origin, caraInvite, "E2E Cara"); contexts.push(cara.context);
    for (const participant of [alice, bob, cara]) participant.page.on("pageerror", (error) => errors.push(error.message));
    const [aw, bw, cw, organizer] = await Promise.all([state(alice.page), state(bob.page), state(cara.page), state(coordinator)]);
    expect(new Set([aw.currentMemberId, bw.currentMemberId, cw.currentMemberId, organizer.currentMemberId]).size).toBe(4);
    expect(new Set([aw.session.id, bw.session.id, cw.session.id, organizer.session.id]).size).toBe(1);
    const a = await list(alice.page, "work-creative-act");
    const b = await list(bob.page, "work-dispossessed");
    const c = await list(cara.page, "work-hades", "Game");
    await approve(alice.page, c.id);
    await approve(bob.page, a.id);
    await approve(cara.page, b.id);
    const proposed = (await state(cara.page)).proposals[0];
    expect(proposed.legs).toHaveLength(3);
    expect(proposed.legs.every((leg) => !leg.confirmed)).toBe(true);
    const impersonation = await act(alice.page, { type: "confirm", proposalId: proposed.id, memberId: bw.currentMemberId, expectedVersion: 1 });
    expect(impersonation.status()).toBe(403);
    for (const participant of [alice, bob, cara]) {
      await participant.page.goto(`/exchanges/${proposed.id}`);
      await expect(participant.page.getByRole("button", { name: "Try a member’s view" })).toHaveCount(0);
      await participant.page.getByRole("checkbox", { name: /I confirm these exact copies/ }).check();
      await participant.page.getByRole("button", { name: "Confirm my part" }).click();
      await expect.poll(async () => { const w = await state(participant.page); return w.proposals[0].legs.find((leg) => leg.memberId === w.currentMemberId)?.confirmed; }).toBe(true);
    }
    expect((await state(alice.page)).proposals[0].status).toBe("reserved");
    await alice.page.goto(`/handoff/${proposed.id}`);
    await expect(alice.page.getByRole("button", { name: "Record inspection", exact: true })).toHaveCount(0);
    await expect(alice.page.getByRole("button", { name: "Record handoff completion" })).toHaveCount(0);
    const forgedReceipt = await act(alice.page, { type: "receive", proposalId: proposed.id, itemId: a.id, conditionAccepted: true });
    expect(forgedReceipt.status()).toBe(403);
    await coordinator.goto(`/handoff/${proposed.id}`);
    await expect(coordinator.getByRole("button", { name: "Open Jo’s sample desk" })).toHaveCount(0);
    await expect(coordinator.locator(".receipt-card")).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      const card = coordinator.locator(".receipt-card").nth(index);
      await card.getByRole("checkbox").check();
      await card.getByRole("button", { name: "Record inspection", exact: true }).click();
      await expect(card.getByText("Received & accepted", { exact: true })).toBeVisible();
    }
    await coordinator.getByRole("checkbox", { name: /I have checked the complete set/ }).check();
    await coordinator.getByRole("button", { name: "Record handoff completion" }).click();
    await expect(coordinator.getByRole("heading", { name: "3 things. 3 new stories." })).toBeVisible();
    await expect(coordinator.getByText(/Coordinator-attested handoff ·/)).toBeVisible();
    const completed = await state(alice.page);
    expect(completed.proposals[0].status).toBe("completed");
    expect(completed.proposals[0].receipts.every((receipt) => receipt.inspectorId === organizer.currentMemberId && !!receipt.releasedAt)).toBe(true);
    await alice.page.goto("/exchanges");
    await expect(alice.page.locator(".completed-action")).toContainText("The coordinator recorded release");
    await alice.page.screenshot({ path: testInfo.outputPath("private-exchange-desktop.png"), fullPage: true });
    await alice.page.setViewportSize({ width: 390, height: 844 });
    await alice.page.goto("/community");
    await expect(alice.page.getByRole("heading", { name: "E2E Saturday Shelf", exact: true })).toBeVisible();
    expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const accessibility = await new AxeBuilder({ page: alice.page }).analyze();
    expect(accessibility.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))).toEqual([]);
    await alice.page.screenshot({ path: testInfo.outputPath("private-community-mobile.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});

test("private community entry stays usable on a small screen and exposes honest access limits", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/community");
  await expect(page.getByRole("heading", { name: "Join your community." })).toBeVisible();
  await expect(page.getByText(/no email verification, cross-device account, or account recovery/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))).toEqual([]);
});
