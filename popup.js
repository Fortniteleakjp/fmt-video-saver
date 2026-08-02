let activeTabId = null;
let activeTabUrl = "";
let activeTabTitle = "";
let candidates = [];
let currentJobId = null;

const $ = (selector) => document.querySelector(selector);

function escapeText(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function showNotice(message) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.classList.remove("hidden");
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => notice.classList.add("hidden"), 6500);
}

function setProgress(jobId, progress, stage) {
  if (jobId === null) currentJobId = null;
  else if (jobId) currentJobId = jobId;
  const value = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  $("#download-status").classList.remove("hidden");
  $("#progress-fill").style.width = `${value}%`;
  $("#progress-percent").textContent = `${value}%`;
  $("#progress-stage").textContent = stage || "処理中";
  const track = $(".progress-track");
  track.setAttribute("aria-valuenow", String(value));
  if (value >= 100) {
    window.clearTimeout(setProgress.timer);
    setProgress.timer = window.setTimeout(() => $("#download-status").classList.add("hidden"), 5000);
  }
}

function finishProgress(message) {
  if (message?.jobId && currentJobId && message.jobId !== currentJobId) return;
  setProgress(message?.jobId || currentJobId, 100, message?.stage || "保存完了");
  window.clearTimeout(finishProgress.timer);
  finishProgress.timer = window.setTimeout(() => $("#download-status").classList.add("hidden"), 5000);
}

function labelFor(kind) {
  return { direct: "直接ファイル", fmt: "FMT", manifest: "HLS/DASH", thumbnail: "サムネイル", youtube: "YouTube動画" }[kind] || "メディア";
}

function youtubeVideoPage(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean).length > 0;
    if (!(host === "youtube.com" || host.endsWith(".youtube.com"))) return false;
    return Boolean(parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:shorts|embed|live)\//));
  } catch {
    return false;
  }
}

function youtubeVideoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (!(host === "youtube.com" || host.endsWith(".youtube.com"))) return "";
    return parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,})/)?.[1] || "";
  } catch {
    return "";
  }
}

function makeThumbnailCandidate(candidate) {
  const videoId = youtubeVideoIdFromUrl(candidate.url);
  const base = String(candidate.title || "youtube")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "youtube";
  return {
    url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    kind: "thumbnail",
    title: candidate.title || "YouTube",
    quality: "1080p / full",
    filename: `${base}-thumbnail.jpg`
  };
}

function shapeCandidates(rawCandidates) {
  if (!youtubeVideoPage(activeTabUrl)) return rawCandidates;
  const youtube = rawCandidates.find((candidate) => candidate.kind === "youtube") || {
    url: activeTabUrl,
    kind: "youtube",
    title: activeTabTitle || "YouTube動画",
    filename: `${activeTabTitle || "YouTube動画"}.mp4`,
    quality: "動画 + 音声を結合"
  };
  return [youtube];
}

function preferMasterManifest(rawCandidates) {
  const manifests = rawCandidates.filter((candidate) => candidate.kind === "manifest");
  if (manifests.length < 2) return rawCandidates;
  const master = manifests.find((candidate) => /(?:master|playlist)\.(?:m3u8|mpd)(?:$|[?#])/i.test(candidate.url));
  if (!master) return rawCandidates;
  return [master, ...rawCandidates.filter((candidate) => candidate.kind !== "manifest")];
}

function hostname(value) {
  try { return new URL(value).hostname; } catch { return value; }
}

function render() {
  $("#count").textContent = `${candidates.length} 件`;
  $("#empty").classList.toggle("hidden", candidates.length > 0);
  const list = $("#list");
  list.replaceChildren();
  candidates.forEach((candidate, index) => {
    const item = document.createElement("article");
    const isManifest = candidate.kind === "manifest";
    const isYoutube = candidate.kind === "youtube";
    item.className = `candidate${isYoutube ? " youtube" : ""}`;
    const actionMarkup = isYoutube
      ? `<div class="youtube-actions">
          <button class="youtube-action" data-action="audio">音声のみ（WAV）</button>
          <button class="youtube-action" data-action="video">映像＋音声のみ（MP4）</button>
          <button class="youtube-action" data-action="thumbnail">サムネのみ（1080p）</button>
        </div>`
      : `<button class="save-button ${isManifest ? "secondary" : ""}" data-action="default">${isManifest ? "結合保存" : "保存"}</button>`;
    item.innerHTML = `
      <div class="candidate-main">
        <div class="candidate-title" title="${escapeText(candidate.filename)}">${escapeText(candidate.filename)}</div>
        <div class="candidate-url" title="${escapeText(candidate.url)}">${escapeText(hostname(candidate.url))}</div>
        <div class="tags">
          <span class="tag ${candidate.kind === "fmt" ? "accent" : ""}">${labelFor(candidate.kind)}</span>
          ${candidate.formatId ? `<span class="tag">fmt ${escapeText(candidate.formatId)}</span>` : ""}
          ${candidate.quality ? `<span class="tag">${escapeText(candidate.quality)}</span>` : ""}
        </div>
      </div>
      ${actionMarkup}
    `;
    item.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => handleAction(candidate, button.dataset.action));
    });
    list.appendChild(item);
  });
}

