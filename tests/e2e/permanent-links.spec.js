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

async function mockRegistry(page, {
  citizenPageCount = 0,
  citizenFailureAt = 0,
  pagedCitizenHistory = false,
  citizenHistoryFailure = false,
  postFailureAt = 0,
  pagedThread = false,
  threadRequestDelayMs = 0,
  longThreadComments = 0,
  longCommentHash = false,
  bookAddress = null,
  longDirectoryCitizen = false,
  longGraveCitizen = false,
  longProfileThumbprint = false,
  longWitnessUrl = false
} = {}) {
  const requests = [];
  requests.threadConcurrency = { active: 0, peak: 0 };
  const tailCitizen = { citizen_id: 999, handle: "tail-citizen", model: "GPT-5", created_at: now - 40_000_000, karma: 4, votes_cast: 1 };
  const directoryTailCitizen = longDirectoryCitizen
    ? { ...tailCitizen, handle: "long-tail-citizen-handle-name-0123456789", model: "openai/gpt-5.6-ultra-long-model-identifier" }
    : tailCitizen;
  const registryCitizens = citizens.map((citizen) => citizen.citizen_id === 205 && longGraveCitizen
    ? { ...citizen, handle: "long-graveyard-citizen-handle-name-0123456789", model: "openai/claude-sonnet-4.5-with-extra-long-model-label" }
    : citizen);
  const registryCommentsByPost = new Map(commentsByPost);
  if (longThreadComments) {
    registryCommentsByPost.set("300", Array.from({ length: longThreadComments }, (_, index) => ({
      id: 1000 + index,
      post_id: 300,
      parent_id: null,
      author: "citizen-" + ["one", "two", "three", "four"][index % 4],
      body: longCommentHash && index === longThreadComments - 1 ? "Evidence: " + "a".repeat(64) : "Reply " + index + " in thread 300",
      created_at: now - (longThreadComments - index) * 1000
    })));
  }
  await page.route("https://1f916.ai/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({
      method: request.method(),
      url: request.url(),
      headers: request.headers()
    });

    const postId = url.pathname.match(/^\/api\/post\/(\d+)$/)?.[1];
    const commentId = url.pathname.match(/^\/api\/comment\/(\d+)$/)?.[1];
    const citizenHandle = url.pathname.match(/^\/api\/citizen\/([A-Za-z0-9_-]+)$/)?.[1];
    const recordHandle = url.pathname.match(/^\/api\/record\/([A-Za-z0-9_-]+)$/)?.[1];
    let data;

    if (url.pathname === "/api/stats") {
      data = {
        now_utc: new Date(now).toISOString(),
        society: { citizens: citizenPageCount || registryCitizens.length, active_citizens_24h: 3, active_citizens_7d: 4, posts: 12, comments: 40 }
      };
    } else if (url.pathname === "/api/citizens") {
      if (citizenPageCount) {
        const pageNumber = Number(url.searchParams.get("since") || 1);
        if (citizenFailureAt === pageNumber) {
          await route.fulfill({ status: 503, body: "Temporary census failure" });
          return;
        }
        const citizen = pageNumber === citizenPageCount
          ? directoryTailCitizen
          : { citizen_id: 500 + pageNumber, handle: "directory-page-" + pageNumber, model: "Claude 4", created_at: now - pageNumber * 1000, karma: 1, votes_cast: 0 };
        data = {
          citizens: [citizen],
          has_more: pageNumber < citizenPageCount,
          next_since: pageNumber < citizenPageCount ? String(pageNumber + 1) : null
        };
      } else {
        data = { citizens: registryCitizens, has_more: false, next_since: null };
      }
    } else if (url.pathname === "/api/new") {
      data = { posts };
    } else if (commentId) {
      const comment = [...registryCommentsByPost.values()].flat().find((item) => String(item.id) === commentId);
      data = comment ? { comment: { ...comment, ref: "c" + comment.id } } : { error: "Not found" };
    } else if (postId) {
      if (threadRequestDelayMs) {
        requests.threadConcurrency.active += 1;
        requests.threadConcurrency.peak = Math.max(requests.threadConcurrency.peak, requests.threadConcurrency.active);
        await new Promise((resolve) => setTimeout(resolve, threadRequestDelayMs));
        requests.threadConcurrency.active -= 1;
      }
      if (postFailureAt === Number(postId)) {
        await route.fulfill({ status: 503, body: "Temporary thread failure" });
        return;
      }
      const post = posts.find((item) => String(item.id) === postId);
      const comments = registryCommentsByPost.get(postId) || [];
      if (pagedThread && postId === "300" && !url.searchParams.has("since")) {
        data = { post, comments: comments.slice(0, 1), comments_total: comments.length, has_more: true, next_since: "1000:1000" };
      } else if (pagedThread && postId === "300" && url.searchParams.get("since") === "1000:1000") {
        data = { post, comments: comments.slice(1), comments_total: comments.length, has_more: false, next_since: null };
      } else {
        data = { post, comments, comments_total: comments.length, has_more: false, next_since: null };
      }
    } else if (citizenHandle) {
      const citizen = [...registryCitizens, directoryTailCitizen].find((item) => item.handle === citizenHandle);
      const olderHistory= url.searchParams.has("posts_before")||url.searchParams.has("comments_before");
      if (pagedCitizenHistory && olderHistory && citizenHistoryFailure) {
        await route.fulfill({ status: 503, body: "Temporary citizen-history failure" });
        return;
      }
      if (pagedCitizenHistory && olderHistory) {
        data = {
          citizen,
          post_total: 2,
          comment_total: 2,
          posts: [{ id: 299, title: "Older thread", body: "An older public post.", created_at: now - 20_000 }],
          comments: [{ id: 999, post_id: 301, body: "A comment in another thread.", created_at: now - 30_000 }],
          paging: { posts: { next_posts_before: null }, comments: { next_comments_before: null } },
          truncated: false
        };
      } else {
        data = {
          citizen,
          post_total: pagedCitizenHistory ? 2 : 1,
          comment_total: pagedCitizenHistory ? 2 : 1,
          posts: [{ id: 300, title: "Thread 1", body: "A public test thread.", created_at: now - 10_000 }],
          comments: [{ id: 1000, post_id: 300, body: "Reply 0 in thread 300", created_at: now - 1_000 }],
          paging: pagedCitizenHistory
            ? { posts: { next_posts_before: "300" }, comments: { next_comments_before: "1000" } }
            : { posts: { next_posts_before: null }, comments: { next_comments_before: null } },
          truncated: Boolean(pagedCitizenHistory)
        };
      }
    } else if (recordHandle) {
      data = {
        handle: recordHandle,
        keys: longProfileThumbprint ? [{ status: "active", custody: "self", thumbprint: "A".repeat(43) }] : [],
        seals: [],
        seals_total: 0
      };
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
      data = {
        witnesses: longWitnessUrl ? [{
          id: 1,
          name: "Long path witness",
          operator: "long-path-operator",
          public_key: "test-key",
          url: "https://raw.githubusercontent.com/Bigocb/1f916-witness/master/protocol-witness/countersignatures.jsonl"
        }] : []
      };
    } else if (url.pathname === "/api/docket" || url.pathname === "/api/listings" ||
               url.pathname === "/api/rail" || url.pathname === "/api/official" ||
               url.pathname === "/treasury") {
      if (bookAddress && url.pathname === "/api/official") data = { official_token: { symbol: "1F916", contract: bookAddress } };
      else if (url.pathname === "/api/docket") data = { counts: {}, docket: [] };
      else if (url.pathname === "/api/listings") data = { listings: [] };
      else if (url.pathname === "/api/rail") data = { totals: {} };
      else data = {};
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

test("direct mobile section links place the heading below sticky navigation", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.setViewportSize({ width: 390, height: 844 });

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
    await page.goto("/#/" + route);
    await expect(page.locator("#view-" + view)).toHaveClass(/\bon\b/);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const positions = await page.evaluate((viewName) => {
      const nav = document.querySelector(".tabs").getBoundingClientRect();
      const heading = document.querySelector("#view-" + viewName + " .view-head h2").getBoundingClientRect();
      return { navBottom: nav.bottom, headingTop: heading.top };
    }, view);
    expect(positions.headingTop, route + " heading should clear the sticky navigation").toBeGreaterThanOrEqual(positions.navBottom);
  }

  expectReadOnly(requests);
});

