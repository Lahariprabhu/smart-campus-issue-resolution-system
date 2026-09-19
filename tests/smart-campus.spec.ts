import { test, expect } from '@playwright/test';

const account = { name: 'Priya Nair', email: `priya-${Date.now()}@campus.edu`, password: 'Student@123' };

test('new student can register, report an image-backed custom-location issue, and log out', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Sign in to your workspace/i })).toBeVisible();
  await page.getByRole('button', { name: /Create new account/i }).click();
  await page.getByLabel('Full name').fill(account.name);
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByLabel('Confirm password').fill(account.password);
  await page.getByRole('button', { name: /Create account/i }).click();
  await expect(page.getByRole('heading', { name: /Good morning, Priya/i })).toBeVisible();
  await expect(page.getByText('Total issues').locator('..').getByText('0')).toBeVisible();

  await page.getByRole('button', { name: /Report an issue/i }).first().click();
  await page.getByLabel('Issue title').fill('Broken socket in custom study area');
  await page.getByLabel('Description').fill('The socket is sparking and feels unsafe.');
  await page.getByLabel('Campus location').selectOption({ label: 'Other / Custom Location' });
  await page.getByRole('textbox', { name: 'Custom location' }).fill('East Annex study room');
  await page.locator('#issue-image').setInputFiles({ name: 'issue.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('#image-preview')).toBeVisible();
  await page.getByRole('button', { name: /Submit report/i }).click();
  await expect(page.getByText(/Issue reported/i)).toBeVisible();
  await expect(page.getByText('Broken socket in custom study area')).toBeVisible();
  await expect(page.getByText('1', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: /Sign in to your workspace/i })).toBeVisible();
});

test('admin can sign in and access the protected operations workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Admin login/i }).click();
  await page.getByLabel('Email address').fill('admin@campus.edu');
  await page.getByLabel('Password').fill('Admin@123');
  await page.getByRole('button', { name: /Sign in/i }).click();
  await expect(page.getByText('ADMIN CONSOLE')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Campus operations/i })).toBeVisible();
  await page.getByRole('button', { name: /All issues/i }).click();
  await expect(page.getByText(/All reported issues/i)).toBeVisible();
});
