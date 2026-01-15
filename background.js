// Background service worker for token refresh and window management

// Import OAuth functions (we'll need to use them via message passing since background.js can't use ES6 imports directly)
// For now, we'll implement token refresh logic here

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

// Token refresh logic
const TOKEN_REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes (tokens expire in ~1 hour)
const TOKEN_REFRESH_ALARM_NAME = "refreshGoogleTokens";

// Get client credentials from manifest
function getClientId() {
  try {
    const manifest = chrome?.runtime?.getManifest?.();
    return manifest?.oauth2?.client_id || null;
  } catch (e) {
    return null;
  }
}

function getClientSecret() {
  try {
    const manifest = chrome?.runtime?.getManifest?.();
    return manifest?.oauth2?.client_secret || null;
  } catch (e) {
    return null;
  }
}

async function refreshTokenForAccount(accountId, refreshToken) {
  if (!refreshToken) {
    console.warn(`No refresh token for account ${accountId}`);
    return null;
  }

  const CLIENT_ID = getClientId();
  const CLIENT_SECRET = getClientSecret();

  if (!CLIENT_ID) {
    console.error("Client ID not found in manifest");
    return null;
  }

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
  });

  if (CLIENT_SECRET) {
    body.set("client_secret", CLIENT_SECRET);
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const message = errorPayload?.error_description || errorPayload?.error || response.statusText;
      console.error(`Token refresh failed for account ${accountId}:`, message);
      return null;
    }

    const data = await response.json();
    const accessToken = data?.access_token || "";
    const expiresAt = Date.now() + (data?.expires_in || 3600) * 1000;

    // Update account in storage
    chrome.storage.local.get(["accounts"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Failed to get accounts:", chrome.runtime.lastError);
        return;
      }

      const accounts = result?.accounts && typeof result.accounts === "object" ? result.accounts : {};
      if (accounts[accountId]) {
        accounts[accountId] = {
          ...accounts[accountId],
          access_token: accessToken,
          refresh_token: data?.refresh_token || refreshToken, // Google may return new refresh token
          expires_at: expiresAt,
        };

        chrome.storage.local.set({ accounts }, () => {
          if (chrome.runtime.lastError) {
            console.error("Failed to save refreshed token:", chrome.runtime.lastError);
          } else {
            console.log(`Token refreshed for account ${accountId}`);
          }
        });
      }
    });

    return { accessToken, expiresAt };
  } catch (error) {
    console.error(`Error refreshing token for account ${accountId}:`, error);
    return null;
  }
}

async function refreshAllTokens() {
  chrome.storage.local.get(["accounts"], (result) => {
    if (chrome.runtime.lastError) {
      console.error("Failed to get accounts for token refresh:", chrome.runtime.lastError);
      return;
    }

    const accounts = result?.accounts && typeof result.accounts === "object" ? result.accounts : {};
    const now = Date.now();

    // Refresh tokens that are expiring soon (within 10 minutes)
    const EXPIRATION_BUFFER = 10 * 60 * 1000; // 10 minutes

    Object.keys(accounts).forEach(async (accountId) => {
      const account = accounts[accountId];
      const expiresAt = account?.expires_at || 0;

      // If token is expired or will expire soon, refresh it
      if (expiresAt - EXPIRATION_BUFFER <= now && account?.refresh_token) {
        await refreshTokenForAccount(accountId, account.refresh_token);
      }
    });
  });
}

// Set up periodic token refresh
if (chrome.alarms) {
  // Create alarm for periodic token refresh
  chrome.alarms.create(TOKEN_REFRESH_ALARM_NAME, {
    periodInMinutes: 45, // Check every 45 minutes
  });

  // Listen for alarm events
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TOKEN_REFRESH_ALARM_NAME) {
      refreshAllTokens();
    }
  });

  // Also refresh on startup
  chrome.runtime.onStartup.addListener(() => {
    refreshAllTokens();
  });

  // Refresh when extension is installed/updated
  chrome.runtime.onInstalled.addListener(() => {
    refreshAllTokens();
  });
}

// Listen for messages to refresh tokens on demand
if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "refreshToken") {
      const { accountId, refreshToken } = msg;
      refreshTokenForAccount(accountId, refreshToken)
        .then((result) => {
          sendResponse({ success: !!result, token: result?.accessToken });
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // Asynchronous response
    }
  });
}
