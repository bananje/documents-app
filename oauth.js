// Prefer client_id from manifest to avoid mismatches; fallback to the known value.
const manifestClientId = (() => {
  try {
    const manifest = chrome?.runtime?.getManifest?.();
    return manifest?.oauth2?.client_id || null;
  } catch (e) {
    return null;
  }
})();

// Prefer client_secret from manifest to avoid hardcoding secrets.
const manifestClientSecret = (() => {
  try {
    const manifest = chrome?.runtime?.getManifest?.();
    return manifest?.oauth2?.client_secret || null;
  } catch (e) {
    return null;
  }
})();

// For Web Application OAuth client (uses secret). Keep fallback to prior client_id.
const CLIENT_ID = manifestClientId;
// Client secret is now read from manifest.json for security
const CLIENT_SECRET = manifestClientSecret;
const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/drive",
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
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
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
  const expiresAt = Date.now() + (tokenResponse?.expires_in || 0) * 1000;

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
  const expiresAt = Date.now() + (data?.expires_in || 0) * 1000;

  return {
    accessToken,
    refreshToken: data?.refresh_token || refreshToken,
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

