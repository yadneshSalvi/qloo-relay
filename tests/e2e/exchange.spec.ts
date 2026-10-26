import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../../src/domain/types";

async function workspace(page: Page): Promise<Workspace> {
  return (await (await page.request.get("/api/workspace")).json()).workspace;
}
async function approveHades(page: Page) {
  await page.goto("/offers/item-hades-noah");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hades", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /I’d give this copy/ }).check();
  await page.getByRole("button", { name: "I’d make this trade" }).click();
  await expect(page).toHaveURL(/\/exchanges\/[a-f0-9-]+$/);
  await expect(page.locator(".exchange-status-line")).toContainText("3 people");
}
async function confirmEveryone(page: Page) {
  await page.getByRole("checkbox", { name: /I confirm these exact copies/ }).check();
  await page.getByRole("button", { name: "Confirm my part" }).click();
  await expect(page.getByText("Your yes is in.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try a member’s view" }).click();
  await page.getByRole("button", { name: "Confirm as Maya" }).click();
  await page.getByRole("button", { name: "Confirm as Noah" }).click();
  await expect(page.locator(".exchange-status-line")).toContainText("Reserved for handoff");
}

test("browser story: authored discovery → exact approval → all-party reservation → inspected handoff", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", error => consoleErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".item-card")).toHaveCount(14);
  await page.getByRole("button", { name: "Find your next favorite", exact: true }).click();
  await expect(page.locator(".why-badge").first()).toBeVisible();
  const discovered = await workspace(page);
  expect(discovered.discovery?.source).toBe("authored-sample");
  expect(discovered.discovery?.suggestions.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Books", exact: true }).click();
  await expect(page.locator(".item-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Save Braiding Sweetgrass", exact: true }).click();
  await page.getByRole("button", { name: /^Saved/ }).click();
  await expect(page.locator(".item-card")).toHaveCount(1);
  expect((await workspace(page)).approvals.filter(a => !a.authored)).toHaveLength(0);

  await approveHades(page);
  await page.screenshot({ path: testInfo.outputPath("exchange-proposed-desktop.png"), fullPage: true });
  await confirmEveryone(page);
  const reserved = await workspace(page);
  const proposal = reserved.proposals.find(p => p.status === "reserved")!;
  expect(proposal.legs.every(leg => leg.confirmed)).toBe(true);
  expect(reserved.items.filter(i => i.heldByProposalId === proposal.id)).toHaveLength(3);
  await page.getByRole("link", { name: "Your handoff details" }).click();
  await page.getByRole("button", { name: "Open Jo’s sample desk" }).click();
  for (let i = 0; i < 3; i++) {
    const card = page.locator(".receipt-card").nth(i);
    await card.getByRole("checkbox").check();
    await card.getByRole("button", { name: "Record sample inspection" }).click();
    await expect(card.getByText("Received & accepted", { exact: true })).toBeVisible();
  }
  await expect(page.locator(".handoff-status")).toContainText("Ready to pass on");
  await page.getByRole("checkbox", { name: /I have checked the complete set/ }).check();
  await page.getByRole("button", { name: "Record handoff completion" }).click();
  await expect(page.getByRole("heading", { name: "3 things. 3 new stories." })).toBeVisible();
  const done = await workspace(page);
  expect(done.stats.completedCycles).toBe(1);
  expect(done.items.filter(item => item.state === "exchanged")).toHaveLength(3);
  expect(done.proposals.find(p => p.id === proposal.id)?.receipts.every(receipt => !!receipt.releasedAt)).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "3 things. 3 new stories." })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("handoff-complete-desktop.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
});

