const byId = (id) => document.getElementById(id);

// Capture current page
byId('capture').addEventListener('click', async () => {
  const btn = byId('capture');
  const originalText = btn.innerHTML;
  
  try {
    // Disable button and show progress
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span><span>Capturing...</span>';
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active tab found');
    }
    
    // Check if it's a capturable page
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      throw new Error('Cannot capture browser internal pages. Please navigate to a regular webpage.');
    }
    
    const response = await chrome.runtime.sendMessage({ 
      type: 'BEGIN_FULLPAGE_CAPTURE', 
      tabId: tab.id 
    });
    
    if (response?.error) {
      throw new Error(response.error);
    }
    
    window.close();
  } catch (error) {
    console.error('Capture failed:', error);
    btn.disabled = false;
    btn.innerHTML = originalText;
    
    // Show error message
    alert(`Capture failed: ${error.message}\n\nTry:\n• Refreshing the page\n• Waiting for the page to fully load\n• Using a regular webpage (not browser internal pages)`);
  }
});

// Open editor
byId('openEditor').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
  window.close();
});

// Load tabs for batch capture
async function loadTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabList = byId('tabList');
  
  if (tabs.length === 0) {
    tabList.innerHTML = '<div class="loading-message">No tabs found</div>';
    return;
  }
  
  tabList.innerHTML = '';
  
  // Filter out non-capturable tabs
  const capturableTabs = tabs.filter(tab => {
    return !tab.url.startsWith('chrome://') && 
           !tab.url.startsWith('chrome-extension://') &&
           !tab.url.startsWith('edge://') &&
           !tab.url.startsWith('about:') &&
           tab.url !== '';
  });
  
  if (capturableTabs.length === 0) {
    tabList.innerHTML = `
      <div class="loading-message">
        No capturable tabs found.<br>
        Browser internal pages cannot be captured.
      </div>
    `;
    return;
  }
  
  capturableTabs.forEach(tab => {
    const item = document.createElement('div');
    item.className = 'tab-item';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = tab.id;
    checkbox.id = `tab-${tab.id}`;
    
    const title = document.createElement('label');
    title.className = 'tab-title';
    title.htmlFor = `tab-${tab.id}`;
    title.textContent = tab.title || tab.url || 'Untitled';
    title.title = tab.url; // Show full URL on hover
    
    item.appendChild(checkbox);
    item.appendChild(title);
    tabList.appendChild(item);
  });
  
  // Show count
  if (tabs.length !== capturableTabs.length) {
    const info = document.createElement('div');
    info.style.cssText = 'padding: 10px; font-size: 11px; color: #999; text-align: center; border-top: 1px solid #f0f0f0;';
    info.textContent = `${tabs.length - capturableTabs.length} tab(s) hidden (browser pages)`;
    tabList.appendChild(info);
  }
}

// Select all tabs
byId('selectAll').addEventListener('click', () => {
  document.querySelectorAll('.tab-item input[type="checkbox"]').forEach(cb => {
    cb.checked = true;
  });
});

// Deselect all tabs
byId('selectNone').addEventListener('click', () => {
  document.querySelectorAll('.tab-item input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
  });
});

// Batch capture selected tabs
byId('batchCapture').addEventListener('click', async () => {
  const selectedCheckboxes = document.querySelectorAll('.tab-item input[type="checkbox"]:checked');
  const tabIds = Array.from(selectedCheckboxes).map(cb => parseInt(cb.value));
  
  if (tabIds.length === 0) {
    alert('Please select at least one tab to capture');
    return;
  }
  
  // Disable button and show progress
  const btn = byId('batchCapture');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = `Capturing ${tabIds.length} tab${tabIds.length > 1 ? 's' : ''}...`;
  
  try {
    const response = await chrome.runtime.sendMessage({ 
      type: 'BEGIN_BATCH_CAPTURE', 
      tabIds 
    });
    
    if (response?.error) {
      throw new Error(response.error);
    }
    
    window.close();
  } catch (e) {
    console.error('Batch capture failed:', e);
    alert(`Batch capture failed: ${e.message}\n\nSome tabs may not be capturable. The editor will open with any successful captures.`);
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Initialize
loadTabs();

// Auto-expand batch dropdown if there are multiple tabs
chrome.tabs.query({ currentWindow: true }).then(tabs => {
  const capturableCount = tabs.filter(tab => 
    !tab.url.startsWith('chrome://') && 
    !tab.url.startsWith('chrome-extension://') &&
    !tab.url.startsWith('edge://') &&
    !tab.url.startsWith('about:')
  ).length;
  
  if (capturableCount > 1) {
    // Auto-expand the dropdown for easy access
    const dropdown = document.querySelector('.batch-dropdown');
    if (dropdown) {
      dropdown.setAttribute('open', '');
    }
  }
}); 