import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { CatalogSearch } from "../../src/domain/catalog-search";
import type { Workspace, Work } from "../../src/domain/types";

// UI fixtures intercept every catalog/command request. These are not live provider evidence.
test.use({ trace: "off" });

async function fixture(page: Page, options: { record?: boolean; configured?: boolean; failed?: boolean } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const workspace = (await (await page.request.get("/api/workspace")).json()).workspace as Workspace;
  workspace.capabilities.liveQloo = options.configured === false ? "unconfigured" : "ready";
  let search: CatalogSearch | null = null;
  const requests: Record<string, unknown>[] = [];
  const commands: Record<string, unknown>[] = [];
  const entityId = "00000000-0000-4000-8000-000000000101";
  const workId = "work-browser-catalog-fixture";
  await page.route("**/api/workspace", (route) => route.fulfill({ json: { workspace } }));
  await page.route("**/api/catalog**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      if (new URL(request.url()).searchParams.has("searchId") && search) {
        search = options.failed ? { ...search, status: "failed", errorCode: "TEST_PROVIDER_UNAVAILABLE", errorMessage: "Injected catalog provider unavailable; no substitute result was created." } : { ...search, status: "succeeded", cache: "miss", candidates: options.record ? [{ entityId, name: "Joni Mitchell", entityType: "urn:entity:artist", disambiguation: "Canadian singer-songwriter · injected browser fixture", year: null }] : [{ entityId, name: "The Left Hand of Darkness", entityType: "urn:entity:book", disambiguation: "Novel by Ursula K. Le Guin · injected browser fixture", year: 1969, isbn13: "9780441478125" }, { entityId: "00000000-0000-4000-8000-000000000102", name: "The Lathe of Heaven", entityType: "urn:entity:book", disambiguation: "Novel by Ursula K. Le Guin · injected browser fixture", year: 1971 }] };
      }
      await route.fulfill({ json: { search } }); return;
    }
    const action = request.postDataJSON() as Record<string, unknown>;
    requests.push(action);
    if (action.type === "search") {
      search = { id: "00000000-0000-4000-8000-000000000111", query: String(action.query), category: action.category as "book" | "record" | "game", status: "queued", candidates: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), errorCode: null, errorMessage: null, cache: null };
      await route.fulfill({ json: { search } }); return;
    }
    const work: Work = { ...workspace.works[0], id: workId, title: options.record ? String(action.recordTitle) : "The Left Hand of Darkness", author: options.record ? "Joni Mitchell" : "Ursula K. Le Guin", category: options.record ? "record" : "book", year: options.record ? 0 : 1969, mappingStatus: "verified", qlooEntityId: entityId, description: "Injected catalog confirmation fixture; no provider was called.", tags: [], dataOrigin: "participant-recorded" };
    if (!workspace.works.some((entry) => entry.id === work.id)) workspace.works.push(work);
    await route.fulfill({ json: { workspace, workId, notice: "Injected identity confirmed. Your form is still unsaved." } });
  });
  await page.route("**/api/command", async (route) => {
    const action = route.request().postDataJSON() as Record<string, unknown>;
    commands.push(action);
    if (action.type === "preferences") workspace.preferences = { ...workspace.preferences, version: workspace.preferences.version + 1, seedWorkIds: action.seedWorkIds as string[], novelty: Number(action.novelty) };
    if (action.type === "addItem") workspace.items.push({ id: "item-browser-catalog-fixture", workId: String(action.workId), ownerId: workspace.currentMemberId, edition: String(action.edition), condition: action.condition as "good", notes: String(action.notes), attested: true, version: 1, state: "available", heldByProposalId: null, createdAt: new Date().toISOString(), dataOrigin: "authored-sample" });
    await route.fulfill({ json: { workspace, notice: "Injected command saved; no provider was called." } });
  });
  return { workspace, requests, commands, workId };
}