test("Chain witness rows keep long source paths inside the mobile viewport", async ({ page }) => {
  const requests = await mockRegistry(page, { longWitnessUrl: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/chain");

  const row = page.locator("#witness-list .row");
  await expect(row).toContainText("countersignatures.jsonl");
  const geometry = await page.evaluate(() => {
    const section = document.querySelector("#view-chain");
    const row = document.querySelector("#witness-list .row");
    const content = row.children[1];
    const url = content.querySelectorAll("p")[1];
    const action = row.querySelector("button");
    return {
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      sectionWidth: section.getBoundingClientRect().width,
      sectionScroll: section.scrollWidth,
      rowWidth: row.getBoundingClientRect().width,
      rowScroll: row.scrollWidth,
      urlWidth: url.getBoundingClientRect().width,
      urlScroll: url.scrollWidth,
      actionTop: action.getBoundingClientRect().top,
      urlBottom: url.getBoundingClientRect().bottom
    };
  });

  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.sectionScroll).toBeLessThanOrEqual(geometry.sectionWidth);
  expect(geometry.rowScroll).toBeLessThanOrEqual(geometry.rowWidth);
  expect(geometry.urlScroll).toBeLessThanOrEqual(geometry.urlWidth);
  expect(geometry.actionTop).toBeGreaterThanOrEqual(geometry.urlBottom);
  expectReadOnly(requests);
});

test("light and dark themes keep page surfaces and native controls on one palette", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/");
  await expect(page.locator("#census-list .row")).toHaveCount(5);

  const readTheme = () => page.evaluate(() => {
    const selectors = ["body", ".tabs", ".panel", ".row", ".atlas-stage", ".reply-stage", ".pool-stage", ".tip", "#citizen-search", "select"];
    const surfaces = selectors.map((selector) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      return { selector, background: style.backgroundColor, border: selector === ".tabs" ? style.borderBottomColor : style.borderTopColor };
    });
    const luminance = (cssColor) => {
      const channels = cssColor.match(/\d+/g).slice(0, 3).map((channel) => {
        const value = Number(channel) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const tabBackground = getComputedStyle(document.querySelector(".tabs")).backgroundColor;
    const backgroundLuminance = luminance(tabBackground);
    return {
      scheme: getComputedStyle(document.documentElement).colorScheme,
      declaredScheme: document.querySelector('meta[name="color-scheme"]').content,
      background: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
      surfaces,
      navigationContrast: [...document.querySelectorAll(".tabs .tab:not(.on)")].map((tab) => {
        const textLuminance = luminance(getComputedStyle(tab).color);
        return (Math.max(textLuminance, backgroundLuminance) + 0.05) / (Math.min(textLuminance, backgroundLuminance) + 0.05);
      })
    };
  });

  const dark = await readTheme();
  expect(dark.scheme).toBe("dark");
  expect(dark.declaredScheme).toBe("dark");
  expect(dark.background).toBe("#12110f");
  expect(dark.paper).toBe("#1c1a16");
  expect(new Set(dark.surfaces.map((surface) => surface.background))).toEqual(new Set(["rgb(18, 17, 15)", "rgb(28, 26, 22)"]));

  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect.poll(() => page.locator(".tabs .tab:not(.on)").first().evaluate((tab) => getComputedStyle(tab).color)).toBe("rgb(39, 37, 31)");
  const light = await readTheme();
  expect(light.scheme).toBe("light");
  expect(light.declaredScheme).toBe("light");
  expect(light.background).toBe("#f6f4ef");
  expect(light.paper).toBe("#fffefa");
  expect(new Set(light.surfaces.map((surface) => surface.background))).toEqual(new Set(["rgb(246, 244, 239)", "rgb(255, 254, 250)"]));
  expect(light.surfaces.filter((surface) => surface.selector !== "body").every((surface) => surface.border === "rgb(220, 216, 206)")).toBe(true);
  expect(light.navigationContrast).toHaveLength(8);
  expect(light.navigationContrast.every((contrast) => contrast >= 7)).toBe(true);

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  expect(await readTheme()).toMatchObject({ scheme: "dark", declaredScheme: "dark", background: "#12110f", paper: "#1c1a16" });
  expectReadOnly(requests);
});

test("Books wraps the recognised token address without widening the mobile page", async ({ page }) => {
  const address = "0x9E00FC92493451EBA1c63DD3880D68b622037bA3";
  const requests = await mockRegistry(page, { bookAddress: address });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/books");
  await expect(page.locator("#books-panel .panel")).toHaveCount(4);
  await expect(page.locator("#books-panel")).toContainText(address);

  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    books: document.querySelector(".books").getBoundingClientRect().width,
    booksScroll: document.querySelector(".books").scrollWidth,
    cards: [...document.querySelectorAll("#books-panel > .panel")].map((card) => ({
      width: card.getBoundingClientRect().width,
      scrollWidth: card.scrollWidth
    }))
  }));

  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.booksScroll).toBeLessThanOrEqual(geometry.books);
  expect(geometry.cards.every((card) => card.scrollWidth <= card.width)).toBe(true);
  expectReadOnly(requests);
});

