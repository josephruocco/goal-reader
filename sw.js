const MENU_ID = "open-in-goal-reader";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Open in Goal Reader",
    contexts: ["link", "page"]
  });
});

function isProbablyPdfUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path.endsWith(".pdf")) return true;
    // some PDFs are served without .pdf; allow forcing by query
    if (u.searchParams.get("format")?.toLowerCase() === "pdf") return true;
    return false;
  } catch {
    return false;
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetUrl = info.linkUrl || info.pageUrl;
  if (!targetUrl) return;

  // If it's a page context click, only open if it looks like a PDF
  if (!info.linkUrl && !isProbablyPdfUrl(targetUrl)) return;

  const viewerUrl =
    chrome.runtime.getURL("viewer.html") +
    "?pdf=" +
    encodeURIComponent(targetUrl);

  await chrome.tabs.create({ url: viewerUrl, index: (tab?.index ?? 0) + 1 });
});
