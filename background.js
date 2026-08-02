const tabCandidates = new Map();
const browserDownloadJobs = new Map();
const MAX_CANDIDATES = 100;

const DIRECT_EXTENSIONS = /\.(mp4|webm|mkv|mov|m4v|avi|flv|ogv|3gp|ts|m2ts|mts|mp3|m4a|aac|ogg|wav|flac)(?:$|[?#])/i;
const MANIFEST_EXTENSIONS = /\.(m3u8|mpd|f4m)(?:$|[?#])/i;
const FMT_EXTENSION = /\.fmt(?:$|[?#])/i;
const HLS_SEGMENT_EXTENSIONS = /\.(ts|aac|vtt|cmfv|cmfa)(?:$|[?#])/i;

function isYoutubeMediaUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase().endsWith(".googlevideo.com")
      || /[?&]videoplayback(?:[=&]|$)/i.test(parsed.search)
      || /\/videoplayback(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isYoutubePageUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean).length > 0;
    if (!(host === "youtube.com" || host.endsWith(".youtube.com"))) return false;
    return Boolean(parsed.searchParams.get("v") || /\/(?:shorts|embed|live)\//.test(parsed.pathname));
  } catch {
    return false;
  }
}

function isLikelyHlsSegment(raw) {
  if (!HLS_SEGMENT_EXTENSIONS.test(String(raw.url || ""))) return false;
  return raw.source === "performance"
    || raw.resourceType === "xmlhttprequest"
    || /(?:segment|fragment|chunk|init|part|range)/i.test(String(raw.url || ""));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function detectKind(url, resourceType = "") {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  const lower = parsed.href.toLowerCase();
  const hasFmtParameter = /(?:[?&](?:fmt|format|itag)=)[^&#]+/i.test(parsed.search);
  const manifestHint = /(?:^|[\/_.-])(manifest|playlist)(?:[\/_.?&#-]|$)/i.test(`${parsed.pathname}${parsed.search}`);

  if (FMT_EXTENSION.test(lower)) return "fmt";
  if (MANIFEST_EXTENSIONS.test(lower) || manifestHint) {
    return "manifest";
  }
  if (DIRECT_EXTENSIONS.test(lower) || resourceType === "media" || /(?:video|audio)/i.test(resourceType)) {
    return hasFmtParameter ? "fmt" : "direct";
  }
  if (hasFmtParameter || /(?:video|videoplayback|media)/i.test(lower)) return "fmt";
  return null;
}

function formatId(url) {
  const parsed = safeUrl(url);
  if (!parsed) return "";
  return parsed.searchParams.get("fmt") || parsed.searchParams.get("format") || parsed.searchParams.get("itag") || "";
}

function qualityLabel(url) {
  const parsed = safeUrl(url);
  if (!parsed) return "";
  const value = parsed.searchParams.get("quality") || parsed.searchParams.get("q") || parsed.searchParams.get("resolution") || "";
  return value.replace(/[^a-z0-9_.-]/gi, "").slice(0, 24);
}

function extensionFor(url, kind) {
  const parsed = safeUrl(url);
  if (!parsed) return kind === "manifest" ? "txt" : "mp4";
  const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
  if (match) return match[1].toLowerCase();
  if (kind === "manifest") return "txt";
  const mime = parsed.searchParams.get("mime") || "";
  if (/webm/i.test(mime)) return "webm";
  if (/audio/i.test(mime)) return "m4a";
  return "mp4";
}

function makeFilename(candidate) {
  const base = (candidate.title || "video")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "video";
  const suffix = candidate.kind === "youtube" ? "" : candidate.formatId ? `-fmt${candidate.formatId}` : candidate.quality ? `-${candidate.quality}` : "";
  return `${base}${suffix}.${extensionFor(candidate.url, candidate.kind)}`;
}

function toCandidate(raw, tabId, source = "page") {
  const url = safeUrl(raw.url);
  if (!url) return null;
  const kind = raw.kind || detectKind(url.href, raw.resourceType);
  if (!kind) return null;
  const candidate = {
    url: url.href,
    kind,
    source,
    title: String(raw.title || "video").slice(0, 140),
    formatId: String(raw.formatId || formatId(url.href)).slice(0, 40),
    quality: String(raw.quality || qualityLabel(url.href)).slice(0, 40),
    detectedAt: raw.detectedAt || Date.now()
  };
  candidate.filename = raw.filename || makeFilename(candidate);
  return candidate;
}

function addCandidates(tabId, rawCandidates, source) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const current = tabCandidates.get(tabId) || [];
  const incoming = rawCandidates
    .filter((raw) => !isLikelyHlsSegment(raw))
    .map((raw) => toCandidate(raw, tabId, source))
    .filter(Boolean);
  const merged = [...incoming, ...current];
  const unique = [];
  const seen = new Set();
  for (const item of merged) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
    if (unique.length >= MAX_CANDIDATES) break;
  }
  tabCandidates.set(tabId, unique);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (isYoutubeMediaUrl(details.url)) return;
    const kind = detectKind(details.url, details.type);
    if (kind) addCandidates(details.tabId, [{ url: details.url, kind, resourceType: details.type }], "network");
  },
  { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "other"] }
);

chrome.tabs.onRemoved.addListener((tabId) => tabCandidates.delete(tabId));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;

  if (message.type === "pageCandidates") {
    const pageCandidates = isYoutubePageUrl(message.pageUrl)
      ? (message.candidates || []).filter((candidate) => ["youtube", "thumbnail"].includes(candidate.kind))
      : (message.candidates || []);
    addCandidates(tabId, pageCandidates, "page");
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "getCandidates") {
    sendResponse({ ok: true, candidates: tabCandidates.get(tabId) || [] });
    return;
  }

  if (message.type === "clearCandidates") {
    tabCandidates.delete(tabId);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "downloadCandidate") {
    const candidate = toCandidate(message.candidate, tabId, "popup");
    if (!candidate || candidate.kind === "manifest") {
      sendResponse({ ok: false, error: "マニフェストはそのまま動画ファイルにはできません。URLをコピーして ffmpeg 等で処理してください。" });
      return;
    }
    if (candidate.kind === "thumbnail") {
      startBrowserDownload(candidate, sendResponse);
      return true;
    }
    prepareNativeDownload(candidate, tabId, (nativeResponse) => {
      if (nativeResponse?.ok || !String(nativeResponse?.error || "").includes("Nativeヘルパーに接続できません")) {
        sendResponse(nativeResponse);
        return;
      }
      startBrowserDownload(candidate, sendResponse);
    });
    return true;
  }

  if (message.type === "downloadStreamCandidate") {
    const candidate = toCandidate(message.candidate, tabId, "popup");
    if (!candidate || candidate.kind !== "manifest") {
      sendResponse({ ok: false, error: "結合対象のストリームが見つかりません。" });
      return;
    }
    prepareNativeDownload(candidate, tabId, sendResponse, "stream");
    return true;
  }

  if (message.type === "downloadYoutubeCandidate") {
    const candidate = toCandidate(message.candidate, tabId, "popup");
    if (!candidate || candidate.kind !== "youtube") {
      sendResponse({ ok: false, error: "YouTube動画候補が見つかりません。" });
      return;
    }
    const mode = message.downloadType === "audio" ? "youtube-audio" : "youtube-video";
    prepareNativeDownload(candidate, tabId, sendResponse, mode);
    return true;
  }

  sendResponse({ ok: false, error: "Unknown message" });
});

function startBrowserDownload(candidate, sendResponse) {
  const jobId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  chrome.downloads.download({
    url: candidate.url,
    filename: candidate.filename,
    saveAs: true,
    conflictAction: "uniquify"
  }, (downloadId) => {
    const error = chrome.runtime.lastError;
    if (error) {
      sendResponse({ ok: false, error: error.message });
      return;
    }
    browserDownloadJobs.set(downloadId, { jobId, received: 0, total: 0 });
    sendProgress(jobId, 0, "保存を開始中");
    sendResponse({ ok: true, downloadId, jobId, mode: "browser" });
  });
}

chrome.downloads.onChanged.addListener((delta) => {
  const job = browserDownloadJobs.get(delta.id);
  if (!job) return;
  if (delta.bytesReceived?.current !== undefined) job.received = delta.bytesReceived.current;
  if (delta.totalBytes?.current !== undefined) job.total = delta.totalBytes.current;
  if (delta.state?.current === "complete") {
    sendProgress(job.jobId, 100, "保存完了");
    browserDownloadJobs.delete(delta.id);
    return;
  }
  if (delta.error?.current) {
    sendProgress(job.jobId, 0, `保存エラー: ${delta.error.current}`);
    browserDownloadJobs.delete(delta.id);
    return;
  }
  const progress = job.total > 0 ? Math.min(99, Math.round((job.received / job.total) * 100)) : 0;
  sendProgress(job.jobId, progress, "保存中");
});

function getCookiesForUrls(urls, callback) {
  const uniqueUrls = [...new Set(urls.filter((url) => /^https?:\/\//i.test(url)))];
  if (!uniqueUrls.length) {
    callback([], null);
    return;
  }
  const cookieMap = new Map();
  let remaining = uniqueUrls.length;
  let firstError = null;
  uniqueUrls.forEach((url) => {
    chrome.cookies.getAll({ url }, (cookies) => {
      const error = chrome.runtime.lastError;
      if (error && !firstError) firstError = error.message;
      (cookies || []).forEach((cookie) => {
        const key = `${cookie.storeId || ""}\t${cookie.domain}\t${cookie.path}\t${cookie.name}`;
        cookieMap.set(key, cookie);
      });
      remaining -= 1;
      if (remaining === 0) callback([...cookieMap.values()], firstError);
    });
  });
}

function prepareNativeDownload(candidate, tabId, sendResponse, mode = "stream") {
  chrome.tabs.get(tabId, (tab) => {
    const tabError = chrome.runtime.lastError;
    if (tabError) {
      sendResponse({ ok: false, error: tabError.message });
      return;
    }
    getCookiesForUrls([candidate.url, tab?.url || ""], (cookies, cookieError) => {
      if (cookieError) {
        sendResponse({ ok: false, error: `Cookieを取得できませんでした: ${cookieError}` });
        return;
      }
      const jobId = `native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      startNativeDownload({
        type: "download",
        jobId,
        url: candidate.url,
        title: candidate.title,
        filename: candidate.filename,
        mode,
        referer: tab?.url || "",
        cookies
      }, sendResponse);
    });
  });
}

function sendProgress(jobId, progress, stage) {
  chrome.runtime.sendMessage({
    type: "downloadProgress",
    jobId,
    progress: Math.max(0, Math.min(100, Number(progress) || 0)),
    stage
  });
}

function startNativeDownload(request, callback) {
  let port;
  try {
    port = chrome.runtime.connectNative("com.fmtsaver.helper");
  } catch (error) {
    callback({ ok: false, error: `Nativeヘルパーに接続できません。READMEのセットアップを確認してください。\n${error.message}` });
    return;
  }
  let finished = false;
  const finish = (response) => {
    if (finished) return;
    finished = true;
    callback(response || { ok: false, error: "Nativeヘルパーから応答がありません。" });
  };
  port.onMessage.addListener((message) => {
    if (message?.event === "progress") {
      sendProgress(message.jobId || request.jobId, message.progress, message.stage || "処理中");
      return;
    }
    if (message?.event === "complete" || message?.ok === false) {
      if (message?.ok) sendProgress(message.jobId || request.jobId, 100, "保存完了");
      finish(message);
      try { port.disconnect(); } catch { /* 切断済み */ }
    }
  });
  port.onDisconnect.addListener(() => {
    if (finished) return;
    const error = chrome.runtime.lastError;
    finish({ ok: false, error: `Nativeヘルパーに接続できません。READMEのセットアップを確認してください。\n${error?.message || "接続が切断されました。"}` });
  });
  sendProgress(request.jobId, 0, "保存を開始中");
  port.postMessage(request);
}
