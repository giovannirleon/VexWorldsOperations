// ==UserScript==
// @name         RobotEvents Check-In Sync
// @namespace    worldscheckin
// @version      0.1.0
// @description  Downloads the checked-in report from RobotEvents in your authenticated browser session and uploads it to Worlds Check-In.
// @match        https://www.robotevents.com/admin/eventEntities/*/checkIn*
// @match        https://robotevents.com/admin/eventEntities/*/checkIn*
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/* global XLSX */

(function () {
  "use strict";

  const CONFIG = {
    backendBaseUrl: "http://10.35.5.162:4000",
    syncToken: "test",
    syncEveryMs: 5 * 60 * 1000,
    syncOnPageLoad: true,
    syncOnWindowFocus: false,
    debug: true,
  };

  const state = {
    isSyncing: false,
    intervalId: null,
    statusNode: null,
  };

  function log(...args) {
    if (CONFIG.debug) {
      console.log("[RobotEvents Sync]", ...args);
    }
  }

  function getBackendBaseUrl() {
    return String(CONFIG.backendBaseUrl || "").replace(/\/$/, "");
  }

  function getRobotEventsEventId() {
    const match = window.location.pathname.match(
      /\/admin\/eventEntities\/(\d+)\/checkIn/i,
    );

    return match ? match[1] : null;
  }

  function buildReportUrl(robotEventsEventId) {
    return `${window.location.origin}/admin/eventEntities/${robotEventsEventId}/checkIn/checkedInReport`;
  }

  function getToneColors(tone) {
    if (tone === "success") {
      return {
        background: "#dcfce7",
        color: "#166534",
        border: "#86efac",
      };
    }

    if (tone === "error") {
      return {
        background: "#fee2e2",
        color: "#991b1b",
        border: "#fca5a5",
      };
    }

    return {
      background: "#e2e8f0",
      color: "#0f172a",
      border: "#cbd5e1",
    };
  }

  function ensureStatusNode() {
    if (state.statusNode) {
      return state.statusNode;
    }

    const node = document.createElement("div");
    node.style.position = "fixed";
    node.style.right = "16px";
    node.style.bottom = "16px";
    node.style.zIndex = "2147483647";
    node.style.maxWidth = "360px";
    node.style.padding = "12px 14px";
    node.style.borderRadius = "14px";
    node.style.border = "1px solid #cbd5e1";
    node.style.background = "#e2e8f0";
    node.style.color = "#0f172a";
    node.style.fontFamily =
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    node.style.fontSize = "13px";
    node.style.lineHeight = "1.45";
    node.style.boxShadow = "0 18px 50px rgba(15, 23, 42, 0.18)";
    node.textContent = "RobotEvents sync ready.";
    document.body.appendChild(node);
    state.statusNode = node;
    return node;
  }

  function setStatus(message, tone = "info") {
    const node = ensureStatusNode();
    const colors = getToneColors(tone);

    node.textContent = message;
    node.style.background = colors.background;
    node.style.color = colors.color;
    node.style.borderColor = colors.border;
  }

  function validateConfig() {
    if (!getBackendBaseUrl()) {
      throw new Error("Set CONFIG.backendBaseUrl in the Tampermonkey script.");
    }

    if (!CONFIG.syncToken || CONFIG.syncToken === "replace-me") {
      throw new Error("Set CONFIG.syncToken in the Tampermonkey script.");
    }
  }

  function looksLikeChallengeOrLogin(text) {
    const normalizedText = String(text || "").toLowerCase();

    return (
      normalizedText.includes("just a moment") ||
      normalizedText.includes("performing security verification") ||
      normalizedText.includes("verify you are human") ||
      normalizedText.includes("enable javascript and cookies to continue") ||
      normalizedText.includes("security service to protect against malicious bots") ||
      normalizedText.includes("sign in") ||
      normalizedText.includes("login")
    );
  }

  function looksLikeCsv(text) {
    const normalizedText = String(text || "");
    return normalizedText.includes(",") && normalizedText.includes("\n");
  }

  function looksLikeZipWorkbook(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer.slice(0, 4));
    return (
      bytes.length === 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    );
  }

  function decodeText(arrayBuffer) {
    return new TextDecoder("utf-8").decode(arrayBuffer);
  }

  function workbookArrayBufferToCsv(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      throw new Error("Workbook did not contain any sheets.");
    }

    const firstSheet = workbook.Sheets[firstSheetName];
    const csvText = XLSX.utils.sheet_to_csv(firstSheet);

    if (!looksLikeCsv(csvText)) {
      throw new Error("Workbook sheet did not convert into recognizable CSV text.");
    }

    return csvText;
  }

  async function fetchReportCsv(robotEventsEventId) {
    const reportUrl = buildReportUrl(robotEventsEventId);
    const response = await fetch(reportUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "text/csv,application/csv,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    const arrayBuffer = await response.arrayBuffer();
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const contentDisposition = String(
      response.headers.get("content-disposition") || "",
    ).toLowerCase();

    if (!response.ok) {
      throw new Error(`Report request failed with status ${response.status}.`);
    }

    log("Report response", {
      status: response.status,
      contentType,
      contentDisposition,
      byteLength: arrayBuffer.byteLength,
    });

    const isWorkbookResponse =
      looksLikeZipWorkbook(arrayBuffer) ||
      contentType.includes(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ) ||
      contentDisposition.includes(".xlsx");

    const csvText = isWorkbookResponse
      ? workbookArrayBufferToCsv(arrayBuffer)
      : decodeText(arrayBuffer);

    if (looksLikeChallengeOrLogin(csvText)) {
      throw new Error(
        "RobotEvents returned a Cloudflare or login challenge instead of CSV data.",
      );
    }

    if (!looksLikeCsv(csvText)) {
      throw new Error("RobotEvents report response did not look like CSV data.");
    }

    return {
      reportUrl,
      csvText,
    };
  }

  function uploadCsvToBackend(robotEventsEventId, csvText, reportUrl) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `${getBackendBaseUrl()}/api/events/robotevents/${robotEventsEventId}/checkin-csv-upload`,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONFIG.syncToken}`,
        },
        data: JSON.stringify({
          csvText,
          reportUrl,
          uploadedAt: new Date().toISOString(),
        }),
        onload(response) {
          let payload = null;

          try {
            payload = JSON.parse(response.responseText);
          } catch (_error) {
            payload = null;
          }

          if (response.status < 200 || response.status >= 300) {
            const message =
              payload?.details ||
              payload?.error ||
              `Backend upload failed with status ${response.status}.`;
            reject(new Error(message));
            return;
          }

          resolve(payload);
        },
        onerror() {
          reject(new Error("Network error while uploading CSV to backend."));
        },
        ontimeout() {
          reject(new Error("Timed out while uploading CSV to backend."));
        },
      });
    });
  }

  async function runSync(reason) {
    if (state.isSyncing) {
      log("Skipping sync because one is already in progress.");
      return;
    }

    const robotEventsEventId = getRobotEventsEventId();

    if (!robotEventsEventId) {
      return;
    }

    try {
      validateConfig();
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }

    state.isSyncing = true;
    setStatus(`Syncing checked-in report (${reason})...`, "info");

    try {
      const { csvText, reportUrl } = await fetchReportCsv(robotEventsEventId);
      log("Converted CSV preview", csvText.slice(0, 300));
      const payload = await uploadCsvToBackend(
        robotEventsEventId,
        csvText,
        reportUrl,
      );
      const syncedCount = Number(payload?.syncedTeamCount ?? 0);

      setStatus(
        `Synced ${syncedCount} teams at ${new Date().toLocaleTimeString()}.`,
        "success",
      );
      log("Sync completed", payload);
    } catch (error) {
      setStatus(error.message || "Sync failed.", "error");
      log("Sync failed", error);
    } finally {
      state.isSyncing = false;
    }
  }

  function startIntervalSync() {
    if (state.intervalId) {
      window.clearInterval(state.intervalId);
    }

    if (CONFIG.syncEveryMs <= 0) {
      return;
    }

    state.intervalId = window.setInterval(() => {
      runSync("interval").catch(() => {});
    }, CONFIG.syncEveryMs);
  }

  GM_registerMenuCommand("Sync RobotEvents check-in now", () => {
    runSync("menu").catch(() => {});
  });

  ensureStatusNode();

  if (CONFIG.syncOnPageLoad) {
    runSync("page-load").catch(() => {});
  }

  if (CONFIG.syncOnWindowFocus) {
    window.addEventListener("focus", () => {
      runSync("focus").catch(() => {});
    });
  }

  startIntervalSync();
})();