test("withdrawal opens the circle; repair creates a fresh two-person proposal", async ({ page }) => {
  await approveHades(page);
  const first = (await workspace(page)).proposals[0];
  await page.getByRole("button", { name: "Try a member’s view" }).click();
  await page.getByRole("button", { name: "Withdraw as Maya" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Withdraw from this exchange" }).click();
  await expect(page.getByText("This circle opened up.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Find another way" }).click();
  await expect(page.locator(".exchange-status-line")).toContainText("2 people");
  await expect(page.locator(".exchange-status-line")).toContainText("A fresh proposal");
  const repaired = (await workspace(page)).proposals.find(p => p.repairOf === first.id)!;
  expect(repaired.id).not.toBe(first.id);
  expect(repaired.legs.every(leg => !leg.confirmed)).toBe(true);
  expect(repaired.legs.map(leg => leg.memberId).sort()).toEqual(["noah", "you"]);
  const stale = await page.request.post("/api/command", { headers: { "Idempotency-Key": crypto.randomUUID(), Origin: new URL(page.url()).origin }, data: { type: "confirm", proposalId: first.id, expectedVersion: first.version, memberId: "you" } });
  expect(stale.status()).toBe(409);
});

test("a rejected copy freezes release until an explicit successful reinspection", async ({ page }) => {
  await approveHades(page);
  await confirmEveryone(page);
  await page.getByRole("link", { name: "Your handoff details" }).click();
  await page.getByRole("button", { name: "Open Jo’s sample desk" }).click();
  const first = page.locator(".receipt-card").first();
  await first.getByRole("button", { name: "Report a mismatch" }).click();
  await page.getByRole("button", { name: "Record mismatch & pause" }).click();
  await expect(page.getByText("Redistribution is paused.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record handoff completion" })).toHaveCount(0);
  await first.getByRole("checkbox").check();
  await first.getByRole("button", { name: "Record reinspection" }).click();
  await expect(first.getByText("Received & accepted", { exact: true })).toBeVisible();
  expect((await workspace(page)).proposals[0].status).toBe("reserved");
});

test("inventory details and preference choices persist; live mode fails without falling back", async ({ page }) => {
  await page.goto("/inventory/new");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Your edition or format").fill("Paperback · English · 2020 edition");
  await page.getByLabel("Anything the next person should know?").fill("A clean reading copy, with one small pencil note.");
  await page.getByRole("checkbox", { name: /I own this copy/ }).check();
  await page.getByRole("button", { name: "Offer this item", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".shelf-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Edit A Wizard of Earthsea", exact: true }).click();
  await page.getByLabel("A truthful condition").selectOption("fair");
  await page.getByRole("button", { name: "Save copy details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const item = (await workspace(page)).items.find(i => i.workId === "work-earthsea" && i.ownerId === "you")!;
  expect(item.condition).toBe("fair");
  expect(item.version).toBe(2);
  await page.goto("/onboarding");
  await page.getByRole("button", { name: /Hades Supergiant Games/ }).click();
  await page.getByRole("slider", { name: /Your curiosity dial/ }).press("End");
  await page.getByRole("button", { name: "Find my next discovery" }).click();
  await expect(page).toHaveURL(/\/discover$/);
  const before = await workspace(page);
  expect(before.preferences.seedWorkIds).toContain("work-hades");
  expect(before.preferences.novelty).toBe(100);
  // Exercise dependency failure without spending provider credit on a live-enabled test server.
  await page.route("**/api/command", async (route) => {
    const action = route.request().postDataJSON();
    if (action.type === "discover" && action.mode === "live") {
      await route.fulfill({ status: 503, json: { error: { code: "MISSING_QLOO_KEY", message: "Injected missing Qloo key: live discovery is unavailable; existing sample results are preserved." } } });
      return;
    }
    await route.continue();
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Check live discovery" }).click();
  await expect(page.locator(".toast.error")).toContainText(/Qloo|key|mapping/i);
  expect((await workspace(page)).discovery?.id).toBe(before.discovery?.id);
});

test("mobile navigation, keyboard search and responsive pages remain usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".item-card")).toHaveCount(14);
  for (const route of ["/", "/inventory", "/exchanges", "/onboarding", "/organizer", "/evidence", "/results", "/how-it-works", "/settings"]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `No horizontal overflow on ${route}`).toBe(true);
  }
  await page.getByRole("button", { name: "Open navigation" }).click();
  const menu = page.getByRole("dialog", { name: "Main navigation" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Close navigation" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await menu.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Your shelf", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.locator(".discovery-hero")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("discovery-mobile.png"), fullPage: true, animations: "disabled" });
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox", { name: "Search books, records, and games" }).fill("Hades");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.reload();
  await expect(page.locator(".item-card")).toHaveCount(14);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("discovery-tablet.png"), fullPage: true });
});
