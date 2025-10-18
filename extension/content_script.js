(function(){
  // Utilities run inside the page to measure and scroll.
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  // Store hidden fixed elements internally (don't send DOM nodes across messages)
  let __hiddenFixed = [];

  // Function to get the true scrollable dimensions
  function getScrollDimensions() {
    const root = document.documentElement;
    const body = document.body;
    
    // Check for custom scroll containers (common in SPAs)
    const scrollContainers = document.querySelectorAll('[style*="overflow"], .scroll-container, .scrollable, main, [role="main"]');
    let maxWidth = 0;
    let maxHeight = 0;
    
    // Check all potential scroll containers
    scrollContainers.forEach(container => {
      const rect = container.getBoundingClientRect();
      const styles = window.getComputedStyle(container);
      if (styles.overflow === 'auto' || styles.overflow === 'scroll' || 
          styles.overflowY === 'auto' || styles.overflowY === 'scroll') {
        maxWidth = Math.max(maxWidth, container.scrollWidth);
        maxHeight = Math.max(maxHeight, container.scrollHeight);
      }
    });
    
    // Get the maximum dimensions considering both html and body
    // This handles complex pages with different scroll containers
    const totalWidth = Math.max(
      root.scrollWidth,
      root.clientWidth,
      body ? body.scrollWidth : 0,
      body ? body.clientWidth : 0,
      window.innerWidth,
      maxWidth
    );
    
    const totalHeight = Math.max(
      root.scrollHeight,
      root.clientHeight,
      body ? body.scrollHeight : 0,
      body ? body.clientHeight : 0,
      root.offsetHeight,
      body ? body.offsetHeight : 0,
      window.innerHeight,
      maxHeight
    );
    
    return { totalWidth, totalHeight };
  }

  // Function to hide fixed/sticky elements during capture
  function hideFixedElements() {
    __hiddenFixed = [];
    const selectors = [
      '[style*="position: fixed"]',
      '[style*="position:fixed"]',
      '[style*="position: sticky"]',
      '[style*="position:sticky"]',
      '.fixed', '.sticky', '.header-fixed', '.navbar-fixed',
      'header[style*="fixed"]', 'nav[style*="fixed"]',
      '[data-fixed="true"]', '[data-sticky="true"]'
    ];
    
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        const styles = window.getComputedStyle(el);
        if (styles.position === 'fixed' || styles.position === 'sticky') {
          __hiddenFixed.push({ el, originalDisplay: el.style.display });
          el.style.display = 'none';
        }
      });
    });
    
    return { hiddenCount: __hiddenFixed.length };
  }
  
  // Function to restore fixed elements
  function restoreFixedElements() {
    for (const item of __hiddenFixed) {
      if (item?.el) item.el.style.display = item.originalDisplay;
    }
    __hiddenFixed = [];
  }

  // Keep-alive port listener (prevents MV3 worker suspension during capture)
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'capture-keepalive') {
      port.onDisconnect.addListener(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg.type === 'CAPTURE_GET_METRICS') {
        const { totalWidth, totalHeight } = getScrollDimensions();
        
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const devicePixelRatio = window.devicePixelRatio || 1;
        const scrollX = window.scrollX || window.pageXOffset || 0;
        const scrollY = window.scrollY || window.pageYOffset || 0;
        
        sendResponse({ 
          totalWidth, 
          totalHeight, 
          viewportWidth, 
          viewportHeight, 
          devicePixelRatio, 
          scrollX, 
          scrollY 
        });
      }
      else if (msg.type === 'CAPTURE_SCROLL_TO') {
        // Use the proper scrolling element
        const target = document.scrollingElement || document.documentElement || document.body;
        target.scrollTo({ top: msg.y, left: 0, behavior: 'auto' });
        
        // Wait for content to settle and lazy-loaded images to appear
        await sleep(msg.settleMs || 200);
        
        // Force layout recalculation
        document.body.offsetHeight;
        
        // Trigger any lazy loading that might be viewport-based
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
        
        // Additional wait for dynamic content
        await sleep(100);
        
        sendResponse({ ok: true });
      }
      else if (msg.type === 'CAPTURE_RESTORE_SCROLL') {
        window.scrollTo(msg.scrollX, msg.scrollY);
        sendResponse({ ok: true });
      }
      else if (msg.type === 'CAPTURE_HIDE_FIXED') {
        const result = hideFixedElements();
        sendResponse({ hiddenCount: result.hiddenCount });
      }
      else if (msg.type === 'CAPTURE_RESTORE_FIXED') {
        restoreFixedElements();
        sendResponse({ ok: true });
      }
    })();
    return true;
  });
})(); 