async function handleAction(candidate, action = "default") {
  if (candidate.kind === "youtube") {
    if (action === "thumbnail") {
      const thumbnail = makeThumbnailCandidate(candidate);
      setProgress(null, 0, "サムネイルを保存中");
      chrome.runtime.sendMessage({ type: "downloadCandidate", tabId: activeTabId, candidate: thumbnail }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          $("#download-status").classList.add("hidden");
          showNotice(response?.error || chrome.runtime.lastError?.message || "サムネイルの保存に失敗しました。");
          return;
        }
        if (response.jobId) currentJobId = response.jobId;
        showNotice("1080pサムネイルの保存を開始しました。");
      });
      return;
    }
    const isAudio = action === "audio";
    setProgress(null, 0, isAudio ? "音声をWAVに変換中" : "映像と音声を結合中");
    chrome.runtime.sendMessage({ type: "downloadYoutubeCandidate", downloadType: isAudio ? "audio" : "video", tabId: activeTabId, candidate }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        $("#download-status").classList.add("hidden");
        showNotice(response?.error || chrome.runtime.lastError?.message || "YouTube動画の取得に失敗しました。");
        return;
      }
      if (response.jobId) currentJobId = response.jobId;
      showNotice(isAudio ? "音声のみ（WAV）の保存を開始しました。" : "映像＋音声のみ（MP4）の保存を開始しました。");
    });
    return;
  }
  if (candidate.kind === "manifest") {
    setProgress(null, 0, "ストリームを取得中");
    chrome.runtime.sendMessage({ type: "downloadStreamCandidate", tabId: activeTabId, candidate }, async (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        $("#download-status").classList.add("hidden");
        try { await navigator.clipboard.writeText(candidate.url); } catch { /* URLはエラーメッセージで確認できます */ }
        showNotice(`${response?.error || chrome.runtime.lastError?.message || "結合保存に失敗しました。"}\nストリームURLをコピーしました。`);
        return;
      }
      if (response.jobId) currentJobId = response.jobId;
      showNotice("HLS/DASHの結合保存を開始しました。");
    });
    return;
  }
  setProgress(null, 0, candidate.kind === "thumbnail" ? "サムネイルを保存中" : "動画を保存中");
  chrome.runtime.sendMessage({ type: "downloadCandidate", tabId: activeTabId, candidate }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      $("#download-status").classList.add("hidden");
      showNotice(response?.error || chrome.runtime.lastError?.message || "保存を開始できませんでした。");
      return;
    }
    if (response.jobId) currentJobId = response.jobId;
    showNotice("保存を開始しました。");
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "downloadProgress") {
    if (currentJobId && message.jobId !== currentJobId) return;
    setProgress(message.jobId, message.progress, message.stage);
  }
});

function requestScan() {
  if (!activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, { type: "scan" }, () => void chrome.runtime.lastError);
  window.setTimeout(() => {
    chrome.runtime.sendMessage({ type: "getCandidates", tabId: activeTabId }, (response) => {
      candidates = preferMasterManifest(shapeCandidates(response?.candidates || []));
      render();
    });
  }, 120);
}

$("#refresh").addEventListener("click", requestScan);
$("#clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clearCandidates", tabId: activeTabId }, () => {
    candidates = [];
    render();
  });
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  activeTabId = tabs[0]?.id || null;
  activeTabUrl = tabs[0]?.url || "";
  activeTabTitle = tabs[0]?.title || "";
  requestScan();
});