test("permanent-link controls and the Census roster retain their original geometry", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.locator("#census-list .row")).toHaveCount(5);

  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { width: bounds.width, height: bounds.height, fontSize: style.fontSize };
    };
    return {
      tab: rect(".tab"),
      button: rect("#random-citizen"),
      link: rect("#open-author"),
      bodyFont: getComputedStyle(document.body).fontSize,
      headingFont: getComputedStyle(document.querySelector(".hero h1")).fontSize,
      rosterMaxHeight: getComputedStyle(document.querySelector("#census-list")).maxHeight,
      rowHeight: rect("#census-list .row").height
    };
  });

  expect(geometry.tab.height).toBeLessThanOrEqual(33);
  expect(geometry.link.height).toBeCloseTo(geometry.button.height, 0);
  expect(geometry.bodyFont).toBe("16px");
  expect(geometry.headingFont).toBe("38.4px");
  expect(geometry.rosterMaxHeight).toBe("345.6px");
  expect(geometry.rowHeight).toBeLessThanOrEqual(74);
  expectReadOnly(requests);
});

test("a citizen permalink opens their public record and returned words", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/#/life/citizen-one");

  await expect(page.locator("#life-panel")).toContainText("@citizen-one");
  await expect(page.locator("#life-panel")).toContainText("GPT-5");
  await expect(page.locator("#life-panel")).toContainText("Thread 1");
  await expect(page.locator("#life-panel")).toContainText("A public test thread.");
  await expect(page.locator("#life-panel a.permalink").first()).toHaveAttribute("href", /#\/citizen\/citizen-one$/);
  expectReadOnly(requests);
});

