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
    step = name;
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
    && before.anchor.top !== null && after.anchor.top !== null
    // Negative horizontal offsets are pdf.js centering margins, which change with page-width zoom.
    && (before.anchor.left < 0 || after.anchor.left < 0 || Math.abs(before.anchor.left - after.anchor.left) <= 2)
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
      await until(() => win.Zotero_Tabs.selectedID === opened?.tabID, "synthetic-reader-tab-selected");
      report.reader.selectedTabMatches = win.Zotero_Tabs.selectedID === opened?.tabID;
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
      let dock = await until(() => readerDoc.querySelector('[data-zchatgptweb-dock]'), "product-reader-dock");
      const shell = await until(() => dock.querySelector('.zchatgptweb-shell'), "product-reader-shell");
      await delay(250);
      report.reader.focusAfterOpen = activeElementSummary(readerDoc);
      report.reader.focusUnchangedByOpen = focusStable(focusBeforeOpen, readerDoc.activeElement, report.reader.focusBeforeOpen, report.reader.focusAfterOpen);
      await check("opening-sidebar-does-not-steal-reader-focus", report.reader.focusUnchangedByOpen, {
        before: report.reader.focusBeforeOpen, after: report.reader.focusAfterOpen,
      });
      await check("sidebar-omits-redundant-paper-and-pdf-headings", !shell.querySelector('.zchatgptweb-shell__paper, .zchatgptweb-shell__pdf, [role="menu"]'));
      const requiredActions = ["Copy paper details", "Copy PDF file", "Return to selected passage", "Bind this conversation", "Reload ChatGPT"];
      const toolbar = shell.querySelector('.zchatgptweb-shell__toolbar');
      const toolbarButtons = Array.from(toolbar?.querySelectorAll('button') ?? []);
      const actualLabels = toolbarButtons.map(button => button.getAttribute('aria-label'));
      const iconStyle = readerDoc.defaultView.getComputedStyle(toolbarButtons[0]?.querySelector('svg'));
      const oneRow = toolbarButtons.every(button => Math.abs(button.getBoundingClientRect().top - toolbarButtons[0].getBoundingClientRect().top) <= 1);
      const iconOnly = toolbarButtons.every(button => button.childElementCount === 1 && !button.textContent.trim()
        && button.title === button.getAttribute('aria-label'));
      const directlyVisible = JSON.stringify(actualLabels) === JSON.stringify(requiredActions)
        && toolbarButtons.every(button => box(button)?.width >= 28 && box(button)?.height >= 28
          && readerDoc.defaultView.getComputedStyle(button).visibility === "visible")
        && iconStyle.width === "16px" && iconStyle.height === "16px" && oneRow && iconOnly
        && !shell.querySelector('.zchatgptweb-shell__brand, .zchatgptweb-shell__button, [aria-label="New ChatGPT chat"], [aria-label="Settings"], [aria-label="Close ChatGPT sidebar"]');
      await check("reader-toolbar-is-one-row-of-icon-only-actions", directlyVisible, {
        expectedActions: requiredActions, actualLabels, iconSize: { width: iconStyle.width, height: iconStyle.height },
        buttonRects: toolbarButtons.map(box), oneRow, iconOnly,
      });
      const grayscale = value => {
        const normalized = String(value).match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
        if (normalized) return Math.abs(Number(normalized[1]) - Number(normalized[2])) < 0.002
          && Math.abs(Number(normalized[2]) - Number(normalized[3])) < 0.002;
        const channels = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return Boolean(channels && channels[1] === channels[2] && channels[2] === channels[3]);
      };
      const toolbarStyle = readerDoc.defaultView.getComputedStyle(toolbarButtons[0]);
      const focusColor = readerDoc.defaultView.getComputedStyle(shell).getPropertyValue('--zchatgptweb-focus').trim();
      const toolbarGrayscale = grayscale(toolbarStyle.color) && grayscale(toolbarStyle.backgroundColor)
        && grayscale(toolbarStyle.borderTopColor) && focusColor === 'CanvasText';
      await check("reader-toolbar-colors-are-grayscale", toolbarGrayscale, {
        color: toolbarStyle.color, background: toolbarStyle.backgroundColor,
        border: toolbarStyle.borderTopColor, focus: focusColor,
      });
      const notice = shell.querySelector('.zchatgptweb-shell__notice:not([hidden])');
      if (notice) {
        const noticeStyle = readerDoc.defaultView.getComputedStyle(notice);
        await check("reader-status-colors-are-grayscale", grayscale(noticeStyle.color) && grayscale(noticeStyle.backgroundColor), {
          color: noticeStyle.color, background: noticeStyle.backgroundColor,
        });
        const recovery = notice.querySelector('button:not([hidden])');
        if (recovery) {
          const recoveryIcon = recovery.querySelector('svg');
          await check("reader-status-recovery-action-is-icon-only", recovery.childElementCount === 1
            && !recovery.textContent.trim() && recovery.title === recovery.getAttribute('aria-label')
            && readerDoc.defaultView.getComputedStyle(recoveryIcon).width === '16px'
            && readerDoc.defaultView.getComputedStyle(recoveryIcon).height === '16px', {
            labelPresent: Boolean(recovery.getAttribute('aria-label')),
            titleMatchesLabel: recovery.title === recovery.getAttribute('aria-label'),
          });
        }
      }
      await check("product-sidebar-is-mounted-in-reader-dock", dock.contains(shell) && dock.getAttribute("aria-label") === "ChatGPT Web");

      const resizer = dock.querySelector('[data-zchatgptweb-resizer]');
      const handleRect = box(resizer);
      const handleStyle = readerDoc.defaultView.getComputedStyle(resizer);
      await check("resize-handle-has-a-visible-hit-area", handleRect?.width >= 6 && handleRect?.height > 100
        && handleStyle.cursor === "col-resize" && handleStyle.touchAction === "none", { rect: handleRect, cursor: handleStyle.cursor });
      const beforeDrag = actualWidth(dock).rectCss;
      const beforeDragAnchor = pdfAnchor(pdfReader);
      resizer.dispatchEvent(new readerDoc.defaultView.PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true, pointerId: 71, clientX: handleRect.x + 4 }));
      readerDoc.dispatchEvent(new readerDoc.defaultView.PointerEvent("pointermove", { bubbles: true, button: 0, isPrimary: true, pointerId: 71, clientX: handleRect.x - 76 }));
      readerDoc.dispatchEvent(new readerDoc.defaultView.PointerEvent("pointerup", { bubbles: true, button: 0, isPrimary: true, pointerId: 71, clientX: handleRect.x - 76 }));
      await delay(350);
      const afterDrag = actualWidth(dock).rectCss;
      await check("pointer-resize-changes-and-persists-sidebar-width", afterDrag === beforeDrag + 80
        && Zotero.Prefs.get("extensions.zchatgptweb.sidebarWidth", true) === beforeDrag + 80
        && samePdfAnchor(beforeDragAnchor, pdfAnchor(pdfReader)), { before: beforeDrag, after: afterDrag, events: "synthetic-pointer" });

      resizer.dispatchEvent(new readerDoc.defaultView.KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
      await delay(350);
      await check("keyboard-resize-keeps-the-reader-accessible", actualWidth(dock).rectCss === afterDrag + 16, { before: afterDrag, after: actualWidth(dock).rectCss });

      const embed = await until(() => win.document.querySelector('[data-zchatgptweb-embed-browser]'), "product-official-chat-browser", 10000);
      await check("official-page-context-is-bound-to-current-pdf", embed.getAttribute("data-zchatgptweb-context-binding") === `${attachments[0].libraryID}:${attachments[0].key}`);
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
      const usableReadiness = new Set(["ready", "draft", "composer-ready"]);
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
      report.reader.horizontalAnchorStatus = beforeAnchor.anchor.left < 0 || afterAnchor.anchor.left < 0 ? "NOT RUN" : "PASS";
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
        dock = await until(() => readerDoc.querySelector('[data-zchatgptweb-dock]'), `new-dock-at-width-${requestedWidth}`);
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
        const currentShell = dock.querySelector('.zchatgptweb-shell');
        const shellBounds = currentShell?.getBoundingClientRect();
        const widthButtons = Array.from(currentShell?.querySelectorAll('.zchatgptweb-shell__toolbar button') ?? []).filter(button => !button.hidden);
        const actionsFit = Boolean(shellBounds) && widthButtons.length === requiredActions.length && widthButtons.every(button => {
          const bounds = button.getBoundingClientRect();
          return bounds.width >= 24 && bounds.height >= 24 && bounds.left >= shellBounds.left - 1 && bounds.right <= shellBounds.right + 1;
        });
        await check(`visible-actions-fit-sidebar-width-${requestedWidth}`, actionsFit, { buttons: widthButtons.length });
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
      // Exercise the final XPI's editor helper in Gecko with synthetic text only. This is
      // insertion evidence, not an official send/answer acceptance check.
      const dom = ChromeUtils.importESModule("resource://zotero-chatgpt-web-plugin/chatgpt-dom.mjs");
      const syntheticEditor = readerDoc.createElement("div");
      syntheticEditor.id = "prompt-textarea";
      syntheticEditor.className = "ProseMirror";
      syntheticEditor.setAttribute("contenteditable", "true");
      syntheticEditor.style.cssText = "position:fixed;left:-10000px;top:0;width:400px;white-space:pre-wrap";
      syntheticEditor.innerHTML = "<p><br></p>";
      const syntheticForm = readerDoc.createElement("form");
      syntheticForm.append(syntheticEditor);
      readerDoc.body.append(syntheticForm);
      const beforeEditorFocus = readerDoc.activeElement;
      const syntheticText = "Synthetic question\n\nSelected passage\nA synthetic paragraph.\n\n[synthetic insertion receipt]";
      try {
        const inserted = dom.replaceChatGPTComposer(syntheticEditor, syntheticText);
        await check("final-xpi-rich-editor-multiline-insertion-in-gecko", inserted && dom.sameRenderedText(dom.readChatGPTComposer(syntheticEditor), syntheticText));
        await check("rendered-text-verification-preserves-word-spacing", !dom.sameRenderedText("a b", "ab"));
        // Real Gecko DOM selectors with a synthetic origin/view wrapper, never the remote page.
        const syntheticView = {};
        syntheticView.top = syntheticView;
        const syntheticDocument = { location: { href: "https://chatgpt.com/" }, defaultView: syntheticView };
        const send = readerDoc.createElement("button");
        send.id = "composer-submit-button";
        send.type = "submit";
        syntheticForm.append(send);
        await check("final-xpi-id-only-send-control-in-native-dom", dom.isKnownSendControl(send)
          && dom.inspectChatGPTSendControl(syntheticDocument, syntheticEditor).control === send);
        const duplicate = readerDoc.createElement("button");
        duplicate.setAttribute("aria-label", "Send message");
        syntheticForm.append(duplicate);
        await check("final-xpi-ambiguous-send-controls-remain-blocked", dom.inspectChatGPTSendControl(syntheticDocument, syntheticEditor).status === "ambiguous-send");
        duplicate.remove();
        send.remove();
        await check("final-xpi-missing-send-control-remains-blocked", dom.inspectChatGPTSendControl(syntheticDocument, syntheticEditor).status === "missing");
      } finally {
        syntheticForm.remove();
        if (beforeEditorFocus?.isConnected) beforeEditorFocus.focus();
      }
      report.status = report.page.status === "PASS" ? "PASS" : "BLOCKED";
      report.reader.mainViewport = { width: win.innerWidth, height: win.innerHeight };
      report.reader.finalTabMatches = win.Zotero_Tabs.selectedID === opened?.tabID;
      const currentEmbed = win.document.querySelector('[data-zchatgptweb-embed-browser][data-zchatgptweb-embed-painted]:not([data-zchatgptweb-embed-painted=""])');
      report.reader.finalChatBrowser = box(currentEmbed);
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
