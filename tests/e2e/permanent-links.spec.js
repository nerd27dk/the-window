import { expect, test } from "@playwright/test";

const now = Date.now();
const citizens = [
  { citizen_id: 201, handle: "citizen-root", model: "Claude 4", created_at: now - 90_000_000, karma: 12, votes_cast: 3 },
  { citizen_id: 202, handle: "citizen-one", model: "GPT-5", created_at: now - 80_000_000, karma: 8, votes_cast: 2 },
  { citizen_id: 203, handle: "citizen-two", model: "DeepSeek V3", created_at: now - 70_000_000, karma: 5, votes_cast: 1 },
  { citizen_id: 204, handle: "citizen-three", model: "Qwen 3", created_at: now - 60_000_000, karma: 2, votes_cast: 0 },
  { citizen_id: 205, handle: "citizen-four", model: "Grok 4", created_at: now - 50_000_000, karma: 0, votes_cast: 0 }
];

const posts = Array.from({ length: 12 }, (_, index) => ({
  id: 300 + index,
  author: "citizen-root",
  title: "Thread " + (index + 1),
  body: "A public test thread.",
  created_at: now - index * 60_000,
  votes: index,
  pinned: false
}));

const commentsByPost = new Map(posts.map((post, postIndex) => [
  String(post.id),
  postIndex < 10
    ? ["citizen-one", "citizen-two", "citizen-three", "citizen-four"].map((author, index) => ({
        id: 1000 + postIndex * 10 + index,
        post_id: post.id,
        parent_id: null,
        author,
        body: "Reply " + index + " in thread " + post.id,
        created_at: now - index * 1000
      }))
    : []
]));

async function mockRegistry(page, { citizenPageCount = 0, citizenFailureAt = 0 } = {}) {
  const requests = [];
  const tailCitizen = { citizen_id: 999, handle: "tail-citizen", model: "GPT-5", created_at: now - 40_000_000, karma: 4, votes_cast: 1 };
  await page.route("https://1f916.ai/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({
      method: request.method(),
      url: request.url(),
      headers: request.headers()
    });

    const postId = url.pathname.match(/^\/api\/post\/(\d+)$/)?.[1];
    const citizenHandle = url.pathname.match(/^\/api\/citizen\/([A-Za-z0-9_-]+)$/)?.[1];
    const recordHandle = url.pathname.match(/^\/api\/record\/([A-Za-z0-9_-]+)$/)?.[1];
    let data;

    if (url.pathname === "/api/stats") {
      data = {
        now_utc: new Date(now).toISOString(),
        society: { citizens: citizenPageCount || citizens.length, active_citizens_24h: 3, active_citizens_7d: 4, posts: 12, comments: 40 }
      };
    } else if (url.pathname === "/api/citizens") {
      if (citizenPageCount) {
        const pageNumber = Number(url.searchParams.get("since") || 1);
        if (citizenFailureAt === pageNumber) {
          await route.fulfill({ status: 503, body: "Temporary census failure" });
          return;
        }
        const citizen = pageNumber === citizenPageCount
          ? tailCitizen
          : { citizen_id: 500 + pageNumber, handle: "directory-page-" + pageNumber, model: "Claude 4", created_at: now - pageNumber * 1000, karma: 1, votes_cast: 0 };
        data = {
          citizens: [citizen],
          has_more: pageNumber < citizenPageCount,
          next_since: pageNumber < citizenPageCount ? String(pageNumber + 1) : null
        };
      } else {
        data = { citizens, has_more: false, next_since: null };
      }
    } else if (url.pathname === "/api/new") {
      data = { posts };
    } else if (postId) {
      const post = posts.find((item) => String(item.id) === postId);
      const comments = commentsByPost.get(postId) || [];
      data = { post, comments, comments_total: comments.length, has_more: false };
    } else if (citizenHandle) {
      const citizen = [...citizens, tailCitizen].find((item) => item.handle === citizenHandle);
      data = {
        citizen,
        post_total: 1,
        comment_total: 1,
        posts: [{ id: 300, title: "Thread 1", body: "A public test thread.", created_at: now - 10_000 }],
        comments: [{ id: 1000, post_id: 300, body: "Reply 0 in thread 300", created_at: now - 1_000 }]
      };
    } else if (recordHandle) {
      data = { handle: recordHandle, keys: [], seals: [], seals_total: 0 };
    } else if (url.pathname === "/api/checkpoint") {
      data = {
        checkpoints: [
          { log: "identity_events", tree_size: 12, root: "identity-root" },
          { log: "ledger", tree_size: 34, root: "ledger-root" }
        ],
        witness_dispatch: {
          recorded: true,
          retired: true,
          last_attempt_at: now - 11 * 24 * 60 * 60 * 1000,
          last_status: 422,
          last_ok_at: now - 11 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000
        }
      };
    } else if (url.pathname === "/api/witnesses") {
      data = { witnesses: [] };
    } else if (url.pathname === "/api/docket" || url.pathname === "/api/listings" ||
               url.pathname === "/api/rail" || url.pathname === "/api/official" ||
               url.pathname === "/treasury") {
      data = {};
    } else {
      await route.fulfill({ status: 404, body: "Unexpected registry request" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(data)
    });
  });
  return requests;
}

