// Ensure chrome API is available before using it
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "openDriveWindow") {
      // Create a minimal window without address bar and toolbar
      if (chrome.windows && chrome.windows.create) {
        chrome.windows.create(
          {
            url: msg.url,
            type: "popup", // popup creates a window without address bar and some interface elements
            left: msg.left,
            top: msg.top,
            width: msg.width,
            height: msg.height,
            focused: true,
          },
          (win) => {
            if (win && win.id && chrome.windows && chrome.windows.update) {
              // Multiple attempts to bring window to front
              const bringToFront = (attempt = 1) => {
                if (attempt > 3) return; // Maximum 3 attempts

                setTimeout(() => {
                  chrome.windows.update(
                    win.id,
                    {
                      focused: true,
                      drawAttention: true,
                    },
                    () => {
                      if (chrome.runtime.lastError) {
                        console.warn(`Attempt ${attempt} failed:`, chrome.runtime.lastError.message);
                        if (attempt < 3) {
                          bringToFront(attempt + 1);
                        }
                      } else {
                        // Successfully brought to front
                        console.log(`Window ${win.id} brought to front on attempt ${attempt}`);
                      }
                    },
                  );
                }, attempt * 150); // 150ms, 300ms, 450ms
              };

              bringToFront();
            }
          },
        );
      }
      return true; // Asynchronous response
    }
  });
} else {
  console.error("Chrome runtime API is not available");
}
  