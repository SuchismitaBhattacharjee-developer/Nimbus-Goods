import { expect, test, type Frame, type Page } from "@playwright/test";

const EMAIL = "ada@example.com";

async function checkoutFrame(page: Page): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(() => {
      frame = page.frames().find((f) => f.url().includes("/checkout/"));
      return Boolean(frame);
    })
    .toBe(true);
  return frame!;
}

async function openCheckout(page: Page): Promise<Frame> {
  await page.goto("/");
  await page.getByRole("button", { name: /Buy now/ }).click();
  const frame = await checkoutFrame(page);
  await expect(frame.getByLabel("Email")).toBeVisible();
  return frame;
}

async function fillDetails(frame: Frame, card: string, email = EMAIL) {
  await frame.getByLabel("Email").fill(email);
  await frame.getByLabel("Card number").fill("");
  await frame.getByLabel("Card number").pressSequentially(card);
  await frame.getByLabel(/Expiry date/).fill("");
  await frame.getByLabel(/Expiry date/).pressSequentially("1234");
  await frame.getByLabel("Security code").fill("");
  await frame.getByLabel("Security code").pressSequentially("123");
}

const payButton = (frame: Frame) => frame.getByRole("button", { name: /^(Pay|Try again)/ });
const entries = (page: Page, kind: string) => page.locator(`#log .log-${kind}`);

