/** Track live Vite module URLs outside the browser's bounded resource timing buffer.
 * Install before navigation; retain query strings so imports share the UI's instances. */
export async function trackModuleRequests(page) {
  const urls = new Set();
  page.on("request", (request) => {
    // Same-document citation/history changes also emit framenavigated; only
    // a new document request invalidates the module graph.
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) urls.clear();
    urls.delete(request.url());
    urls.add(request.url());
  });
  await page.exposeFunction("__bcrTestModuleUrls", () => [...urls]);
}
