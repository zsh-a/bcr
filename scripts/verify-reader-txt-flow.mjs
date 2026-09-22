import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 900 }, hasTouch: true });
  const modules = new Map();
  // Resource Timing is bounded; preserve actual module URLs, including Vite versions.
  page.on("request", (request) => {
    const url = request.url();
    for (const name of ["store", "readingPosition"]) {
      if (new URL(url).pathname.endsWith(`/packages/reader-studio/src/${name}.ts`))
        modules.set(name, url);
    }
  });
  const moduleUrl = (name) => {
    assert.ok(modules.has(name), `reader module was loaded: ${name}`);
    return modules.get(name);
  };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString());
  const paragraphs = Array.from(
    { length: 90 },
    (_, i) => `${i} ${"山间的风轻轻吹过，读书的人翻开下一页。".repeat(1 + (i % 9))}`,
  );
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "continuous-pages.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(paragraphs.join("\n\n")),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  const settings = async (patch) =>
    page.evaluate(
      async ({ patch, url }) => {
        const { reader } = await import(url);
        reader.setSettings(patch);
      },
      { patch, url: moduleUrl("store") },
    );
  await settings({ layout: "paged", tocPinned: false, pageSpread: false, pageAnimation: "none" });
  const settled = async () => {
    await page.waitForFunction(
      () => document.querySelector(".reader-txt-viewport")?.getAttribute("aria-busy") === "false",
    );
    await page.waitForTimeout(40);
  };
  const snapshot = () =>
    page.locator(".reader-txt-page").evaluateAll((pages) =>
      pages.map((page) => {
        const bounds = page.getBoundingClientRect();
        const fragments = [...page.querySelectorAll(".reader-prose")];
        const bottoms = [];
        for (const fragment of fragments) {
          const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects())
              if (rect.width) bottoms.push(rect.bottom - bounds.top);
          }
        }
        return {
          start: page.dataset.txtPageStart,
          end: page.dataset.txtPageEnd,
          text: fragments.map((p) => p.textContent).join(""),
          bottom: Math.max(...bottoms),
          height: bounds.height,
          fragments: fragments.length,
        };
      }),
    );
  await settled();
  const history = [];
  for (let i = 0; i < 150; i++) {
    const [state] = await snapshot();
    assert(state.bottom <= state.height + 1, `text must not be clipped: ${JSON.stringify(state)}`);
    if (history.length)
      assert.equal(
        state.start,
        history.at(-1).end,
        "successive pages share an exact source boundary",
      );
    history.push(state);
    if (await page.getByRole("button", { name: "下一页", exact: true }).isDisabled()) break;
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await settled();
  }
  assert.equal(
    history.map((entry) => entry.text).join(""),
    paragraphs.join(""),
    "reading the entire book must omit or repeat no characters",
  );
  assert(history.length > 20);
  const ordinary = history.slice(0, -1).map((entry) => entry.bottom);
  assert(
    Math.max(...ordinary) - Math.min(...ordinary) < 1,
    "technical loading boundaries must not create short pages",
  );
  // Reverse well beyond the eight-spread cache, then reload and reconstruct the preceding page.
  for (let i = 0; i < 12; i++) {
    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await settled();
    assert.equal((await snapshot())[0].text, history[history.length - 2 - i].text);
  }
  const beforeReload = (await snapshot())[0];
  await page.reload();
  await settled();
  assert.equal(
    (await snapshot())[0].text,
    beforeReload.text,
    "reload restores the same page start",
  );
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await settled();
  assert.equal(
    (await snapshot())[0].text,
    history[history.length - 14].text,
    "cold reverse paging reconstructs the previous page locally",
  );
  const selection = await page.evaluate(
    async ({ storeUrl, positionUrl }) => {
      const prose = document.querySelector(".reader-txt-page .reader-prose");
      const range = document.createRange();
      range.setStart(prose.firstChild, 1);
      range.setEnd(prose.firstChild, Math.min(5, prose.firstChild.textContent.length));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      const { getReaderState } = await import(storeUrl);
      const { readerSelectionLocator } = await import(positionUrl);
      const book = getReaderState().library.find(
        (book) => book.id === getReaderState().activeBookId,
      );
      const locator = readerSelectionLocator(book);
      window.getSelection().removeAllRanges();
      return {
        expected: Number(prose.dataset.readerTextStart) + 1,
        actual: locator?.textAnchor?.start,
      };
    },
    { storeUrl: moduleUrl("store"), positionUrl: moduleUrl("readingPosition") },
  );
  assert.equal(
    selection.actual,
    selection.expected,
    "selection offsets remain relative to the original paragraph",
  );
  for (const animation of ["slide", "fade", "paper", "none"]) {
    await settings({ pageAnimation: animation });
    await settled();
    const from = (await snapshot())[0].start;
    await page.getByRole("button", { name: "下一页", exact: true }).evaluate((button) => {
      button.click();
      button.click();
      document.querySelector('[aria-label="上一页"]').click();
    });
    await settled();
    assert.notEqual((await snapshot())[0].start, from);
    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await settled();
    assert.equal(
      (await snapshot())[0].start,
      from,
      `${animation}: rapid turns retain the correct source destination`,
    );
  }
  // Open the search strip before capturing a boundary: it reserves vertical space.
  await page.evaluate(async (url) => {
    const { reader, getReaderState } = await import(url);
    reader.setSearch("预备搜索", [], getReaderState().activeBookId);
  }, moduleUrl("store"));
  await settled();
  // A match split by a page boundary must be highlighted on both source slices.
  for (let i = 0; i < 3 && Number((await snapshot())[0].end.split(":")[1]) < 4; i++) {
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await settled();
  }
  const query = await page.evaluate(async (url) => {
    const endpoint = document
      .querySelector(".reader-txt-page")
      .dataset.txtPageEnd.split(":")
      .map(Number);
    const { reader, getReaderState } = await import(url);
    const book = getReaderState().library.find((book) => book.id === getReaderState().activeBookId);
    const query = book.sections[endpoint[0]].text.slice(endpoint[1] - 4, endpoint[1] + 4);
    reader.setSearch(query, [], book.id);
    return query;
  }, moduleUrl("store"));
  await settled();
  assert.equal(
    await page
      .locator(".reader-txt-page .reader-prose")
      .last()
      .locator("mark")
      .last()
      .textContent(),
    query.slice(0, 4),
  );
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await settled();
  assert.equal(
    await page
      .locator(".reader-txt-page .reader-prose")
      .first()
      .locator("mark")
      .first()
      .textContent(),
    query.slice(4),
  );
  const beforeReflow = (await snapshot())[0].text.slice(0, 64);
  await settings({ fontSize: 24, lineHeight: 1.9 });
  await settled();
  assert(
    (await snapshot())[0].text.includes(beforeReflow),
    "typography changes keep the current source passage in view",
  );
  await settings({ pageAnimation: "none", pageSpread: true });
  await page.setViewportSize({ width: 1920, height: 1000 });
  await settled();
  const spread = await snapshot();
  assert.equal(spread.length, 2);
  assert.equal(spread[0].end, spread[1].start);
  assert(spread.every((entry) => entry.bottom <= entry.height + 1));
  const mixed = Array.from(
    { length: 18 },
    (_, i) =>
      `${i} English words and 中文 punctuation，😀 é. `.repeat(8) +
      "\n保留段内换行与连续破折号——下一行继续。".repeat(3),
  );
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "mixed-lines.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(mixed.join("\n\n")),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  await settings({ pageSpread: false });
  await settled();
  await page.evaluate(() => document.fonts.ready);
  await settled();
  const mixedPages = [];
  for (let i = 0; i < 100; i++) {
    const [state] = await snapshot();
    assert(state.bottom <= state.height + 1, "mixed-script lines must not overflow a page");
    if (mixedPages.length) assert.equal(state.start, mixedPages.at(-1).end);
    mixedPages.push(state);
    if (await page.getByRole("button", { name: "下一页", exact: true }).isDisabled()) break;
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await settled();
  }
  assert.equal(
    mixedPages.map((state) => state.text).join(""),
    mixed.join(""),
    "newlines, emoji and combining marks must survive paging intact",
  );
  assert.deepEqual(errors, []);
  console.log(
    "TXT flow PASSED: exact full-book text, no loading-boundary short pages, reverse beyond cache, cold reload/back, four animations, rapid turns and dual-page continuity",
    { pages: history.length },
  );
} finally {
  await browser.close();
}