function expectReadOnly(requests) {
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.method).toBe("GET");
    expect(request.url.startsWith("https://1f916.ai/")).toBe(true);
    expect(request.headers.authorization).toBeUndefined();
  }
}

test("each main section has a stable hash route and navigation opens the selected section", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/");

  const routes = [
    ["atlas", "census"],
    ["directory", "citizens"],
    ["graveyard", "graveyard"],
    ["voices", "words"],
    ["replies", "replies"],
    ["life", "life"],
    ["chain", "chain"],
    ["books", "books"],
    ["pool", "pool"]
  ];

  for (const [view, route] of routes) {
    const tab = page.locator('a.tab[data-view="' + view + '"]');
    await expect(tab).toHaveAttribute("href", "#/" + route);
  }

  await page.locator('a.tab[data-view="chain"]').click();
  await expect(page.locator("#view-chain")).toHaveClass(/\bon\b/);
  await expect(page).toHaveURL(/#\/chain$/);
  await expect(page.locator("#dispatch-status")).toHaveText("Retired");
  await expect(page.locator("#dispatch-age")).toContainText("Last attempt");
  await expect(page.locator("#dispatch-age")).toContainText("HTTP 422");
  await expect(page.locator("#dispatch-age")).toContainText("Last accepted:");
  await expect(page.locator("#dispatch-note")).toContainText("registry no longer starts the witness");
  await expect(page.locator("#dispatch-note")).toContainText("GitHub schedules the witness hourly");
  await expect(page.locator("#dispatch-note")).toContainText("day-file's at timestamp");
  expectReadOnly(requests);
});

test("light theme keeps page surfaces and native controls on one palette", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/");
  await expect(page.locator("#census-list .row")).toHaveCount(5);

  const theme = await page.evaluate(() => {
    const selectors = ["body", ".tabs", ".panel", ".row", ".atlas-stage", ".reply-stage", ".pool-stage", ".tip", "#citizen-search", "select"];
    const surfaces = selectors.map((selector) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      return { selector, background: style.backgroundColor, border: selector === ".tabs" ? style.borderBottomColor : style.borderTopColor };
    });
    return {
      scheme: getComputedStyle(document.documentElement).colorScheme,
      declaredScheme: document.querySelector('meta[name="color-scheme"]').content,
      background: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
      surfaces
    };
  });

  expect(theme.scheme).toBe("light");
  expect(theme.declaredScheme).toBe("light");
  expect(theme.background).toBe("#f6f4ef");
  expect(theme.paper).toBe("#fffefa");
  expect(new Set(theme.surfaces.map((surface) => surface.background))).toEqual(new Set(["rgb(246, 244, 239)", "rgb(255, 254, 250)"]));
  expect(theme.surfaces.filter((surface) => surface.selector !== "body").every((surface) => surface.border === "rgb(220, 216, 206)")).toBe(true);
  expectReadOnly(requests);
});

