import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Workspace } from "../../src/domain/types";

async function check(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
}

test("main pages, exact offer and mobile navigation have no automated WCAG A/AA violations", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["/", "/inventory", "/onboarding", "/exchanges", "/organizer", "/evidence", "/results", "/how-it-works", "/settings"]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await check(page);
  }
  await page.goto("/offers/item-hades-noah");
  await expect(page.getByRole("dialog")).toBeVisible();
  await check(page);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await check(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeVisible();
  await check(page);
});

test("proposal, reservation and coordinator inspection remain accessible", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/offers/item-hades-noah");
  await page.getByRole("checkbox", { name: /I’d give this copy/ }).check();
  await page.getByRole("button", { name: "I’d make this trade" }).click();
  await expect(page).toHaveURL(/\/exchanges\/[a-f0-9-]+$/);
  await check(page);
  const workspace: Workspace = (await (await page.request.get("/api/workspace")).json()).workspace;
  const proposal = workspace.proposals[0];
  for (const leg of proposal.legs) {
    const response = await page.request.post("/api/command", { headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": crypto.randomUUID() }, data: { type: "confirm", proposalId: proposal.id, expectedVersion: proposal.version, memberId: leg.memberId } });
    expect(response.status()).toBe(200);
  }
  await page.reload();
  await expect(page.locator(".exchange-status-line")).toContainText("Reserved for handoff");
  await check(page);
  await page.getByRole("link", { name: "Your handoff details" }).click();
  await page.getByRole("button", { name: "Open Jo’s sample desk" }).click();
  await check(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await check(page);
});