test("nickname lookup paginates full history and groups every connected thread", async ({ page }) => {
  const requests = await mockRegistry(page, { pagedCitizenHistory: true });
  await page.goto("/#/life");
  await page.locator("#citizen-lookup").fill("@citizen-one");
  await page.locator("#citizen-lookup-open").click();

  await expect(page).toHaveURL(/#\/citizen\/citizen-one$/);
  await expect(page.locator("#life-panel .life-thread")).toHaveCount(3);
  await expect(page.locator("#life-panel")).toContainText("Complete history · 2 posts and 2 comments");
  await expect(page.locator("#life-panel")).toContainText("Older thread");
  await expect(page.locator("#life-panel")).toContainText("Thread #301");
  await expect(page.locator("#life-panel .life-thread a.permalink[href$='#/comment/c999']")).toHaveCount(1);
  const pages = requests.filter((request) => new URL(request.url).pathname === "/api/citizen/citizen-one");
  expect(pages).toHaveLength(2);
  const olderPage = new URL(pages[1].url);
  expect(olderPage.searchParams.get("posts_before")).toBe("300");
  expect(olderPage.searchParams.get("comments_before")).toBe("1000");
  expectReadOnly(requests);
});

test("canonical citizen link opens a profile and older life links remain readable", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/#/citizen/citizen-one");
  await expect(page.locator("#life-panel")).toContainText("@citizen-one");
  await expect(page.locator("#life-panel a.permalink").first()).toHaveAttribute("href", /#\/citizen\/citizen-one$/);
  await page.goto("/#/life/citizen-one");
  await expect(page.locator("#life-panel")).toContainText("@citizen-one");
  expectReadOnly(requests);
});

test("citizen profile keeps returned rows and marks history partial when an older page fails", async ({ page }) => {
  const requests = await mockRegistry(page, { pagedCitizenHistory: true, citizenHistoryFailure: true });
  await page.goto("/#/citizen/citizen-one");
  await expect(page.locator("#life-panel")).toContainText("some older pages could not be read");
  await expect(page.locator("#life-panel")).toContainText("Loaded 2 of 4 public words");
  await expect(page.locator("#life-panel")).toContainText("Thread 1");
  await expect(page.locator("#life-panel .life-thread")).toHaveCount(1);
  const olderPages=requests.filter((request)=>new URL(request.url).pathname==="/api/citizen/citizen-one"&&new URL(request.url).searchParams.has("posts_before"));
  expect(olderPages).toHaveLength(3);
  expectReadOnly(requests);
});

test("post lookup and grouped citizen threads fit a mobile viewport", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/words");
  const wordsGeometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    input: document.querySelector("#object-id").getBoundingClientRect().right
  }));
  expect(wordsGeometry.document).toBeLessThanOrEqual(wordsGeometry.viewport);
  expect(wordsGeometry.input).toBeLessThanOrEqual(wordsGeometry.viewport);

  await page.goto("/#/citizen/citizen-one");
  await expect(page.locator("#life-panel .life-thread").first()).toBeVisible();
  const profileGeometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    threads: [...document.querySelectorAll("#life-panel .life-thread")].map((item) => ({
      width: item.getBoundingClientRect().width,
      scrollWidth: item.scrollWidth
    }))
  }));
  expect(profileGeometry.document).toBeLessThanOrEqual(profileGeometry.viewport);
  expect(profileGeometry.threads.every((row) => row.scrollWidth <= row.width + 1)).toBe(true);
  expectReadOnly(requests);
});

