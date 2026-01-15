// OAuth helper for Web Application OAuth
// Uses chrome.identity.launchWebAuthFlow for Web Application OAuth clients

// Get client credentials from manifest
const getClientId = () => {
  try {
    const manifest = chrome?.runtime?.getManifest?.();
    return manifest?.oauth2?.client_id || null;
  } catch (e) {
    return null;
  }
};

const getClientSecret = () => {
  try {
    const manifest = chrome?.runtime?.getManifest?.();
    return manifest?.oauth2?.client_secret || null;
  } catch (e) {
    return null;
  }
};

const getScopes = () => {
  try {
    const manifest = chrome?.runtime?.getManifest?.();
    return manifest?.oauth2?.scopes || [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ];
  } catch (e) {
    return [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ];
  }
};

const CLIENT_ID = getClientId();
const CLIENT_SECRET = getClientSecret();
const DEFAULT_SCOPES = getScopes();

// Basic scopes for initial sign-in (incremental authorization)
// Drive scope will be requested later when needed
export const BASIC_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

function toBase64Url(uint8Array) {
  let binary = "";
  uint8Array.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64Url(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return toBase64Url(array);
}

async function createCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(hash));
}

function parseRedirectParams(url) {
  const parsed = new URL(url);
  const params = parsed.searchParams;
  return {
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error"),
    error_description: params.get("error_description"),
  };
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const json = atob(padded);
    return JSON.parse(json);
  } catch (error) {
    console.warn("Failed to decode JWT payload", error);
    return null;
  }
}

async function fetchUserInfo(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error("Failed to fetch user profile");
  }
  return response.json();
}

async function exchangeCodeForTokens({ code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  if (CLIENT_SECRET) {
    body.set("client_secret", CLIENT_SECRET);
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const message = errorPayload?.error_description || errorPayload?.error || response.statusText;
    throw new Error(`Token exchange failed: ${message}`);
  }

  return response.json();
}

export async function startGoogleOAuthFlow(options = {}) {
  const scopes = Array.isArray(options.scopes) && options.scopes.length ? options.scopes : DEFAULT_SCOPES;
  // Use the exact redirect URI Chrome provides (no custom path) to avoid redirect_uri_mismatch
  const redirectUri = chrome.identity.getRedirectURL();
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await createCodeChallenge(codeVerifier);

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("access_type", "offline"); // Important: get refresh token
  
  // Use prompt from options, default to "select_account" for incremental authorization
  // "select_account" shows consent screen only if new permissions are needed
  const prompt = options.prompt !== undefined ? options.prompt : "select_account";
  authUrl.searchParams.set("prompt", prompt);
  
  // Support include_granted_scopes option, default to true
  const includeGranted = options.includeGrantedScopes !== false;
  if (includeGranted) {
    authUrl.searchParams.set("include_granted_scopes", "true");
  }
  
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  if (options.loginHint) {
    authUrl.searchParams.set("login_hint", options.loginHint);
  }

  const redirectUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(new Error(chrome.runtime.lastError?.message || "Authorization was cancelled"));
        return;
      }
      resolve(responseUrl);
    });
  });

  const { code, state: returnedState, error, error_description: errorDescription } = parseRedirectParams(redirectUrl);

  if (error) {
    throw new Error(errorDescription || error);
  }

  if (returnedState !== state) {
    throw new Error("State mismatch during OAuth flow");
  }

  if (!code) {
    throw new Error("Authorization code not found in redirect URL");
  }

  const tokenResponse = await exchangeCodeForTokens({ code, codeVerifier, redirectUri });
  const accessToken = tokenResponse?.access_token;
  const refreshToken = tokenResponse?.refresh_token || "";
  const expiresAt = Date.now() + (tokenResponse?.expires_in || 3600) * 1000;

  let idTokenPayload = null;
  if (tokenResponse?.id_token) {
    idTokenPayload = decodeJwtPayload(tokenResponse.id_token);
  }

  let userId = idTokenPayload?.sub || null;
  let email = idTokenPayload?.email || null;
  let picture = idTokenPayload?.picture || null;

  if (!userId || !email) {
    const profile = await fetchUserInfo(accessToken);
    userId = profile?.sub || profile?.id || userId;
    email = profile?.email || email;
    picture = profile?.picture || picture || null;
  }

  return {
    userId,
    email,
    picture,
    accessToken,
    refreshToken,
    expiresAt,
    idToken: tokenResponse?.id_token || null,
    expiresIn: tokenResponse?.expires_in || null,
  };
}

export async function refreshGoogleAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error("Missing refresh token");
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
  });

  if (CLIENT_SECRET) {
    body.set("client_secret", CLIENT_SECRET);
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const message = errorPayload?.error_description || errorPayload?.error || response.statusText;
    throw new Error(`Failed to refresh access token: ${message}`);
  }

  const data = await response.json();
  const accessToken = data?.access_token || "";
  const expiresAt = Date.now() + (data?.expires_in || 3600) * 1000;

  return {
    accessToken,
    refreshToken: data?.refresh_token || refreshToken, // Google may return new refresh token
    expiresAt,
    expiresIn: data?.expires_in || null,
  };
}

export async function loadAccountsState() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local?.get) {
      resolve({ accounts: {}, active_account_id: "" });
      return;
    }
    chrome.storage.local.get(["accounts", "active_account_id"], (result) => {
      if (chrome.runtime.lastError) {
        resolve({ accounts: {}, active_account_id: "" });
        return;
      }
      resolve({
        accounts: result?.accounts && typeof result.accounts === "object" ? result.accounts : {},
        active_account_id: result?.active_account_id || "",
      });
    });
  });
}

export async function saveAccountsState(state) {
  return new Promise((resolve, reject) => {
    if (!chrome?.storage?.local?.set) {
      reject(new Error("chrome.storage.local is unavailable"));
      return;
    }
    chrome.storage.local.set(
      {
        accounts: state?.accounts && typeof state.accounts === "object" ? state.accounts : {},
        active_account_id: state?.active_account_id || "",
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      },
    );
  });
}

/**
 * Ensures required scopes are granted, using incremental authorization
 * First tries non-interactive (prompt=none), then interactive if needed
 * @param {string[]} requiredScopes - Array of required OAuth scopes
 * @param {Object} options - Additional options (loginHint, etc.)
 * @returns {Promise<Object|null>} Auth result or null if scopes already granted
 */
export async function ensureScopes(requiredScopes = [], options = {}) {
  const scopes = Array.isArray(requiredScopes) ? requiredScopes.filter(Boolean) : [];
  if (!scopes.length) return null;

  // First try non-interactive (if permissions already granted, no screen will appear)
  try {
    return await startGoogleOAuthFlow({
      scopes,
      prompt: "none",
      includeGrantedScopes: true,
      ...options,
    });
  } catch (e) {
    // Check if error is due to user cancellation
    const errorMessage = e?.message || String(e);
    const isUserCancellation = 
      errorMessage.toLowerCase().includes("did not approve") ||
      errorMessage.toLowerCase().includes("authorization was cancelled") ||
      errorMessage.toLowerCase().includes("user cancelled") ||
      errorMessage.toLowerCase().includes("access_denied");
    
    if (isUserCancellation) {
      // User cancelled - don't try interactive flow
      throw e;
    }
    
    // If prompt=none didn't work (new permissions needed) - request interactively
    // Use "select_account" - Google will show screen only for new permissions
    // This happens in background - user only sees Google consent screen
    return await startGoogleOAuthFlow({
      scopes,
      prompt: "select_account",
      includeGrantedScopes: true,
      ...options,
    });
  }
}
