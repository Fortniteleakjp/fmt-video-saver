(() => {
  const DIRECT = /\.(mp4|webm|mkv|mov|m4v|avi|flv|ogv|3gp|ts|m2ts|mts|mp3|m4a|aac|ogg|wav|flac)(?:$|[?#])/i;
  const MANIFEST = /\.(m3u8|mpd|f4m)(?:$|[?#])/i;
  const FMT = /\.fmt(?:$|[?#])/i;
  const seen = new Set();

  function kindFor(url) {
    if (FMT.test(url)) return "fmt";
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    const manifestHint = /(?:^|[\/_.-])(manifest|playlist)(?:[\/_.?&#-]|$)/i.test(`${parsed.pathname}${parsed.search}`);
    if (MANIFEST.test(url) || manifestHint) return "manifest";
    if (DIRECT.test(url)) return /(?:[?&](?:fmt|format|itag)=)/i.test(url) ? "fmt" : "direct";
    if (/(?:[?&](?:fmt|format|itag)=)/i.test(url)) return "fmt";
    return null;
  }

  function youtubeVideoId() {
    const host = location.hostname.toLowerCase();
    if (!(host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be")) return "";
    if (host === "youtu.be") return location.pathname.split("/").filter(Boolean)[0] || "";
    const queryId = new URL(location.href).searchParams.get("v");
    if (queryId) return queryId;
    const match = location.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,})/);
    return match?.[1] || "";
  }

  function addYoutubeThumbnails(list) {
    const videoId = youtubeVideoId();
    if (!videoId) return;
    add(list, `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, { kind: "thumbnail", quality: "1080p / full" });
  }

  function addYoutubeVideo(list) {
    if (!youtubeVideoId()) return;
    add(list, location.href, { kind: "youtube", quality: "動画 + 音声を結合" });
  }

  // SVGの<a>やanimate要素の href/src は SVGAnimatedString で文字列ではない。
  // 文字列に正規化できないものは候補として扱わない。
  function urlString(value) {
    if (typeof value === "string") return value;
    return typeof value?.baseVal === "string" ? value.baseVal : "";
  }

  function add(list, url, extra = {}) {
    const raw = urlString(url);
    if (!raw || raw.startsWith("blob:") || raw.startsWith("data:") || raw.startsWith("javascript:")) return;
    let absolute;
    try { absolute = new URL(raw, location.href).href; } catch { return; }
    const kind = extra.kind || kindFor(absolute);
    if (!kind || seen.has(absolute)) return;
    seen.add(absolute);
    list.push({ url: absolute, kind, ...extra, title: document.title || "video" });
  }

  function sendCandidates(candidates) {
    try {
      chrome.runtime.sendMessage(
        { type: "pageCandidates", pageUrl: location.href, candidates },
        () => void chrome.runtime.lastError,
      );
    } catch {
      // 拡張機能を再読み込みした直後に残った古いページ側コンテキストを無視する
    }
  }

  function scan() {
    const candidates = [];
    document.querySelectorAll("video, audio").forEach((element) => {
      add(candidates, element.currentSrc || element.src, { quality: element.getAttribute("width") ? `${element.getAttribute("width")}px` : "" });
      element.querySelectorAll("source[src]").forEach((source) => add(candidates, source.src));
    });
    document.querySelectorAll("a[href], link[href]").forEach((element) => add(candidates, element.href));
    performance.getEntriesByType("resource").forEach((entry) => add(candidates, entry.name, { source: "performance" }));
    addYoutubeVideo(candidates);
    addYoutubeThumbnails(candidates);
    if (candidates.length) sendCandidates(candidates);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "scan") {
      scan();
      sendResponse({ ok: true });
    }
  });

  let scanTimer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  scan();
})();
