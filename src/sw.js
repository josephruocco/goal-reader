const VIEWER = "viewer.html";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "goalReaderOpen",
    title: "Open in Goal Reader",
    contexts: ["page", "link"]
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL(VIEWER) });
});

chrome.contextMenus.onClicked.addListener((info) => {
  let target = null;

  if (info.linkUrl) target = info.linkUrl;
  else if (info.pageUrl) target = info.pageUrl;

  // open viewer with pdf param if we have one, else open blank viewer
  const url = target
    ? chrome.runtime.getURL(`${VIEWER}?pdf=${encodeURIComponent(target)}`)
    : chrome.runtime.getURL(VIEWER);

  chrome.tabs.create({ url });
});