test("4242 succeeds: onSuccess with a sessionId, then onClose(completed), then cleanup", async ({ page }) => {
  const frame = await openCheckout(page);
  await fillDetails(frame, "4242424242424242");
  await expect(frame.getByLabel("Card number")).toHaveValue("4242 4242 4242 4242");
  await expect(frame.getByLabel(/Expiry date/)).toHaveValue("12 / 34");
  await payButton(frame).click();

  await expect(frame.getByText("Payment successful")).toBeVisible();
  await expect(frame.getByText("Visa •••• 4242")).toBeVisible();
  await expect(entries(page, "success")).toHaveCount(1);
  await expect(entries(page, "success")).toContainText(/"sessionId":"cs_test_[A-Za-z0-9]+"/);
  await expect(entries(page, "close")).toHaveCount(0); // success doesn't close for the customer

  await frame.getByRole("button", { name: "Done" }).click();
  await expect(entries(page, "close")).toContainText('"reason":"completed"');
  await expect(page.locator("[data-dodo-checkout]")).toHaveCount(0);
  await expect.poll(() => page.frames().length).toBe(1);
  await expect(page.getByRole("button", { name: /Buy another/ })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  await expect(entries(page, "error")).toHaveCount(0);

  const badges = await page.locator("#log .log-badge").allTextContents();
  expect(badges.filter((b) => b.startsWith("on"))).toEqual(["onSuccess", "onClose"]);
});

test("0002 declines, customer switches to 4242 and pays", async ({ page }) => {
  const frame = await openCheckout(page);
  await fillDetails(frame, "4000000000000002");
  await payButton(frame).click();

  await expect(frame.getByText("Your card was declined.")).toBeVisible();
  await expect(frame.getByText(/haven't been charged/)).toBeVisible();
  await expect(frame.getByLabel("Card number")).toBeFocused();
  await expect(entries(page, "error")).toHaveCount(1);
  await expect(entries(page, "error")).toContainText('"code":"card_declined"');
  await expect(entries(page, "close")).toHaveCount(0); // still open, customer can fix it

  await frame.getByLabel("Card number").fill("");
  await frame.getByLabel("Card number").pressSequentially("4242424242424242");
  await expect(frame.getByText("Your card was declined.")).toHaveCount(0);
  await payButton(frame).click();
  await expect(frame.getByText("Payment successful")).toBeVisible();
  await expect(entries(page, "success")).toHaveCount(1);
  await expect(entries(page, "error")).toHaveCount(1);
});

test("0341 fails once, then succeeds on retry", async ({ page }) => {
  const frame = await openCheckout(page);
  await fillDetails(frame, "4000000000000341");
  await payButton(frame).click();

  await expect(frame.getByText("We couldn't reach your bank.")).toBeVisible();
  await expect(entries(page, "error")).toContainText('"code":"processing_error"');
  const retry = frame.getByRole("button", { name: "Try again · $48.00" });
  await expect(retry).toBeFocused();
  await retry.click();

  await expect(frame.getByText("Payment successful")).toBeVisible();
  await expect(entries(page, "success")).toHaveCount(1);
  await expect(entries(page, "error")).toHaveCount(1);
});

test("validation: calm until submit, then specific messages and focus on the first problem", async ({ page }) => {
  const frame = await openCheckout(page);
  await expect(frame.getByLabel("Email")).toBeFocused();

  // Leaving an empty field doesn't scold.
  await frame.getByLabel("Email").blur();
  await expect(frame.getByText("Enter your email")).toHaveCount(0);

  await payButton(frame).click();
  await expect(frame.getByText("Enter your email so we can send your receipt.")).toBeVisible();
  await expect(frame.getByText("Enter your card number.")).toBeVisible();
  await expect(frame.getByLabel("Email")).toBeFocused();

  await frame.getByLabel("Email").fill("ada@");
  await expect(frame.getByText("That email doesn't look quite right.")).toBeVisible();
  await frame.getByLabel("Email").fill("ada@gmial.com");
  await frame.getByRole("button", { name: "ada@gmail.com" }).click();
  await expect(frame.getByLabel("Email")).toHaveValue("ada@gmail.com");

  await frame.getByLabel("Card number").pressSequentially("4242424242424241");
  await expect(frame.getByText("That card number isn't valid. Check for a typo.")).toBeVisible();
  await frame.getByLabel("Card number").fill("");
  await frame.getByLabel("Card number").pressSequentially("4242424242424242");
  await frame.getByLabel(/Expiry date/).pressSequentially("0120");
  await expect(frame.getByText("This card has expired.")).toBeVisible();

  await expect(entries(page, "error")).toHaveCount(0); // validation never reaches the host
});

test("double-clicking Pay charges once and reports once", async ({ page }) => {
  const frame = await openCheckout(page);
  await fillDetails(frame, "4242424242424242");
  await payButton(frame).dblclick();
  await expect(frame.getByText("Processing…")).toBeVisible();
  await expect(frame.getByRole("button", { name: "Close checkout" })).toBeDisabled();
  await page.keyboard.press("Escape"); // can't close mid-payment
  await expect(frame.getByText("Payment successful")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(entries(page, "success")).toHaveCount(1);
  await expect(entries(page, "close")).toHaveCount(0);
});

test("calling open() twice keeps a single checkout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Click Buy twice/ }).click();
  await expect(page.locator("#log")).toContainText("DodoCheckout.open() returned true");
  await expect(page.locator("#log")).toContainText("DodoCheckout.open() returned false");
  await expect(page.locator("[data-dodo-checkout]")).toHaveCount(1);
  await checkoutFrame(page);
  expect(page.frames().filter((f) => f.url().includes("/checkout/"))).toHaveLength(1);
});

test("Escape dismisses: onClose(dismissed), focus and scroll restored, can reopen", async ({ page }) => {
  const frame = await openCheckout(page);
  await frame.getByLabel("Email").fill("half-typed@");
  await page.keyboard.press("Escape");
  await expect(entries(page, "close")).toContainText('"reason":"dismissed"');
  await expect(page.locator("[data-dodo-checkout]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Buy now/ })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");

  await page.getByRole("button", { name: /Buy now/ }).click();
  await expect(page.locator("[data-dodo-checkout]")).toHaveCount(1);
});

test("keyboard focus stays inside the checkout", async ({ page }) => {
  const frame = await openCheckout(page);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await frame.evaluate(() => document.querySelector(".dialog")!.contains(document.activeElement))).toBe(true);
  }
});

test("unknown product: onError(product_unavailable), then onClose(error)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Unavailable product/ }).click();
  const frame = await checkoutFrame(page);
  await expect(frame.getByText("This item isn't available")).toBeVisible();
  await expect(entries(page, "error")).toContainText('"code":"product_unavailable"');
  await frame.getByRole("button", { name: "Close", exact: true }).click();
  await expect(entries(page, "close")).toContainText('"reason":"error"');
});

test("host close() reports reason host", async ({ page }) => {
  test.setTimeout(20_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Host closes it/ }).click();
  await expect(entries(page, "close")).toContainText('"reason":"host"', { timeout: 10_000 });
  await expect(page.locator("[data-dodo-checkout]")).toHaveCount(0);
});