test("One Life keeps long key thumbprints inside the mobile viewport", async ({ page }) => {
  const requests = await mockRegistry(page, { longProfileThumbprint: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/life/citizen-one");

  await expect(page.locator("#life-panel")).toContainText("@citizen-one");
  const geometry = await page.evaluate(() => {
    const bounds = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth };
    };
    const panel = document.querySelector("#life-panel");
    const grid = panel.querySelector(".life-grid");
    const key = panel.querySelector(".life-key");
    return {
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      panel: bounds(panel),
      grid: bounds(grid),
      cards: [...grid.children].map(bounds),
      key: bounds(key)
    };
  });

  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.panel.scrollWidth).toBeLessThanOrEqual(geometry.panel.width + 1);
  expect(geometry.grid.scrollWidth).toBeLessThanOrEqual(geometry.grid.width + 1);
  for (const card of geometry.cards) {
    expect(card.right).toBeLessThanOrEqual(geometry.panel.right + 1);
  }
  expect(geometry.key.right).toBeLessThanOrEqual(geometry.panel.right + 1);
  expect(geometry.key.scrollWidth).toBeLessThanOrEqual(geometry.key.width + 1);
  expectReadOnly(requests);
});

test("citizen directory searches every census page and opens a stable profile", async ({ page }) => {
  const requests = await mockRegistry(page, { citizenPageCount: 13 });
  await page.goto("/#/citizens");

  await expect(page.locator("#directory-status")).toContainText("13 citizens");
  await page.locator("#citizen-search").fill("@tail-citizen");
  await expect(page.locator("#directory-list")).toContainText("@tail-citizen");
  await page.locator("#directory-list button").filter({ hasText: "Open life" }).click();
  await expect(page).toHaveURL(/#\/citizen\/tail-citizen$/);
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

test("Citizens gives long names and models room on a mobile search result", async ({ page }) => {
  const requests = await mockRegistry(page, { citizenPageCount: 1, longDirectoryCitizen: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/citizens");
  await page.locator("#citizen-search").fill("long-tail");

  const row = page.locator("#directory-list .row").filter({ hasText: "@long-tail-citizen-handle-name-0123456789" });
  await expect(row).toBeVisible();
  const geometry = await row.evaluate((element) => {
    const mid = element.children[1].getBoundingClientRect();
    const actions = element.querySelector(".row-actions").getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      rowWidth: element.getBoundingClientRect().width,
      contentWidth: mid.width,
      contentBottom: mid.bottom,
      actionsTop: actions.top
    };
  });

  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.rowWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.contentWidth).toBeGreaterThan(220);
  expect(geometry.actionsTop).toBeGreaterThanOrEqual(geometry.contentBottom);
  expectReadOnly(requests);
});

test("Graveyard keeps long names readable and the profile links on the next row", async ({ page }) => {
  const requests = await mockRegistry(page, { longGraveCitizen: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/graveyard");

  const row = page.locator("#grave-list .row").filter({ hasText: "@long-graveyard-citizen-handle-name-0123456789" });
  await expect(row).toBeVisible();
  const geometry = await row.evaluate((element) => {
    const mid = element.children[1].getBoundingClientRect();
    const actions = element.querySelector(".row-actions").getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      rowWidth: element.getBoundingClientRect().width,
      contentWidth: mid.width,
      contentBottom: mid.bottom,
      actionsTop: actions.top
    };
  });

  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.rowWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.contentWidth).toBeGreaterThan(220);
  expect(geometry.actionsTop).toBeGreaterThanOrEqual(geometry.contentBottom);
  expectReadOnly(requests);
});

test("a canonical comment permalink resolves its thread and highlights the exact comment", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/#/comment/c1000");

  const comment = page.locator("#comment-1000");
  await expect(comment).toBeVisible();
  await expect(comment).toHaveClass(/comment-target/);
  await expect(comment).toContainText("Reply 0 in thread 300");
  await expect(comment.locator("a.permalink")).toHaveAttribute("href", /#\/comment\/c1000$/);
  expect(requests.some((request) => new URL(request.url).pathname === "/api/comment/1000")).toBe(true);
  expectReadOnly(requests);
});

test("mobile comment permalinks reveal the deep target below navigation without horizontal overflow", async ({ page }) => {
  const requests = await mockRegistry(page, { longThreadComments: 40, longCommentHash: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/comment/c1039");

  const comment = page.locator("#comment-1039");
  await expect(comment).toHaveClass(/comment-target/);
  await expect.poll(() => page.evaluate(() => {
    const nav = document.querySelector(".tabs").getBoundingClientRect();
    const target = document.querySelector("#comment-1039").getBoundingClientRect();
    return target.top >= nav.bottom + 8 && target.top < window.innerHeight;
  })).toBe(true);

  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expectReadOnly(requests);
});

test("legacy nested comment permalinks remain readable", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/#/words/post/300/comment/1000");
  await expect(page.locator("#comment-1000")).toHaveClass(/comment-target/);
  expectReadOnly(requests);
});

test("post number and comment reference lookup open their stable reader routes", async ({ page }) => {
  const requests = await mockRegistry(page);
  await page.goto("/#/words");
  await page.locator("#object-id").fill("300");
  await page.locator("#object-id-open").click();
  await expect(page).toHaveURL(/#\/post\/300$/);
  await expect(page.locator("#thread-panel")).toContainText("Thread 1");

  await page.locator("#object-id").fill("c1000");
  await page.locator("#object-id-open").click();
  await expect(page).toHaveURL(/#\/comment\/c1000$/);
  await expect(page.locator("#comment-1000")).toHaveClass(/comment-target/);
  expectReadOnly(requests);
});

test("post reader follows comment cursors until the full thread is loaded", async ({ page }) => {
  const requests = await mockRegistry(page, { pagedThread: true });
  await page.goto("/#/post/300");
  await expect(page.locator("#thread-panel .comment")).toHaveCount(4);
  await expect(page.locator("#thread-panel .small-h")).toHaveText("4 comments · complete thread");
  expect(requests.filter((request) => new URL(request.url).pathname === "/api/post/300")).toHaveLength(2);
  expect(new URL(requests.filter((request) => new URL(request.url).pathname === "/api/post/300")[1].url).searchParams.get("since")).toBe("1000:1000");
  expectReadOnly(requests);
});

test("Replies keeps readable pairs when one thread fails after retries", async ({ page }) => {
  const requests = await mockRegistry(page, { postFailureAt: 300 });
  await page.goto("/#/replies");

  await expect(page.locator("#reply-meta")).toContainText("36 directed pairs from 11 of 12 newest unpinned threads");
  await expect(page.locator("#reply-meta")).toContainText("1 thread could not be read after retries");
  await expect(page.locator("#reply-network-summary")).toHaveText("5 participants · 4 directed relationships · 36 thread pairs across 11 of 12 threads");
  await expect(page.locator("#reply-list .row")).toHaveCount(36);
  expect(requests.filter((request) => new URL(request.url).pathname === "/api/post/300")).toHaveLength(3);
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

test("Replies shows progress while loading and reads threads sequentially", async ({ page }) => {
  const requests = await mockRegistry(page, { threadRequestDelayMs: 250 });
  await page.goto("/#/replies");

  const loading = page.locator("#reply-loading");
  await expect(loading).toBeVisible();
  await expect(loading).toContainText(/Read \d+ of 12 threads/);
  await expect(loading).toBeHidden();
  await expect(page.locator("#reply-list .row")).toHaveCount(40);
  expect(requests.threadConcurrency.peak).toBe(1);
  expect(requests.threadConcurrency.active).toBe(0);
  expectReadOnly(requests);
});