test("explicit catalog search resumes, requires a human choice, and adds a favorite without saving it", async ({ page }) => {
  const app = await fixture(page);
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Find another favorite" }).click();
  await page.getByLabel("Book title or author").fill("The Left Hand of Darkness");
  expect(app.requests).toHaveLength(0);
  await page.getByRole("button", { name: "Search Qloo", exact: true }).click();
  await expect(page.getByText("Your search is saved and waiting to start.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Find another favorite" }).click();
  await expect(page.locator(".catalog-candidate")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Confirm this favorite" })).toHaveCount(0);
  await expect(page.locator(".catalog-candidate").first()).toContainText("Catalog ISBN-13: 9780441478125");
  await page.getByRole("button", { name: /The Left Hand of Darkness Book/ }).click();
  await expect(page.getByText(/YOUR SELECTED IDENTITY/)).toBeVisible();
  await expect(page.getByText(/This does not verify your physical edition/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm this favorite" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /I recognize this book/ }).check();
  await page.getByRole("button", { name: "Confirm this favorite" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".chosen-favorites")).toContainText("The Left Hand of Darkness");
  expect(app.commands).toHaveLength(0);
  expect(app.workspace.preferences.seedWorkIds).not.toContain(app.workId);
  expect(app.requests.filter((request) => request.type === "search")).toHaveLength(1);
  expect(app.requests.find((request) => request.type === "confirm")).toMatchObject({ use: "reference" });
  await page.getByRole("button", { name: "Find my next discovery" }).click();
  await expect.poll(() => app.commands.some((command) => command.type === "preferences")).toBe(true);
  expect(app.commands.find((command) => command.type === "preferences")?.seedWorkIds).toContain(app.workId);
});

test("record listing confirms the artist and user-supplied album title before a separate attested listing", async ({ page }) => {
  const app = await fixture(page, { record: true });
  app.workspace.works.push({ ...app.workspace.works[0], id: "work-artist-reference-fixture", title: "Joni Mitchell", author: "Joni Mitchell", category: "record", year: 0, referenceOnly: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inventory/new");
  await page.getByRole("dialog").getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByLabel("What is it?").getByRole("option", { name: /Joni Mitchell/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Find another title or artist" }).click();
  const search = page.getByRole("dialog", { name: "Find the work behind your copy." });
  await search.getByRole("button", { name: "Artists", exact: true }).click();
  await search.getByLabel("Artist or band name").fill("Joni Mitchell");
  expect(app.requests).toHaveLength(0);
  await search.getByRole("button", { name: "Search Qloo", exact: true }).click();
  await expect(search.locator(".catalog-candidate")).toHaveCount(1);
  await search.getByRole("button", { name: /Joni Mitchell Artist/ }).click();
  await search.getByRole("checkbox", { name: /I recognize this artist/ }).check();
  await expect(search.getByRole("button", { name: "Confirm this work" })).toBeDisabled();
  await search.getByLabel("Your record’s album title").fill("Joni Mitchell");
  await expect(search.getByRole("button", { name: "Confirm this work" })).toBeEnabled();
  await search.getByLabel("Your record’s album title").fill("Blue");
  await expect(search.getByText("The verified Qloo identity is the artist, not the album or pressing.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target) }))).toEqual([]);
  await search.getByRole("button", { name: "Confirm this work" }).click();
  await expect(search).toHaveCount(0);
  await expect(page.locator(".identity-preview")).toContainText("Blue");
  expect(app.commands).toHaveLength(0);
  expect(app.requests.find((request) => request.type === "confirm")).toMatchObject({ use: "inventory", recordTitle: "Blue" });
  await page.getByLabel("Your edition or format").fill("Stereo LP · user-described pressing");
  await page.getByLabel("Anything the next person should know?").fill("Honest condition notes for an injected listing fixture.");
  await page.getByRole("checkbox", { name: /I own this copy/ }).check();
  await page.getByRole("button", { name: "Offer this item", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(app.commands.filter((command) => command.type === "addItem")).toHaveLength(1);
  expect(app.commands[0]).toMatchObject({ workId: app.workId, attested: true });
});

test("unconfigured catalog and failed search stay explicit without substituted candidates", async ({ page }) => {
  const app = await fixture(page, { configured: false, failed: true });
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Find another favorite" }).click();
  await expect(page.getByText("Live catalog lookup isn’t configured here.")).toBeVisible();
  await page.getByLabel("Book title or author").fill("A deliberate failed lookup");
  await expect(page.getByRole("button", { name: "Search Qloo", exact: true })).toBeDisabled();
  expect(app.requests).toHaveLength(0);
  app.workspace.capabilities.liveQloo = "ready";
  await page.reload();
  await page.getByRole("button", { name: "Find another favorite" }).click();
  await page.getByLabel("Book title or author").fill("A deliberate failed lookup");
  await page.getByRole("button", { name: "Search Qloo", exact: true }).click();
  await expect(page.getByText("Injected catalog provider unavailable; no substitute result was created.")).toBeVisible();
  await expect(page.locator(".catalog-candidate")).toHaveCount(0);
  expect(app.requests.filter((request) => request.type === "confirm")).toHaveLength(0);
});

test("category live actions carry their scope and saved reports stop offering unavailable copies", async ({ page }) => {
  const app = await fixture(page);
  const give = app.workspace.items.find((item) => item.id === "item-kind-of-blue-you")!;
  const receive = app.workspace.items.find((item) => item.id === "item-blue-train-eli")!;
  app.workspace.agentRuns = [{ id: "00000000-0000-4000-8000-000000000121", memberId: app.workspace.currentMemberId, status: "succeeded", stage: "ready", category: "record", createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), errorCode: null, errorMessage: null, trace: [], usage: { qlooCalls: 1, cacheHits: 0, modelCalls: 1, inputTokens: 100, outputTokens: 20, unreportedModelCalls: 0 }, report: { headline: "Injected discovery snapshot", summary: "A saved test report. No provider was called.", nextAction: "review-trade", decisions: [{ itemId: receive.id, giveItemId: give.id, evidenceId: "00000000-0000-4000-8000-000000000131", category: "record", categoryRank: 1, possibleCycleSizes: [3], requiresApproval: true, explanation: "A possibility captured in the injected snapshot." }], categoriesChecked: ["record"], warnings: [], model: null, authority: "discovery-only" }, canRetry: false, attempt: 1 }];
  await page.goto("/discover");
  await expect(page.getByText(/Saved discovery snapshot ·/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review exact trade" })).toBeEnabled();
  await page.getByRole("button", { name: "Books", exact: true }).click();
  expect(app.commands).toHaveLength(0);
  await page.getByRole("button", { name: "Discover books with Qloo" }).click();
  await expect.poll(() => app.commands.length).toBe(1);
  expect(app.commands[0]).toMatchObject({ type: "discover", mode: "live", category: "book" });
  give.state = "withdrawn";
  await page.reload();
  await expect(page.getByRole("button", { name: "Copies unavailable" })).toBeDisabled();
  await expect(page.getByText("Current status: one or both copies are no longer available for a new trade.")).toBeVisible();
  await expect(page.getByText(/At the snapshot, a 3-person circle/)).toBeVisible();
});
