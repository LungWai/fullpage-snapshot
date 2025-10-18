// Orchestrates full-page capture by scrolling and stitching in the editor page.

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content_script.js']
    });
  } catch (e) {
    // Ignore if already injected or cannot inject due to page restrictions.
    console.log('Content script injection note:', e.message);
  }
}

async function queryTab(tabId) {
  const all = await chrome.tabs.query({});
  return all.find(t => t.id === tabId);
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    console.error('Failed to send message to tab:', e);
    throw e;
  }
}

async function sendToTabWithTimeout(tabId, message, timeoutMs = 5000) {
  return await Promise.race([
    sendToTab(tabId, message),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout waiting for ${message.type}`)), timeoutMs)
    )
  ]);
}

async function captureVisible(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

async function startFullPageCapture(tabId, options = {}) {
  let keepalivePort = null;
  try {
    const tab = await queryTab(tabId);
    if (!tab) {
      console.error('Tab not found:', tabId);
      throw new Error('Tab not found');
    }
    
    // Check if the page can be captured
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || 
        tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      throw new Error('Cannot capture browser internal pages');
    }
    
    // Ensure the target tab is active so captureVisibleTab grabs the correct tab
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (e) {
      console.log('Could not focus/activate tab:', e.message);
    }
    
    await ensureContentScriptInjected(tabId);
    
    // Wait a bit for content script to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Keep service worker alive during capture (prevents MV3 suspension)
    try {
      keepalivePort = chrome.tabs.connect(tabId, { name: 'capture-keepalive' });
    } catch (e) {
      console.log('Could not create keepalive port:', e.message);
    }
    
    let metrics;
    try {
      metrics = await sendToTabWithTimeout(tabId, { type: 'CAPTURE_GET_METRICS' });
    } catch (e) {
      console.error('Failed to get metrics, retrying...', e);
      // Retry once after re-injecting
      await ensureContentScriptInjected(tabId);
      await new Promise(resolve => setTimeout(resolve, 200));
      metrics = await sendToTabWithTimeout(tabId, { type: 'CAPTURE_GET_METRICS' });
    }
    
    const { totalHeight, viewportHeight, devicePixelRatio, scrollX, scrollY } = metrics;
    
    // Hide fixed elements for cleaner capture
    let hiddenCount = 0;
    try {
      const hideResult = await sendToTabWithTimeout(tabId, { type: 'CAPTURE_HIDE_FIXED' });
      hiddenCount = hideResult.hiddenCount || 0;
    } catch (e) {
      console.log('Could not hide fixed elements:', e);
    }
    
    // Calculate scroll positions with overlap to handle fixed elements
    const overlap = Math.floor(viewportHeight * 0.1); // 10% overlap
    const step = viewportHeight - overlap;
    const yPositions = [];
    let y = 0;
    
    while (y < totalHeight) {
      yPositions.push(y);
      y += step;
    }
    
    // Ensure we capture the very bottom
    const lastY = Math.max(0, totalHeight - viewportHeight);
    if (yPositions.length === 0 || yPositions[yPositions.length - 1] < lastY) {
      yPositions.push(lastY);
    }

    const segments = [];
    for (let i = 0; i < yPositions.length; i++) {
      const targetY = Math.max(0, Math.min(yPositions[i], totalHeight - viewportHeight));
      
      try {
        // Re-focus and activate target tab before each segment capture
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(tabId, { active: true });
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (e) {
          console.log('Re-activation before segment failed:', e.message);
        }
        
        await sendToTabWithTimeout(tabId, { type: 'CAPTURE_SCROLL_TO', y: targetY, settleMs: 300 }, 6000);
        // Extra wait for complex pages
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const dataUrl = await captureVisible(tab.windowId);
        segments.push({ dataUrl, y: targetY });
      } catch (e) {
        console.error(`Failed to capture segment at position ${targetY}:`, e);
        // Continue with other segments
      }
    }
    
    // Restore fixed elements if they were hidden
    if (hiddenCount > 0) {
      try {
        await sendToTabWithTimeout(tabId, { type: 'CAPTURE_RESTORE_FIXED' });
      } catch (e) {
        console.log('Could not restore fixed elements:', e);
      }
    }

    // Restore original scroll position
    try {
      await sendToTabWithTimeout(tabId, { type: 'CAPTURE_RESTORE_SCROLL', scrollX, scrollY });
    } catch (e) {
      console.log('Could not restore scroll position:', e);
    }
    
    if (segments.length === 0) {
      throw new Error('No segments were captured successfully');
    }

    // Store in local storage and open the editor (if not in batch mode).
    const captureData = { 
      metrics, 
      segments, 
      createdAt: Date.now(),
      tabTitle: tab.title || 'capture',
      tabUrl: tab.url || ''
    };
    
    await chrome.storage.local.set({ latestCapture: captureData });

    // Always open editor after capture unless explicitly disabled
    if (!options.skipEditor) {
      const url = chrome.runtime.getURL('editor.html');
      // Small delay to ensure storage is written
      await new Promise(resolve => setTimeout(resolve, 100));
      await chrome.tabs.create({ url });
    }
    
    return captureData;
  } catch (error) {
    console.error('Full page capture failed:', error);
    
    // Try to at least capture the visible viewport
    try {
      const tab = await queryTab(tabId);
      if (tab) {
        // Ensure correct tab is active for fallback capture
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(tabId, { active: true });
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (e) {
          console.log('Could not focus/activate tab for fallback:', e.message);
        }
        const dataUrl = await captureVisible(tab.windowId);
        const fallbackCapture = {
          metrics: {
            totalWidth: tab.width || 1920,
            totalHeight: tab.height || 1080,
            viewportWidth: tab.width || 1920,
            viewportHeight: tab.height || 1080,
            devicePixelRatio: 1
          },
          segments: [{ dataUrl, y: 0 }],
          createdAt: Date.now(),
          tabTitle: tab.title || 'capture',
          tabUrl: tab.url || '',
          isFallback: true
        };
        
        await chrome.storage.local.set({ latestCapture: fallbackCapture });
        
        if (!options?.skipEditor) {
          const url = chrome.runtime.getURL('editor.html');
          await chrome.tabs.create({ url });
        }
        
        return fallbackCapture;
      }
    } catch (fallbackError) {
      console.error('Fallback capture also failed:', fallbackError);
    }
    
    throw error;
  } finally {
    // Always disconnect keepalive port
    if (keepalivePort) {
      try { keepalivePort.disconnect(); } catch {}
    }
  }
}

async function startBatchCapture(tabIds) {
  const captures = [];
  const errors = [];
  
  for (let i = 0; i < tabIds.length; i++) {
    try {
      const captureData = await startFullPageCapture(tabIds[i], { skipEditor: true });
      if (captureData) {
        captures.push(captureData);
      }
    } catch (e) {
      console.error(`Failed to capture tab ${tabIds[i]}:`, e);
      errors.push({ tabId: tabIds[i], error: e.message });
    }
  }
  
  // Store all captures and open editor once
  if (captures.length > 0) {
    await chrome.storage.local.set({ 
      batchCaptures: captures,
      latestCapture: captures[captures.length - 1] // Set last one as latest
    });
    
    const url = chrome.runtime.getURL('editor.html?batch=true');
    await chrome.tabs.create({ url });
  } else if (errors.length > 0) {
    // If all captures failed, still open editor with error message
    await chrome.storage.local.set({ 
      captureErrors: errors 
    });
    const url = chrome.runtime.getURL('editor.html?error=true');
    await chrome.tabs.create({ url });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'BEGIN_FULLPAGE_CAPTURE') {
    startFullPageCapture(msg.tabId)
      .then(() => sendResponse({ success: true }))
      .catch(e => {
        console.error('Capture error:', e);
        sendResponse({ error: e.message });
      });
    return true; // Async response
  }
  else if (msg.type === 'BEGIN_BATCH_CAPTURE') {
    // Respond immediately so the popup can close; capture continues in background
    try { sendResponse({ success: true }); } catch (e) { /* sender may already be gone */ }
    startBatchCapture(msg.tabIds).catch(e => {
      console.error('Batch capture error:', e);
    });
    // Do not return true here since we already responded synchronously
  }
}); 