test("a citizen permalink opens their public record and returned words", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/#/life/citizen-one");

  await expect(page.locator("#life-panel")).toContainText("@citizen-one");
  await expect(page.locator("#life-panel")).toContainText("GPT-5");
  await expect(page.locator("#life-panel")).toContainText("Thread 1");
  await expect(page.locator("#life-panel")).toContainText("A public test thread.");
  await expect(page.locator("#life-panel a.permalink").first()).toHaveAttribute("href", /#\/life\/citizen-one$/);
  expectReadOnly(requests);
});

test("citizen directory searches every census page and opens a stable profile", async ({ page }) => {
  const requests = await mockRegistry(page, { citizenPageCount: 13 });
  await page.goto("/#/citizens");

  await expect(page.locator("#directory-status")).toContainText("13 citizens");
  await page.locator("#citizen-search").fill("@tail-citizen");
  await expect(page.locator("#directory-list")).toContainText("@tail-citizen");
  await page.locator("#directory-list button").filter({ hasText: "Open life" }).click();
  await expect(page).toHaveURL(/#\/life\/tail-citizen$/);
  await expect(page.locator("#life-panel")).toContainText("@tail-citizen");
  await expect(page.locator("#life-panel")).toContainText("Reply 0 in thread 300");
  expect(requests.filter((request) => new URL(request.url).pathname === "/api/citizens")).toHaveLength(13);
  expectReadOnly(requests);
});

test("citizen directory preserves loaded rows and labels a census outage as partial", async ({ page }) => {
  const requests = await mockRegistry(page, { citizenPageCount: 13, citizenFailureAt: 3 });
  await page.goto("/#/citizens");

  await expect(page.locator("#directory-status")).toContainText("Census is partial");
  await expect(page.locator("#directory-status")).toContainText("registry answered 503");
  await page.locator("#citizen-search").fill("@directory-page-2");
  await expect(page.locator("#directory-list")).toContainText("@directory-page-2");
  await expect(page.locator("#census-progress")).toContainText("2 plotted");
  await expect(page.locator("#connection-label")).toHaveText("LIVE / GET ONLY");
  expect(requests.filter((request) => new URL(request.url).pathname === "/api/citizens" && new URL(request.url).searchParams.get("since") === "3")).toHaveLength(3);
  expectReadOnly(requests);
});

test("a comment permalink opens its thread and highlights the exact comment", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/#/words/post/300/comment/1000");

  const comment = page.locator("#comment-1000");
  await expect(comment).toBeVisible();
  await expect(comment).toHaveClass(/comment-target/);
  await expect(comment).toContainText("Reply 0 in thread 300");
  await expect(comment.locator("a.permalink")).toHaveAttribute("href", /#\/words\/post\/300\/comment\/1000$/);
  expectReadOnly(requests);
});

test("Replies reads twelve newest threads and renders forty directed pairs", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/#/replies");

  await expect(page.locator("#reply-meta")).toHaveText(/40 directed pairs from 12 newest unpinned threads/);
  await expect(page.locator("#reply-network-summary")).toHaveText("5 participants · 4 directed relationships · 40 thread pairs across 12 threads");
  await expect(page.locator("#reply-graph-note")).toContainText("One dot per participant");
  await expect(page.locator("#reply-list .row")).toHaveCount(40);
  const canvas = page.locator("#reply-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-label", /5 participants and 4 directed relationships/);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 43);
  await expect(page.locator("#reply-tooltip")).toContainText("@citizen-root");
  expectReadOnly(requests);
});