test("a forged PAYMENT_SUCCESS from the host page is ignored", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Forge a success/ }).click();
  await expect(page.locator("#log")).toContainText("the SDK ignored the forgery", { timeout: 8_000 });
  await expect(entries(page, "success")).toHaveCount(0);
});

test("isolation: host can't reach the checkout, and it runs in an opaque origin", async ({ page }) => {
  const frame = await openCheckout(page);
  expect(await page.evaluate(() => document.querySelector("[data-dodo-checkout]")!.shadowRoot)).toBeNull();
  expect(await page.evaluate(() => document.querySelectorAll("iframe").length)).toBe(0);
  expect(await frame.evaluate(() => window.origin)).toBe("null");
  expect(
    await frame.evaluate(() => {
      try {
        void window.parent.document.body;
        return "reachable";
      } catch {
        return "blocked";
      }
    }),
  ).toBe("blocked");
});

test("card number, CVC and email never reach the host page", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    window.addEventListener("message", (e) => seen.push(JSON.stringify(e.data)), true);
  });
  const frame = await openCheckout(page);
  await fillDetails(frame, "4000000000000002", "secret.person@example.com");
  await payButton(frame).click();
  await expect(entries(page, "error")).toHaveCount(1);
  await fillDetails(frame, "4242424242424242", "secret.person@example.com");
  await payButton(frame).click();
  await expect(entries(page, "success")).toHaveCount(1);

  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen.length).toBeGreaterThan(0);
  const everything = seen.join("\n") + (await page.locator("#log").innerText()) + page.url();
  for (const secret of ["4242424242424242", "4242 4242", "4000000000000002", "secret.person", "12 / 34"]) {
    expect(everything).not.toContain(secret);
  }
  // The iframe URL carries only product, channel and host origin.
  const url = new URL(frame.url());
  expect([...new URLSearchParams(url.hash.slice(1)).keys()].sort()).toEqual(["channel", "origin", "product"]);
});

test("offline: load failure reported, customer can back out", async ({ page, context }) => {
  await page.goto("/");
  await context.setOffline(true);
  await page.getByRole("button", { name: /Buy now/ }).click();
  await expect(entries(page, "error")).toContainText('"code":"checkout_load_failed"');
  await page.keyboard.press("Escape");
  await expect(entries(page, "close")).toContainText('"reason":"error"');
  await context.setOffline(false);
});

test("checkout that never becomes ready times out, and Try again recovers", async ({ page }) => {
  test.setTimeout(30_000);
  await page.route("**/checkout/**", (route) => route.fulfill({ status: 503, body: "down" }));
  await page.goto("/");
  await page.getByRole("button", { name: /Buy now/ }).click();
  await expect(entries(page, "error")).toContainText('"code":"checkout_load_failed"', { timeout: 12_000 });

  await page.unroute("**/checkout/**");
  await page.keyboard.press("Enter"); // "Try again" has focus
  const frame = await checkoutFrame(page);
  await expect(frame.getByLabel("Email")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(entries(page, "close")).toContainText('"reason":"dismissed"');
});

test("opening /checkout directly explains itself instead of showing a card form", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page.getByText("This page opens inside a store")).toBeVisible();
  await expect(page.getByLabel("Card number")).toHaveCount(0);
});

test("@mobile checkout works as a bottom sheet on a phone", async ({ page }) => {
  const frame = await openCheckout(page);
  const box = await frame.locator(".dialog").boundingBox();
  const viewport = page.viewportSize()!;
  expect(Math.round(box!.width)).toBe(viewport.width);
  await expect.poll(async () => Math.round((await frame.locator(".dialog").boundingBox())!.y + (await frame.locator(".dialog").boundingBox())!.height)).toBe(viewport.height);
  await fillDetails(frame, "4242424242424242");
  await payButton(frame).click();
  await expect(frame.getByText("Payment successful")).toBeVisible();
});
