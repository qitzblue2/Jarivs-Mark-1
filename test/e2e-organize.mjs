/**
 * Organising chats, in a real browser: date sections, tags, search operators,
 * archive, duplicate, branch, per-chat instructions, trash, restore-from-backup.
 * Same setup as test/e2e.mjs (mock provider + a server pointed at it).
 *
 * Seeds its own chats and removes every one it made, including from the trash.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const json = (path, init) => fetch(`${BASE}${path}`, init).then((r) => r.json());
const send = (path, method, body) =>
  fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const made = [];
async function seed(title, userText) {
  const { chat } = await (await send("/api/chats", "POST", { title })).json();
  made.push(chat.id);
  await send(`/api/chats/${chat.id}`, "PATCH", {
    messages: [
      { id: `${chat.id}-1`, role: "user", content: userText, createdAt: Date.now() },
      { id: `${chat.id}-2`, role: "assistant", content: `Re: ${userText}`, createdAt: Date.now() },
    ],
  });
  return chat.id;
}

const alpha = await seed(`Alpha plan ${RUN}`, "let us plan alpha");
const beta = await seed(`Beta notes ${RUN}`, "notes about beta");
const gamma = await seed(`Gamma ideas ${RUN}`, "ideas for gamma");

// An old chat, written straight to disk: the API stamps "now" on anything it saves.
const oldId = `old-${RUN}`;
// Where the server keeps its chats: the same JARVIS_DATA_DIR it was started with, if any.
const CHATS = `${process.env.JARVIS_DATA_DIR ?? "data"}/chats`;
mkdirSync(CHATS, { recursive: true });
const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
writeFileSync(
  `${CHATS}/${oldId}.json`,
  JSON.stringify({
    id: oldId, title: `Old chat ${RUN}`, createdAt: threeDaysAgo, updatedAt: threeDaysAgo,
    messages: [{ id: "o1", role: "user", content: "from a few days ago", createdAt: threeDaysAgo }],
  }),
);
made.push(oldId);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
// The test uploads a junk file on purpose, and the server rightly answers 400;
// the browser logs any failed request as a console error. That one is expected
// during that one step and nowhere else.
let expectBadRequest = false;
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  if (expectBadRequest && /400 \(Bad Request\)/.test(m.text())) return;
  errors.push(`console: ${m.text()}`);
});
page.on("dialog", (d) => d.accept());

// Exact title, not "contains": a copy is titled "<original> (copy)" and sorts first.
const row = (title) => page.locator("[data-chat-row]").filter({ has: page.getByText(title, { exact: true }) }).first();
const menuOf = async (title) => {
  await row(title).hover();
  await row(title).locator('button[title="More"]').click();
  return page.locator("[data-chat-menu]");
};

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await row(`Alpha plan ${RUN}`).waitFor({ timeout: 10000 });

  // --- 8: date sections ---
  const todaySection = page.locator('[data-chat-section="Today"]');
  check("recent chats sit under Today", (await todaySection.getByText(`Alpha plan ${RUN}`, { exact: true }).count()) === 1);
  const weekSection = page.locator('[data-chat-section="Previous 7 days"]');
  check("one from three days ago sits under Previous 7 days", (await weekSection.getByText(`Old chat ${RUN}`, { exact: true }).count()) === 1);
  await page.screenshot({ path: `${OUT}/organize-sections.png` });

  // --- 9: tags ---
  let menu = await menuOf(`Alpha plan ${RUN}`);
  await menu.getByLabel("Add a tag").fill("Work, big picture");
  await page.keyboard.press("Enter");
  await menu.getByText("work", { exact: true }).waitFor({ timeout: 3000 });
  check("tags are cleaned as they're added", (await menu.getByText("big-picture", { exact: true }).count()) === 1);
  await page.keyboard.press("Escape");
  const chip = page.locator('[data-tag-filter] button', { hasText: "#work" });
  await chip.waitFor({ timeout: 5000 });
  check("a tag filter chip appears with its count", /1/.test(await chip.innerText()));
  check("and the tag shows on the chat's row", (await row(`Alpha plan ${RUN}`).innerText()).includes("#work"));
  await chip.click();
  check("clicking it searches tag:work", (await page.locator("input[data-chat-search]").inputValue()) === "tag:work");
  await page.waitForTimeout(500);
  const shown = await page.locator("[data-chat-row]").count();
  check("only the tagged chat is listed", shown === 1 && (await row(`Alpha plan ${RUN}`).count()) === 1, `${shown} rows`);
  await chip.click();
  check("clicking again clears it", (await page.locator("input[data-chat-search]").inputValue()) === "");

  // --- 17: operators ---
  await row(`Beta notes ${RUN}`).hover();
  await row(`Beta notes ${RUN}`).locator('button[title="Pin to top"]').click();
  await page.locator('[data-chat-section="Pinned"]').waitFor({ timeout: 5000 });
  await page.locator("input[data-chat-search]").fill("is:pinned");
  await page.waitForTimeout(600);
  check("is:pinned lists only pinned chats", (await row(`Beta notes ${RUN}`).count()) === 1 && (await row(`Alpha plan ${RUN}`).count()) === 0);
  await page.locator("input[data-chat-search]").fill("tag:work alpha");
  await page.waitForTimeout(600);
  check("operators and words combine", (await row(`Alpha plan ${RUN}`).count()) === 1);
  await page.locator("input[data-chat-search]").fill("");

  // --- 10: archive ---
  menu = await menuOf(`Gamma ideas ${RUN}`);
  await menu.getByRole("menuitem", { name: "Archive" }).click();
  await page.waitForFunction((t) => ![...document.querySelectorAll("[data-chat-row]")].some((r) => r.textContent.includes(t)), `Gamma ideas ${RUN}`, { timeout: 5000 });
  check("an archived chat leaves the main list", true);
  const archivedToggle = page.getByRole("button", { name: /Archived \(\d+\)/ });
  await archivedToggle.click();
  check("and waits under Archived", (await page.locator("[data-archived-list]").getByText(`Gamma ideas ${RUN}`).count()) === 1);
  await page.locator("input[data-chat-search]").fill("gamma");
  await page.waitForTimeout(600);
  check("a plain search doesn't surface archived chats", (await row(`Gamma ideas ${RUN}`).count()) === 0);
  await page.locator("input[data-chat-search]").fill("is:archived");
  await page.waitForTimeout(600);
  check("is:archived does", (await row(`Gamma ideas ${RUN}`).count()) === 1);
  await page.locator("input[data-chat-search]").fill("");
  menu = await menuOf(`Gamma ideas ${RUN}`);
  await menu.getByRole("menuitem", { name: "Unarchive" }).click();
  await page.waitForTimeout(600);
  check("unarchiving brings it back", (await page.locator('[data-chat-section="Today"]').getByText(`Gamma ideas ${RUN}`, { exact: true }).count()) === 1);

  // --- 13: duplicate ---
  menu = await menuOf(`Alpha plan ${RUN}`);
  await menu.getByRole("menuitem", { name: "Duplicate" }).click();
  await page.getByRole("heading", { name: new RegExp(`Alpha plan ${RUN} \\(copy\\)`) }).waitFor({ timeout: 10000 });
  check("duplicating opens the copy", true);
  check("which says it is one", (await page.locator("h1").innerText()).includes("copy"));
  const list1 = await json("/api/chats");
  const copy = list1.chats.find((c) => c.title === `Alpha plan ${RUN} (copy)`);
  made.push(copy.id);
  check("with every message", copy.messageCount === 2);
  check("and the tags", JSON.stringify(copy.tags) === JSON.stringify(["work", "big-picture"]));

  // --- 12: branch ---
  await row(`Alpha plan ${RUN}`).click({ position: { x: 20, y: 10 } });
  await page.getByText(`Re: let us plan alpha`).first().waitFor({ timeout: 10000 });
  const firstMessage = page.locator("div.group", { hasText: "let us plan alpha" }).first();
  await firstMessage.hover();
  await firstMessage.getByRole("button", { name: "Branch" }).click();
  await page.waitForFunction((t) => document.querySelector("h1")?.textContent?.includes(t), `(branch)`, { timeout: 10000 });
  const list2 = await json("/api/chats");
  const branch = list2.chats.find((c) => c.title === `Alpha plan ${RUN} (branch)`);
  made.push(branch.id);
  check("branching opens a new chat from that message", Boolean(branch));
  check("which holds only the conversation up to it", branch.messageCount === 1, `${branch.messageCount} message(s)`);
  const original = await json(`/api/chats/${alpha}`);
  check("and leaves the original whole", original.chat.messages.length === 2);
  check("the branch records where it came from", (await json(`/api/chats/${branch.id}`)).chat.branchedFrom?.messageId === `${alpha}-1`);

  // --- 14: per-chat instructions ---
  await row(`Beta notes ${RUN}`).click({ position: { x: 20, y: 10 } });
  await page.getByText("Re: notes about beta").first().waitFor({ timeout: 10000 });
  await page.locator("[data-chat-instructions]").click();
  const dialog = page.locator('[role="dialog"][aria-label="Chat instructions"]');
  await dialog.getByLabel("Instructions for this chat").fill("Always answer in pirate speak.");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(500);
  check("the header shows the chat has its own instructions", (await page.locator("[data-chat-instructions]").getAttribute("title")).includes("its own instructions"));
  await page.locator("textarea").first().fill("hello there");
  await page.keyboard.press("Enter");
  await page.getByText("Arr, matey").waitFor({ timeout: 20000 });
  check("and the model was given them instead of the Settings ones", true);
  const stored = await json(`/api/chats/${beta}`);
  check("they are saved with the chat", stored.chat.persona === "Always answer in pirate speak.");
  // A chat without its own instructions is unaffected.
  await row(`Gamma ideas ${RUN}`).click({ position: { x: 20, y: 10 } });
  await page.getByText("Re: ideas for gamma").first().waitFor({ timeout: 10000 });
  await page.locator("textarea").first().fill("hello there");
  await page.keyboard.press("Enter");
  await page.getByText("runs standalone").first().waitFor({ timeout: 20000 });
  check("another chat still uses the Settings instructions", (await page.getByText("Arr, matey").count()) === 0);

  // --- 16: JSON export ---
  const exported = await json(`/api/chats/${alpha}/export?format=json`);
  check("a chat exports as JSON, labelled", exported.format === "jarvis-chat" && exported.chat.id === alpha);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      const m = await menuOf(`Alpha plan ${RUN}`);
      await m.getByRole("menuitem", { name: "Export as JSON" }).click();
    })(),
  ]);
  check("the menu offers it as a download", /\.json$/.test(download.suggestedFilename()), download.suggestedFilename());

  // --- 11: trash ---
  const victim = row(`Old chat ${RUN}`);
  await victim.hover();
  await victim.locator('button[title="Move to trash"]').click();
  await victim.locator('button[title="Move to trash"]').first().click();
  await page.waitForFunction((t) => ![...document.querySelectorAll("[data-chat-row]")].some((r) => r.textContent.includes(t)), `Old chat ${RUN}`, { timeout: 5000 });
  check("deleting removes it from the list", true);
  check("and says where it went", (await page.getByText("Moved to the trash").count()) > 0);
  await page.getByRole("button", { name: /Trash/ }).last().click();
  const trash = page.locator('[role="dialog"][aria-label="Trash"]');
  await trash.locator("[data-trash-list]").getByText(`Old chat ${RUN}`).waitFor({ timeout: 5000 });
  check("it is in the trash", true);
  await page.screenshot({ path: `${OUT}/organize-trash.png` });
  await trash.locator("li", { hasText: `Old chat ${RUN}` }).getByRole("button", { name: /Restore/ }).click();
  await page.waitForTimeout(600);
  check("restoring puts it back, whole", (await json(`/api/chats/${oldId}`)).chat.messages[0].content === "from a few days ago");
  await page.keyboard.press("Escape");
  check("and it is in the list again", (await row(`Old chat ${RUN}`).count()) === 1);

  // --- 15: restore from a backup ---
  const keepId = await seed(`Restore me ${RUN}`, "this one will be lost and recovered");
  const zip = Buffer.from(await (await fetch(`${BASE}/api/backup`)).arrayBuffer());
  await send(`/api/chats/${keepId}`, "DELETE");
  await fetch(`${BASE}/api/trash?id=${keepId}`, { method: "DELETE" });
  check("(the chat is gone for good)", (await fetch(`${BASE}/api/chats/${keepId}`)).status === 404);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("input[data-restore-file]").setInputFiles({ name: "backup.zip", mimeType: "application/zip", buffer: zip });
  await page.getByText(/Restored 1 chat/).waitFor({ timeout: 15000 });
  check("restoring a backup brings back what was lost", true);
  check("and says what was already here and left alone", /already here, left alone/.test(await page.locator("body").innerText()));
  check("the chat is back, complete", (await json(`/api/chats/${keepId}`)).chat.messages.length === 2);
  await page.screenshot({ path: `${OUT}/organize-restore.png` });
  expectBadRequest = true;
  await page.locator("input[data-restore-file]").setInputFiles({ name: "junk.zip", mimeType: "application/zip", buffer: Buffer.from("this is not a zip file at all, not even close") });
  await page.getByText(/isn't a zip/).waitFor({ timeout: 10000 });
  check("a file that isn't a zip is refused, with a reason", true);
  expectBadRequest = false;
  const wrongType = await fetch(`${BASE}/api/backup/restore`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
  check("a cross-site style request (wrong content type) is refused", wrongType.status === 415, String(wrongType.status));

  // --- phone ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal overflow at 390px", overflow === 0, `${overflow}px`);
} finally {
  // Everything this run created, from the list and from the trash.
  for (const id of made) {
    await send(`/api/chats/${id}`, "DELETE").catch(() => {});
    await fetch(`${BASE}/api/trash?id=${id}`, { method: "DELETE" }).catch(() => {});
  }
}

check("no console or page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
