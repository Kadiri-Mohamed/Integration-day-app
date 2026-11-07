import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/staff/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff(?:\?|$)/);
}

test("public visitor can open the event homepage and staff sign-in remains separate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /find your people/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /explore teams/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /staff sign in/i })).toHaveAttribute("href", "/staff/sign-in");
});

test("public overview API does not return credentials or unrevealed clue fields", async ({ request }) => {
  const response = await request.get("/api/public/overview");
  if (response.status() === 503) test.skip(true, "Public event API requires a configured disposable MongoDB database.");
  expect(response.ok()).toBeTruthy();
  const body = await response.text();
  expect(body).not.toMatch(/passwordHash|password|unrevealedClue|clueTemplateId/i);
});

test("SUPER_ADMIN can sign in, open reporting, and access super-admin operations", async ({ page }) => {
  const { E2E_SUPER_ADMIN_EMAIL: email, E2E_SUPER_ADMIN_PASSWORD: password } = process.env;
  test.skip(!email || !password, "Configure dedicated SUPER_ADMIN E2E credentials against a disposable database.");
  await signIn(page, email!, password!);
  await page.goto("/staff/admin");
  await expect(page.getByRole("heading", { name: /event monitoring/i })).toBeVisible();
  expect((await page.request.get("/api/admin/reports?type=overview")).status()).toBe(200);
  expect((await page.request.get("/api/admin/data/staff")).status()).toBe(200);
});

test("ADMIN can use operational reports but cannot access super-admin staff APIs", async ({ page }) => {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_PASSWORD: password } = process.env;
  test.skip(!email || !password, "Configure dedicated ADMIN E2E credentials against a disposable database.");
  await signIn(page, email!, password!);
  await page.goto("/staff/admin/reports");
  await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible();
  expect((await page.request.get("/api/admin/reports?type=participants")).status()).toBe(200);
  expect((await page.request.get("/api/admin/data/staff")).status()).toBe(403);
});

test("GAME_MASTER can open assigned station workspace but cannot access admin reporting", async ({ page }) => {
  const { E2E_GAME_MASTER_EMAIL: email, E2E_GAME_MASTER_PASSWORD: password } = process.env;
  test.skip(!email || !password, "Configure a dedicated assigned GAME_MASTER E2E account and station fixture.");
  await signIn(page, email!, password!);
  await expect(page.getByRole("heading", { name: /station|matches|staff/i }).first()).toBeVisible();
  expect((await page.request.get("/api/admin/reports?type=overview")).status()).toBe(403);
});
