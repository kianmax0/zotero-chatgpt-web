/* global Zotero, ChromeUtils, PathUtils, IOUtils, Services, URL */
// Isolated, read-only UI inspection. This driver never reads ChatGPT page text or submits a request.
function runHostInspection(config) {
  const delay = ms => Zotero.Promise.delay(ms);
  const report = {
    schemaVersion: 1,
    runId: config.runId,
    status: "NOT RUN",
    startedAt: new Date().toISOString(),
    build: { product: config.product, driverSourceSha256: config.driverSourceSha256 },
    environment: {},
    synthetic: { parent: null, attachments: [] },
    reader: {},
    page: { status: "NOT RUN", origin: null },
    checks: [],
    notRun: ["login", "ChatGPT question", "answer inspection", "resizing the Zotero window to 360/480/720 CSS px"],
  };
  let step = "startup";
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  const until = async (predicate, label, timeout = 20000) => {
    step = label;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = await predicate();
      if (value) return value;
      await delay(50);
    }
    throw new Error(`Timed out at ${label}`);
  };
  const check = async (name, ok, details = {}) => {
    report.checks.push({ name, status: ok ? "PASS" : "FAIL", details });
    await save();
    if (!ok) throw new Error(`Check failed: ${name}`);
  };
  const box = element => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  };
  const activeElementSummary = doc => {
    const active = doc?.activeElement;
    return {
      present: Boolean(active),
      tag: active?.localName ?? null,
      insideDock: Boolean(active?.closest?.("[data-zchatgptweb-dock]")),
      hasFocus: Boolean(doc?.hasFocus?.()),
    };
  };
  const focusStable = (before, after, beforeSummary, afterSummary) => {
    if (afterSummary.insideDock) return false;
    // A just-opened Reader can shift from its body to its PDF iframe without the plugin taking focus.
    if (!beforeSummary.hasFocus || String(before?.localName || '').toLowerCase() === 'body') return true;
    return before === after;
  };
  const pdfAnchor = reader => {
    const viewer = reader?._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.pdfViewer;
    const container = viewer?.container;
    const location = viewer?._location;
    return {
      page: Number.isFinite(viewer?.currentPageNumber) ? viewer.currentPageNumber : null,
      scale: Number.isFinite(viewer?.currentScale) ? Math.round(viewer.currentScale * 1000) / 1000 : null,
      anchor: {
        page: Number.isFinite(location?.pageNumber) ? location.pageNumber : null,
        left: Number.isFinite(location?.left) ? Math.round(location.left * 100) / 100 : null,
        top: Number.isFinite(location?.top) ? Math.round(location.top * 100) / 100 : null,
      },
      scrollTop: Number.isFinite(container?.scrollTop) ? Math.round(container.scrollTop) : null,
      scrollLeft: Number.isFinite(container?.scrollLeft) ? Math.round(container.scrollLeft) : null,
    };
  };
  const samePdfAnchor = (before, after) => before.page === after.page
    && before.anchor.page === after.anchor.page
    && before.anchor.left !== null && after.anchor.left !== null
    && before.anchor.top !== null && after.anchor.top !== null
    && Math.abs(before.anchor.left - after.anchor.left) <= 2
    && Math.abs(before.anchor.top - after.anchor.top) <= 2;
  const actualWidth = dock => {
    const rectWidth = dock?.getBoundingClientRect?.().width ?? 0;
    const inlineWidth = Number.parseFloat(dock?.style?.width ?? "");
    return {
      inlineCss: Number.isFinite(inlineWidth) ? Math.round(inlineWidth) : null,
      rectCss: Number.isFinite(rectWidth) ? Math.round(rectWidth) : null,
    };
  };
  const noticeCategory = shell => {
    const notice = shell?.querySelector('[role="alert"], [role="status"]');
    const text = String(notice?.textContent ?? "").toLowerCase();
    if (!text) return "empty";
    if (text.includes("loading")) return "loading";
    if (text.includes("sign in")) return "login-required";
    if (text.includes("verification")) return "challenge-required";
    if (text.includes("editor") || text.includes("composer")) return "composer-unavailable";
    if (text.includes("send control")) return "send-control-unavailable";
    if (text.includes("accepted")) return "accepted";
    return "plugin-status-present";
  };

  return (async () => {
    // Do not overwrite a prior report or seed a second synthetic library after a restart.
    if (await IOUtils.exists(config.reportPath)) return;
    await save();
    try {
      await Zotero.initializationPromise;
      const profilePath = String(PathUtils.profileDir);
      const dataPath = String(Zotero.DataDirectory.dir);
      report.environment = { zoteroVersion: Zotero.version, profileBound: profilePath === config.profile, dataBound: dataPath === config.data };
      await check("dedicated-profile-and-data-binding", report.environment.profileBound && report.environment.dataBound);

      const actualProductHash = await IOUtils.computeHexDigest(config.installedProductPath, "sha256");
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const productAddon = await AddonManager.getAddonByID(config.product.addonId);
      await check("final-product-xpi-is-active-and-hash-bound", Boolean(productAddon?.isActive && productAddon.version === config.product.version && actualProductHash === config.product.sha256), {
        active: Boolean(productAddon?.isActive), versionMatches: productAddon?.version === config.product.version, hashMatches: actualProductHash === config.product.sha256,
      });

      const win = await until(() => Zotero.getMainWindow(), "main-window");
      await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, "library-ready");
      await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad("item");
      const parent = new Zotero.Item("journalArticle");
      parent.libraryID = Zotero.Libraries.userLibraryID;
      parent.setField("title", "Synthetic Zotero ChatGPT Web reader host test");
      parent.setField("date", "2026");
      parent.setField("DOI", "10.0000/zotero-chatgpt-web.synthetic");
      parent.setField("abstractNote", "Synthetic abstract for isolated Reader host validation. No real publication data.");
      parent.setCreators([{ firstName: "Synthetic", lastName: "Author", creatorType: "author" }]);
      const queue = new Zotero.Notifier.Queue();
      await parent.saveTx({ notifierQueue: queue });
      const attachments = [];
      for (const fixture of config.fixtures) {
        const item = await Zotero.Attachments.importFromFile({
          file: fixture.filename,
          parentItemID: parent.id,
          title: fixture.title,
          saveOptions: { notifierQueue: queue },
        });
        attachments.push(item);
      }
      await Promise.all([parent.loadAllData(), ...attachments.map(item => item.loadAllData())]);
      await Zotero.Notifier.commit(queue);
      report.synthetic.parent = { key: parent.key, type: parent.itemType, title: parent.getField("title"), attachmentCount: attachments.length };
      report.synthetic.attachments = attachments.map((item, index) => ({
        key: item.key,
        id: item.id,
        parentID: item.parentID,
        filename: config.fixtures[index].filename.split(/[\\/]/u).at(-1),
        title: item.getField("title"),
        sha256: config.fixtures[index].sha256,
      }));
      await check("two-synthetic-pdfs-share-one-parent", attachments.length === 2 && attachments.every(item => item.parentID === parent.id), {
        count: attachments.length, sharedParent: attachments.every(item => item.parentID === parent.id),
      });

      await win.Zotero_Tabs.closeAll();
      await until(() => Zotero.Reader._readers.length === 0, "empty-dedicated-reader");
      const opened = await Zotero.Reader.open(attachments[0].id);
      const reader = () => Zotero.Reader.getByTabID(opened?.tabID);
      const readerDocument = () => reader()?._iframeWindow?.document;
      const readerDoc = await until(() => readerDocument(), "reader-document");
      const pdfReader = await until(() => reader(), "reader-api");
      await until(() => {
        const anchor = pdfAnchor(pdfReader);
        return anchor.page !== null && anchor.anchor.page !== null && anchor.anchor.left !== null && anchor.anchor.top !== null;
      }, "initial-pdf-anchor");
      report.reader.before = {
        attachmentID: pdfReader?.itemID ?? null,
        pageAnchor: pdfAnchor(pdfReader),
        viewport: { width: readerDoc.defaultView?.innerWidth ?? null, height: readerDoc.defaultView?.innerHeight ?? null },
        activeElement: activeElementSummary(readerDoc),
      };
      await check("reader-opens-first-attachment-from-synthetic-parent", pdfReader?.itemID === attachments[0].id, {
        itemMatches: pdfReader?.itemID === attachments[0].id,
        attachmentCountOnParent: attachments.length,
      });

      const toggle = await until(() => readerDoc.querySelector('[data-zchatgptweb-toggle]'), "product-reader-toolbar-toggle");
      const focusBeforeOpen = readerDoc.activeElement;
      report.reader.focusBeforeOpen = activeElementSummary(readerDoc);
      toggle.click();
      const dock = await until(() => readerDoc.querySelector('[data-zchatgptweb-dock]'), "product-reader-dock");
      const shell = await until(() => dock.querySelector('.zchatgptweb-shell'), "product-reader-shell");
      await delay(250);
      report.reader.focusAfterOpen = activeElementSummary(readerDoc);
      report.reader.focusUnchangedByOpen = focusStable(focusBeforeOpen, readerDoc.activeElement, report.reader.focusBeforeOpen, report.reader.focusAfterOpen);
      await check("opening-sidebar-does-not-steal-reader-focus", report.reader.focusUnchangedByOpen, {
        before: report.reader.focusBeforeOpen, after: report.reader.focusAfterOpen,
      });
      const identity = shell.querySelector('.zchatgptweb-shell__identity');
      const paperLabel = identity?.querySelector('.zchatgptweb-shell__paper')?.textContent?.trim() ?? "";
      const pdfLabel = identity?.querySelector('.zchatgptweb-shell__pdf')?.textContent?.trim() ?? "";
      const expectedPaper = parent.getField("title");
      const expectedPdf = attachments[0].getField("title");
      const identityBound = paperLabel === expectedPaper && pdfLabel === expectedPdf;
      await check("product-shell-identifies-current-paper-and-pdf", identityBound, { paperMatches: paperLabel === expectedPaper, pdfMatches: pdfLabel === expectedPdf });
      await check("product-sidebar-is-mounted-in-reader-dock", dock.contains(shell) && dock.getAttribute("aria-label") === "ChatGPT Web");

      const embed = await until(() => win.document.querySelector('[data-zchatgptweb-embed-browser]'), "product-official-chat-browser", 10000);
      const navigationStarted = Date.now();
      while (embed.getAttribute("data-zchatgptweb-embed-state") === "idle" && Date.now() - navigationStarted < 10000) await delay(100);
      const readinessStates = new Set([
        "checking", "loading", "ready", "draft", "composer-ready", "generating", "busy",
        "login-required", "challenge-required", "unsupported-composer", "ambiguous-composer",
        "unsupported-send", "ambiguous-send", "composer-missing", "submit-missing",
        "auth-navigation", "restoring",
      ]);
      const readiness = () => {
        const value = String(embed.getAttribute("data-zchatgptweb-bridge-ready") ?? "unknown");
        return readinessStates.has(value) ? value : "unknown";
      };
      const usableReadiness = new Set(["ready", "draft"]);
      const terminalReadiness = new Set([
        "login-required", "challenge-required", "unsupported-composer", "ambiguous-composer",
        "unsupported-send", "ambiguous-send", "composer-missing", "submit-missing", "auth-navigation",
      ]);
      const readinessStarted = Date.now();
      let actorReadiness = readiness();
      while (!usableReadiness.has(actorReadiness) && !terminalReadiness.has(actorReadiness) && Date.now() - readinessStarted < 30000) {
        await delay(250);
        actorReadiness = readiness();
      }
      let origin = null;
      try { origin = new URL(String(embed.currentURI?.spec ?? "about:blank")).origin; } catch {}
      const rawEmbedState = String(embed.getAttribute("data-zchatgptweb-embed-state") ?? "unknown");
      const embedState = ["idle", "loading", "loaded"].includes(rawEmbedState) ? rawEmbedState : "unknown";
      const officialOrigin = origin === "https://chatgpt.com";
      report.page = {
        status: officialOrigin && usableReadiness.has(actorReadiness) ? "PASS" : "BLOCKED",
        embedState,
        actorReadiness,
        actorWaitMs: Date.now() - readinessStarted,
        origin: officialOrigin ? origin : null,
        notice: noticeCategory(shell),
      };
      report.checks.push({
        name: "official-page-actor-readiness",
        status: report.page.status,
        details: { actorReadiness, officialOrigin, embedState },
      });
      await save();

      const beforeAnchor = report.reader.before.pageAnchor;
      const afterAnchor = pdfAnchor(pdfReader);
      report.reader.after = {
        attachmentID: pdfReader?.itemID ?? null,
        pageAnchor: afterAnchor,
        activeElement: activeElementSummary(readerDoc),
      };
      report.reader.anchorPreserved = samePdfAnchor(beforeAnchor, afterAnchor);
      await check("opening-sidebar-preserves-pdf-page-anchor", report.reader.anchorPreserved, { before: beforeAnchor, after: afterAnchor });
      report.reader.dock = {
        rect: box(dock),
        ...actualWidth(dock),
        availableWidthCss: readerDoc.defaultView?.innerWidth ?? null,
      };
      report.reader.theme = {
        prefersDark: Boolean(readerDoc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches),
        background: readerDoc.defaultView?.getComputedStyle(dock).backgroundColor ?? null,
        foreground: readerDoc.defaultView?.getComputedStyle(dock).color ?? null,
      };
      report.reader.chatBrowser = box(embed);

      report.reader.sidebarWidthSamples = [];
      const widthPreference = "extensions.zchatgptweb.sidebarWidth";
      for (const requestedWidth of [360, 480, 720]) {
        const beforeWidthAnchor = pdfAnchor(pdfReader);
        const focusBeforeResize = readerDoc.activeElement;
        const focusBeforeResizeSummary = activeElementSummary(readerDoc);
        Zotero.Prefs.set(widthPreference, requestedWidth, true);
        toggle.click();
        await until(() => toggle.getAttribute("aria-pressed") === "false", `close-before-width-${requestedWidth}`);
        await delay(100);
        toggle.click();
        await until(() => toggle.getAttribute("aria-pressed") === "true", `reopen-at-width-${requestedWidth}`);
        await until(() => {
          const width = actualWidth(dock);
          return width.rectCss !== null && width.rectCss > 0;
        }, `width-painted-${requestedWidth}`);
        await delay(350);
        const availableWidth = readerDoc.defaultView?.innerWidth ?? 0;
        const maximum = Math.max(0, Math.floor(availableWidth - 360));
        const minimum = Math.min(320, maximum);
        const expectedClamped = Math.min(Math.max(requestedWidth, minimum), Math.max(minimum, maximum));
        const width = actualWidth(dock);
        const afterWidthAnchor = pdfAnchor(pdfReader);
        const focusAfterResize = readerDoc.activeElement;
        const focusPreserved = focusStable(focusBeforeResize, focusAfterResize, focusBeforeResizeSummary, activeElementSummary(readerDoc));
        const clampMatched = width.inlineCss === expectedClamped;
        const anchorPreserved = samePdfAnchor(beforeWidthAnchor, afterWidthAnchor);
        report.reader.sidebarWidthSamples.push({
          requestedCss: requestedWidth,
          expectedClampedCss: expectedClamped,
          inlineCss: width.inlineCss,
          actualRectCss: width.rectCss,
          availableViewportCss: availableWidth,
          clampMatched,
          anchorPreserved,
          focusPreserved,
        });
        await check(`sidebar-width-${requestedWidth}-sample-clamps-and-preserves-anchor-focus`, clampMatched && anchorPreserved && focusPreserved, {
          requestedCss: requestedWidth, expectedClampedCss: expectedClamped,
          actualRectCss: width.rectCss, availableViewportCss: availableWidth,
          clampMatched, anchorPreserved, focusPreserved,
        });
      }
      report.status = report.page.status === "PASS" ? "PASS" : "BLOCKED";
      report.finishedAt = new Date().toISOString();
      await save();
    } catch (error) {
      report.status = "FAIL";
      report.failedStep = step;
      report.errorKind = String(error?.name ?? "Error").slice(0, 80);
      report.finishedAt = new Date().toISOString();
      await save();
    }
  })();
}
