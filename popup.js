import {
  startGoogleOAuthFlow,
  refreshGoogleAccessToken,
  loadAccountsState,
  saveAccountsState,
  ensureScopes,
  BASIC_SCOPES,
} from "./oauth.js";

class AuthRequiredError extends Error {
  constructor(message = "Google authorization is required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

function setupInfiniteScroll(view, typeFilter = null) {
  if (!GRID_VIEWS.has(view)) return;
  const searchQuery = viewSearchState[view] || null;
  const cacheKey = getDriveCacheKey(view, typeFilter || viewTypeFilter[view] || null, searchQuery);
  const existing = infiniteScrollHandlers.get(view);
  if (existing) {
    contentEl.removeEventListener("scroll", existing);
  }

  const handler = () => {
    const maxScroll = contentEl.scrollHeight - contentEl.clientHeight;
    const distance = maxScroll - contentEl.scrollTop;
    if (distance < 200) {
      loadMoreDrive(view, cacheKey, typeFilter || viewTypeFilter[view] || null, searchQuery);
    }
  };

  contentEl.addEventListener("scroll", handler);
  infiniteScrollHandlers.set(view, handler);
}

async function loadMoreDrive(view, cacheKey, typeFilter = null, searchQuery = null) {
  const state = drivePageState.get(cacheKey);
  if (!state || state.loading || state.exhausted || !state.nextPageToken) return;

  state.loading = true;
  drivePageState.set(cacheKey, state);

  try {
    const { files, nextPageToken } = await fetchDriveFiles(view, {
      interactive: false,
      pageToken: state.nextPageToken,
      typeFilter,
      searchQuery,
    });
    const combined = [...(state.files || []), ...files];
    driveCache.set(cacheKey, combined);
    drivePageState.set(cacheKey, {
      files: combined,
      nextPageToken: nextPageToken || null,
      loading: false,
      exhausted: !nextPageToken,
    });

    if (activeView === view) {
      // Use the actual value from the search field if it exists
      const searchInput = contentEl.querySelector(`.content__search-input[data-view="${view}"]`);
      const currentQuery = searchInput?.value?.trim() || viewSearchState[view] || "";
      renderGrid(view, combined, currentQuery);
      setupInfiniteScroll(view, typeFilter || viewTypeFilter[view] || null);
    }
  } catch (error) {
    console.error("Drive load more error:", error);
    drivePageState.set(cacheKey, { ...(state || {}), loading: false });
  }
}

const GRID_VIEWS = new Set(["drive", "recent"]);
const AUTH_ERROR_SNIPPETS = [
  "did not approve",
  "not signed in",
  "oauth2 not granted",
  "no user found",
  "unknown user",
  "token has been revoked",
  "authorization page could not be loaded",
];
const DRIVE_VIEW_LABELS = {
  drive: "My Drive picks",
  recent: "Recent activity",
};

const DRIVE_QUERIES = {
  drive: "mimeType contains 'application/vnd.google-apps'",
  recent: "mimeType contains 'application/vnd.google-apps'",
};

const GOOGLE_TYPES = [
  { key: "docs", mime: "application/vnd.google-apps.document" },
  { key: "sheets", mime: "application/vnd.google-apps.spreadsheet" },
  { key: "slides", mime: "application/vnd.google-apps.presentation" },
  { key: "forms", mime: "application/vnd.google-apps.form" },
];

// All required scopes for initial sign-in (minimizes user clicks)
// Request all permissions at once for new users (1 screen instead of 2)
const ALL_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive",
];

// Drive scopes for incremental authorization
// These will be requested automatically when Drive API is accessed
// (for existing users who only have basic scopes)
const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
];

// Mapping document types to icon URLs (same as in CREATE_SHORTCUTS)
const TYPE_ICON_URLS = {
  docs: "https://img.icons8.com/color/48/google-docs--v1.png",
  sheets: "https://img.icons8.com/color/48/google-sheets.png",
  slides: "https://img.icons8.com/color/48/google-slides.png",
  forms: "https://img.icons8.com/fluency/48/google-forms.png",
  generic: "https://img.icons8.com/color/48/google-docs--v1.png", // fallback to docs icon
};

const ACTION_ICONS = {
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-4.5c0-3.5-2.5-6.5-6-6.5s-6 3-6 6.5V17z"/><circle cx="12" cy="9" r="2.5"/></svg>`,
  delete: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6v14h12V6"/></svg>`,
};


const CREATE_SHORTCUTS = [
  {
    key: "docs",
    label: "Document",
    description: "Google Doc",
    url: "https://docs.google.com/document/create",
    iconUrl: "https://img.icons8.com/color/48/google-docs--v1.png",
  },
  {
    key: "sheets",
    label: "Spreadsheet",
    description: "Google Sheet",
    url: "https://docs.google.com/spreadsheets/create",
    iconUrl: "https://img.icons8.com/color/48/google-sheets.png",
  },
  {
    key: "slides",
    label: "Presentation",
    description: "Google Slides",
    url: "https://docs.google.com/presentation/create",
    iconUrl: "https://img.icons8.com/color/48/google-slides.png",
  },
  {
    key: "forms",
    label: "Form",
    description: "Google Form",
    url: "https://docs.google.com/forms/create",
    iconUrl: "https://img.icons8.com/fluency/48/google-forms.png",
  },
];

const contentEl = document.getElementById("content");
const buttons = Array.from(document.querySelectorAll("[data-view]"));
const signInButton = document.querySelector("[data-signin]");
const accountButton = document.querySelector(".toolbar__auth--account");
const avatarImg = accountButton?.querySelector("[data-avatar-img]");
const avatarFallback = accountButton?.querySelector("[data-avatar-fallback]");
let signedInUser = null;
let cachedToken = null;
const tokenCache = new Map();
const driveCache = new Map(); // key: `${accountId||"anon"}::${view}::${typeFilter||"all"}`
const drivePageState = new Map(); // pagination state per cache key
const infiniteScrollHandlers = new Map(); // scroll listeners per view
const ACCOUNT_STORE_DEFAULT = { accounts: {}, active_account_id: "" };
let accountStore = { ...ACCOUNT_STORE_DEFAULT };
let currentGridRequest = 0;
const SEARCHABLE_VIEWS = new Set(["drive", "recent"]);
const viewSearchState = {
  drive: "",
  recent: "",
};
const searchDebounceTimers = new Map(); // Timers for search debounce
const searchResultsCache = new Map(); // Cache of search results per view: { files: [], query: "" }

const viewTypeFilter = {
  drive: null, // null = all types, "docs" | "sheets" | "slides" | "forms"
  recent: null,
};

function syncAccountProfilesFromStore() {
  accountProfiles = Object.entries(accountStore.accounts || {}).map(([id, data]) => ({
    id,
    email: data?.email || "",
    photoUrl: data?.photoUrl || null,
  }));
}

async function loadAccountStore() {
  try {
    const state = await loadAccountsState();
    accountStore = {
      accounts: state?.accounts && typeof state.accounts === "object" ? state.accounts : {},
      active_account_id: state?.active_account_id || "",
    };
  } catch (error) {
    console.warn("Failed to load account store from local storage", error);
    accountStore = { ...ACCOUNT_STORE_DEFAULT };
  }

  // Migrate legacy sync storage if local store is empty
  if (!Object.keys(accountStore.accounts || {}).length && chrome?.storage?.sync?.get) {
    await new Promise((resolve) => {
      chrome.storage.sync.get([ACCOUNT_PROFILES_KEY, ACTIVE_ACCOUNT_KEY], (result) => {
        const legacyAccounts = Array.isArray(result?.[ACCOUNT_PROFILES_KEY]) ? result[ACCOUNT_PROFILES_KEY] : [];
        legacyAccounts.forEach((profile) => {
          if (!profile?.id || !profile?.email) return;
          accountStore.accounts[profile.id] = {
            email: profile.email,
            access_token: profile.accessToken || "",
            refresh_token: profile.refreshToken || "",
            expires_at: profile.expiresAt || 0,
            photoUrl: profile.photoUrl || null,
          };
        });
        accountStore.active_account_id = result?.[ACTIVE_ACCOUNT_KEY] || "";
        resolve();
      });
    });
  }

  syncAccountProfilesFromStore();
  activeAccountId = accountStore.active_account_id || (accountProfiles[0]?.id ?? null);

  if (activeAccountId) {
    const stored = accountStore.accounts?.[activeAccountId];
    if (stored?.access_token) {
      cachedToken = stored.access_token;
      tokenCache.set(activeAccountId, stored.access_token);
    }
    if (stored?.email) {
      signedInUser = { id: activeAccountId, email: stored.email };
    }
  }

  await persistAccountStore();
}

async function persistAccountStore() {
  try {
    await saveAccountsState(accountStore);
  } catch (error) {
    console.warn("Failed to persist account store", error);
  }
}

function upsertAccountProfile(profile) {
  if (!profile?.id || !profile?.email) return;
  const existing = accountStore.accounts?.[profile.id] || {};
  accountStore.accounts[profile.id] = {
    email: profile.email,
    access_token: profile.accessToken || existing.access_token || "",
    refresh_token: profile.refreshToken || existing.refresh_token || "",
    expires_at: profile.expiresAt ?? existing.expires_at ?? 0,
    photoUrl: profile.photoUrl || existing.photoUrl || null,
  };

  syncAccountProfilesFromStore();
  const existingIndex = accountProfiles.findIndex((item) => item.id === profile.id);
  if (existingIndex >= 0) {
    accountProfiles[existingIndex] = { ...accountProfiles[existingIndex], ...profile };
  } else {
    accountProfiles.push({ id: profile.id, email: profile.email, photoUrl: profile.photoUrl || null });
  }

  persistAccountStore();
}

function setActiveAccount(accountId, token) {
  activeAccountId = accountId || null;
  accountStore.active_account_id = activeAccountId || "";

  if (activeAccountId) {
    const existing = accountStore.accounts?.[activeAccountId] || {};
    const accessToken = token || existing.access_token || null;
    accountStore.accounts[activeAccountId] = {
      email: existing.email || "",
      access_token: accessToken || "",
      refresh_token: existing.refresh_token || "",
      expires_at: existing.expires_at || 0,
      photoUrl: existing.photoUrl || null,
    };

    if (accessToken) {
      tokenCache.set(activeAccountId, accessToken);
      cachedToken = accessToken;
    } else {
      cachedToken = null;
    }
  } else {
    cachedToken = null;
  }

  persistAccountStore();
}

const TYPE_FILTER_ICONS = {
  docs: "https://img.icons8.com/color/48/google-docs--v1.png",
  sheets: "https://img.icons8.com/color/48/google-sheets.png",
  slides: "https://img.icons8.com/color/48/google-slides.png",
  forms: "https://img.icons8.com/fluency/48/google-forms.png",
};
let activeView = "drive";
const PIN_STORAGE_KEY = "driveDeskPinnedIds";
let pinnedFileIds = [];
const LOGOUT_STATE_KEY = "driveDeskLoggedOut";
const ACCOUNT_PROFILES_KEY = "driveDeskAccounts";
const ACTIVE_ACCOUNT_KEY = "driveDeskActiveAccountId";
let accountProfiles = [];
let activeAccountId = null;
let accountMenuEl = null;
let accountMenuOutsideHandler = null;

function getActiveAccountEmail() {
  const id = activeAccountId || accountStore.active_account_id || null;
  return (id && accountStore.accounts?.[id]?.email) || signedInUser?.email || null;
}

function appendAuthUserParam(url, email) {
  if (!email || typeof url !== "string") return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.get("authuser")) {
      u.searchParams.set("authuser", email);
    }
    return u.toString();
  } catch (e) {
    return url;
  }
}

function getTypeKey(mimeType) {
  const found = GOOGLE_TYPES.find((type) => mimeType === type.mime);
  return found ? found.key : "generic";
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char] || char;
  });
}

async function openDocumentInSideWindow(url) {
  try {
    const urlWithUser = appendAuthUserParam(url, getActiveAccountEmail());
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url: urlWithUser, active: false });
    } else {
      window.open(urlWithUser, "_blank", "noopener");
    }
  } catch (error) {
    console.error("Failed to open document in side window:", error);
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url: appendAuthUserParam(url, getActiveAccountEmail()), active: false });
    } else {
      window.open(appendAuthUserParam(url, getActiveAccountEmail()), "_blank", "noopener");
    }
  }
}

function buildCard(file, view = "drive") {
  const card = document.createElement("article");
  const typeKey = getTypeKey(file.mimeType);
  card.className = "doc-card";
  card.dataset.type = typeKey;
  card.title = file.name;
  card.dataset.fileId = file.id;

  card.setAttribute("tabindex", "-1");
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", file.name);

  const actions = document.createElement("div");
  actions.className = "doc-card__actions";

  if (view === "drive") {
    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.className = "doc-card__action doc-card__action--pin";
    pinButton.innerHTML = ACTION_ICONS.pin;
    pinButton.title = "Pin document";
    if (isFilePinned(file.id)) {
      pinButton.classList.add("active");
      pinButton.title = "Unpin document";
    }
    pinButton.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePinnedState(file.id);
    });
    actions.append(pinButton);
  }

  const meta = document.createElement("header");
  meta.className = "doc-card__meta";

  const icon = document.createElement("span");
  icon.className = `doc-card__icon doc-card__icon--${typeKey}`;
  const iconImg = document.createElement("img");
  iconImg.src = TYPE_ICON_URLS[typeKey] || TYPE_ICON_URLS.generic;
  iconImg.alt = `${typeKey} icon`;
  iconImg.width = 18;
  iconImg.height = 18;
  icon.appendChild(iconImg);

  const title = document.createElement("span");
  title.className = "doc-card__title";
  title.textContent = file.name;

  meta.append(icon, title);

  const preview = document.createElement("div");
  preview.className = "doc-card__preview";

  const previewUrl = `https://drive.google.com/thumbnail?id=${file.id}&sz=w256-h256`;
  const image = document.createElement("img");
  image.src = previewUrl;
  image.alt = `${file.name} preview`;
  image.addEventListener("error", () => {
    image.remove();
    const fallback = document.createElement("span");
    fallback.className = "doc-card__placeholder";
    fallback.textContent = "Preview unavailable";
    preview.appendChild(fallback);
  });

  preview.appendChild(image);

  // Add pinned indicator at top right (non-interactive overlay, no duplicate pins)
  if (view === "drive" && isFilePinned(file.id)) {
    const pinIndicator = document.createElement("div");
    pinIndicator.className = "doc-card__pin-indicator";
    pinIndicator.setAttribute("aria-hidden", "true");
    pinIndicator.innerHTML = ACTION_ICONS.pin;
    pinIndicator.title = "Document pinned";
    card.appendChild(pinIndicator);
  }

  card.append(actions, meta, preview);

  if (file.webViewLink) {
    card.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDocumentInSideWindow(file.webViewLink);
    });
  }

  return card;
}

function orderFilesByQuery(files, query = "") {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return files.slice();
  }

  const terms = normalized.split(/\s+/).filter(Boolean);
  const matched = [];
  const rest = [];

  files.forEach((file, index) => {
    const name = (file.name || "").toLowerCase();
    let score = 0;
    terms.forEach((term) => {
      const idx = name.indexOf(term);
      if (idx === 0) {
        score += 3;
      } else if (idx > 0) {
        score += 1;
      }
    });
    if (score > 0) {
      matched.push({ file, score, index });
    } else {
      rest.push({ file, index });
    }
  });

  matched.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });

  rest.sort((a, b) => a.index - b.index);

  return [...matched.map((item) => item.file), ...rest.map((item) => item.file)];
}

function sortFilesForView(files, query = "", view = "drive") {
  const normalized = query.trim().toLowerCase();
  const typeFilter = viewTypeFilter[view];
  
  // Filter by type if selected
  let filteredFiles = files;
  if (typeFilter) {
    const typeMime = GOOGLE_TYPES.find((t) => t.key === typeFilter)?.mime;
    if (typeMime) {
      filteredFiles = files.filter((file) => file.mimeType === typeMime);
    }
  }
  
  if (!normalized) {
    if (view === "drive" && pinnedFileIds.length) {
      const pinIndexMap = new Map();
      pinnedFileIds.forEach((id, index) => pinIndexMap.set(id, index));
      const pinned = [];
      const rest = [];
      filteredFiles.forEach((file, index) => {
        if (pinIndexMap.has(file.id)) {
          pinned.push({ file, order: pinIndexMap.get(file.id) });
        } else {
          rest.push({ file, index });
        }
      });
      pinned.sort((a, b) => a.order - b.order);
      rest.sort((a, b) => a.index - b.index);
      return [...pinned.map((entry) => entry.file), ...rest.map((entry) => entry.file)];
    }
    return filteredFiles.slice();
  }
  return orderFilesByQuery(filteredFiles, normalized);
}

/**
 * Creates header with type filter and search field for searchable views
 * @param {string} view - Current view
 * @param {string} query - Current search query
 * @returns {HTMLElement} Header element
 */
function createSearchHeader(view, query = "") {
  const header = document.createElement("div");
  header.className = "content__header";

  if (SEARCHABLE_VIEWS.has(view)) {
    const typeFilterWrapper = document.createElement("div");
    typeFilterWrapper.className = "content__type-filter-wrapper";
    
    const typeFilter = document.createElement("div");
    typeFilter.className = "content__type-filter";
    
    const baseButton = document.createElement("button");
    baseButton.type = "button";
    baseButton.className = "content__type-filter-base";
    baseButton.setAttribute("aria-expanded", "false");
    
    const currentType = viewTypeFilter[view];
    if (currentType && TYPE_FILTER_ICONS[currentType]) {
      baseButton.innerHTML = `<img src="${TYPE_FILTER_ICONS[currentType]}" alt="${currentType}" width="20" height="20" />`;
      baseButton.title =
        currentType === "docs"
          ? "Documents"
          : currentType === "sheets"
            ? "Sheets"
            : currentType === "slides"
              ? "Slides"
              : "Forms";
    } else {
      baseButton.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 9h6M9 15h6M9 12h6"/></svg>`;
      baseButton.title = "All types";
    }
    
    const dropdown = document.createElement("div");
    dropdown.className = "content__type-filter-dropdown";
    
    const allOption = document.createElement("button");
    allOption.type = "button";
    allOption.className = "content__type-filter-option";
    allOption.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 9h6M9 15h6M9 12h6"/></svg>`;
    allOption.title = "All types";
    allOption.addEventListener("click", (e) => {
      e.stopPropagation();
      viewTypeFilter[view] = null;
      
      // If there is an active search, filter search results locally
      const searchCache = searchResultsCache.get(view);
      const searchQuery = viewSearchState[view] || null;
      if (searchCache && searchCache.query.trim()) {
        renderGrid(view, searchCache.files, searchCache.query);
      } else {
        // Otherwise standard logic - check cache and load if necessary
        const cacheKey = getDriveCacheKey(view, null, searchQuery);
        const cachedFiles = driveCache.get(cacheKey) || [];
        
        if (cachedFiles.length === 0) {
          // If cache is empty, load from API (with search query if present)
          renderLoading(view);
          loadDriveContent(view, { force: false, typeFilter: null, searchQuery: searchQuery });
        } else {
          // If data exists in cache, show it
          renderGrid(view, cachedFiles, searchQuery || "");
        }
      }
    });
    dropdown.appendChild(allOption);

    Object.entries(TYPE_FILTER_ICONS).forEach(([type, iconUrl]) => {
      const typeOption = document.createElement("button");
      typeOption.type = "button";
      typeOption.className = "content__type-filter-option";
      typeOption.innerHTML = `<img src="${iconUrl}" alt="${type}" width="20" height="20" />`;
      typeOption.title = type === "docs" ? "Documents" : type === "sheets" ? "Sheets" : type === "slides" ? "Slides" : "Forms";
      typeOption.addEventListener("click", (e) => {
        e.stopPropagation();
        viewTypeFilter[view] = type;
        
        // If there is an active search, filter search results locally
        const searchCache = searchResultsCache.get(view);
        const searchQuery = viewSearchState[view] || null;
        if (searchCache && searchCache.query.trim()) {
          const typeMime = GOOGLE_TYPES.find((t) => t.key === type)?.mime;
          if (typeMime) {
            const filteredFiles = searchCache.files.filter((file) => file.mimeType === typeMime);
            renderGrid(view, filteredFiles, searchCache.query);
          } else {
            renderGrid(view, searchCache.files, searchCache.query);
          }
        } else {
          // Otherwise standard logic - check cache and load if necessary
          const cacheKey = getDriveCacheKey(view, type, searchQuery);
          const cachedFiles = driveCache.get(cacheKey) || [];
          
          if (cachedFiles.length === 0) {
            // If cache is empty, load from API (with search query if present)
            renderLoading(view);
            loadDriveContent(view, { force: false, typeFilter: type, searchQuery: searchQuery });
          } else {
            // If data exists in cache, show it
            renderGrid(view, cachedFiles, searchQuery || "");
          }
        }
      });
      dropdown.appendChild(typeOption);
    });
    
    dropdown.hidden = false;
    
    typeFilter.appendChild(baseButton);
    typeFilter.appendChild(dropdown);
    typeFilterWrapper.appendChild(typeFilter);
    header.appendChild(typeFilterWrapper);

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Search";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.className = "content__search-input";
    searchInput.value = query;
    searchInput.dataset.view = view;
    searchInput.addEventListener("input", handleSearchInput);
    header.appendChild(searchInput);
  } else {
    const heading = document.createElement("h2");
    heading.className = "content__title";
    heading.textContent = DRIVE_VIEW_LABELS[view] || "Files";
    header.appendChild(heading);
  }

  return header;
}

function renderGrid(view, files, query = "") {
  // Preserve header if it already exists
  let header = contentEl.querySelector(".content__header");
  const existingHeader = header && header.querySelector(`.content__search-input[data-view="${view}"]`);
  
  if (!existingHeader) {
    // If header is missing or for another view, recreate entire content
    contentEl.innerHTML = "";
    header = createSearchHeader(view, query);
    contentEl.appendChild(header);
  } else {
    // If header exists, do NOT update search value from query
    // Search field should only be updated manually by user
    // Use current value from search field if it exists
    const searchInput = header.querySelector(`.content__search-input[data-view="${view}"]`);
    if (searchInput && searchInput.value.trim()) {
      // If search field has a value, use it instead of passed query
      query = searchInput.value;
    }
    
    // Update type filter display to match currently selected type
    const baseButton = header.querySelector(`.content__type-filter-base`);
    if (baseButton) {
      const currentType = viewTypeFilter[view];
      if (currentType && TYPE_FILTER_ICONS[currentType]) {
        baseButton.innerHTML = `<img src="${TYPE_FILTER_ICONS[currentType]}" alt="${currentType}" width="20" height="20" />`;
        baseButton.title =
          currentType === "docs"
            ? "Documents"
            : currentType === "sheets"
              ? "Sheets"
              : currentType === "slides"
                ? "Slides"
                : "Forms";
      } else {
        baseButton.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 9h6M9 15h6M9 12h6"/></svg>`;
        baseButton.title = "All types";
      }
    }
    
    // Remove old content (grid, placeholder, loader), but preserve header
    const oldGrid = contentEl.querySelector(".content__grid");
    const oldPlaceholder = contentEl.querySelector(".content__placeholder");
    const oldLoader = contentEl.querySelector(".content__loader");
    if (oldGrid) oldGrid.remove();
    if (oldPlaceholder) oldPlaceholder.remove();
    if (oldLoader) oldLoader.remove();
  }

  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "content__placeholder";
    empty.textContent = "No files to show yet.";
    contentEl.appendChild(empty);
    return;
  }

  const grid = document.createElement("section");
  grid.className = "content__grid";
  grid.setAttribute("role", "grid");

  sortFilesForView(files, query, view).forEach((file) => {
    grid.appendChild(buildCard(file, view));
  });

  contentEl.appendChild(grid);
}

function renderCreateShortcuts() {
  contentEl.innerHTML = `
    <h2>Create a new file</h2>
    <section class="shortcut-grid">
      ${CREATE_SHORTCUTS.map(
        (item) => `
          <button class="shortcut-card shortcut-card--${item.key}" data-shortcut="${item.url}">
            <span class="shortcut-card__icon">
              <img width="40" height="40" src="${item.iconUrl}" alt="${item.label}" />
            </span>
            <span class="shortcut-card__info">
              <strong>${item.label}</strong>
              <small>${item.description}</small>
            </span>
          </button>
        `,
      ).join("")}
    </section>
  `;

  contentEl.querySelectorAll("[data-shortcut]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const url = button.dataset.shortcut;
      openDocumentInSideWindow(url);
    });
  });
}

function renderStatus(message, actionLabel, action) {
  contentEl.innerHTML = `
    <div class="content__status">
      <p>${escapeHtml(message)}</p>
      ${actionLabel ? `<button class="content__action" data-action>${escapeHtml(actionLabel)}</button>` : ""}
    </div>
  `;
  if (actionLabel && action) {
    contentEl.querySelector("[data-action]")?.addEventListener("click", action);
  }
}

function handleGrantAccess(view = activeView, searchQuery = null) {
  const grantAccessButton = document.getElementById("auth-prompt-grant-access-button");
  if (grantAccessButton) {
    grantAccessButton.disabled = true;
    const originalText = grantAccessButton.querySelector("span")?.textContent || "Grant Access";
    if (grantAccessButton.querySelector("span")) {
      grantAccessButton.querySelector("span").textContent = "Granting access...";
    }
  }

  // Call OAuth flow directly to open Google window
  // Request all permissions at once for new users (minimizes clicks - 1 screen instead of 2)
  // includeGrantedScopes ensures incremental authorization still works for existing users
  startGoogleOAuthFlow({ 
    scopes: ALL_REQUIRED_SCOPES,
    prompt: "consent",
    includeGrantedScopes: true 
  })
    .then(async (authResult) => {
      if (!authResult?.userId || !authResult?.email || !authResult?.accessToken) {
        console.warn("OAuth flow did not return required fields", authResult);
        if (grantAccessButton) {
          grantAccessButton.disabled = false;
          if (grantAccessButton.querySelector("span")) {
            grantAccessButton.querySelector("span").textContent = originalText;
          }
        }
        return;
      }

      const existing = accountStore.accounts?.[authResult.userId] || {};
      const mergedRefreshToken = authResult.refreshToken || existing.refresh_token || "";
      accountStore.accounts[authResult.userId] = {
        email: authResult.email,
        access_token: authResult.accessToken,
        refresh_token: mergedRefreshToken,
        expires_at: authResult.expiresAt || 0,
        photoUrl: authResult.picture || existing.photoUrl || null,
      };
      accountStore.active_account_id = authResult.userId;

      syncAccountProfilesFromStore();
      await persistAccountStore();

      const token = authResult.accessToken;
      setActiveAccount(authResult.userId, token);
      signedInUser = { id: authResult.userId, email: authResult.email };
      upsertAccountProfile({
        id: authResult.userId,
        email: authResult.email,
        photoUrl: authResult.picture || existing.photoUrl || null,
        accessToken: token,
        refreshToken: mergedRefreshToken,
        expiresAt: authResult.expiresAt || 0,
      });
      toggleAccountAvatar(authResult.picture || null);
      toggleAuthUI(true);
      hideAuthPrompt();

      // Clear cache and reload data
      driveCache.clear();
      drivePageState.clear();
      searchResultsCache.clear();
      currentGridRequest = 0;

      // Reload content for current view
      if (view && GRID_VIEWS.has(view)) {
        renderLoading(view);
        loadDriveContent(view, { force: true, typeFilter: viewTypeFilter[view] || null, searchQuery: searchQuery });
      } else if (GRID_VIEWS.has("drive")) {
        renderLoading("drive");
        loadDriveContent("drive", { force: true });
      }
    })
    .catch((error) => {
      // Ignore user cancellation errors
      const errorMessage = error?.message || String(error);
      const isUserCancellation = 
        errorMessage.toLowerCase().includes("did not approve") ||
        errorMessage.toLowerCase().includes("authorization was cancelled") ||
        errorMessage.toLowerCase().includes("user cancelled") ||
        errorMessage.toLowerCase().includes("access_denied");
      
      if (!isUserCancellation) {
        console.error("Grant access error:", error);
      }
      
      // Restore button in any case
      if (grantAccessButton) {
        grantAccessButton.disabled = false;
        const span = grantAccessButton.querySelector("span");
        if (span) {
          span.textContent = "Grant Access";
        }
      }
    });
}

function renderAuthPromptForGrantAccess(view = activeView, searchQuery = null) {
  contentEl.innerHTML = `
    <div class="auth-prompt" id="auth-prompt-grant-access">
      <div class="auth-prompt__image-wrapper">
        <svg class="auth-prompt__image" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
          <!-- Google Office illustration SVG -->
          <rect x="0" y="0" width="200" height="150" fill="#f8f9fa" rx="8"/>
          <!-- Google G logo in center -->
          <circle cx="100" cy="75" r="25" fill="#4285f4"/>
          <circle cx="100" cy="75" r="15" fill="#fff"/>
          <rect x="100" y="60" width="15" height="30" fill="#4285f4"/>
          <rect x="100" y="75" width="15" height="15" fill="#4285f4"/>
          <!-- People icons around -->
          <circle cx="60" cy="45" r="8" fill="#34a853"/>
          <rect x="55" y="53" width="10" height="15" fill="#34a853" rx="2"/>
          <circle cx="140" cy="45" r="8" fill="#ea4335"/>
          <rect x="135" y="53" width="10" height="15" fill="#ea4335" rx="2"/>
          <circle cx="60" cy="105" r="8" fill="#fbbc04"/>
          <rect x="55" y="113" width="10" height="15" fill="#fbbc04" rx="2"/>
          <circle cx="140" cy="105" r="8" fill="#673ab7"/>
          <rect x="135" y="113" width="10" height="15" fill="#673ab7" rx="2"/>
          <!-- Connecting lines -->
          <line x1="68" y1="50" x2="92" y2="70" stroke="#e8eaed" stroke-width="2"/>
          <line x1="132" y1="50" x2="108" y2="70" stroke="#e8eaed" stroke-width="2"/>
          <line x1="68" y1="110" x2="92" y2="90" stroke="#e8eaed" stroke-width="2"/>
          <line x1="132" y1="110" x2="108" y2="90" stroke="#e8eaed" stroke-width="2"/>
        </svg>
      </div>
      <div class="auth-prompt__content">
        <p class="auth-prompt__description">For quick management of your drive, please grant access to your Google Drive application</p>
        <button class="auth-prompt__button" id="auth-prompt-grant-access-button" type="button">
          <svg class="auth-prompt__button-icon" viewBox="0 0 533.5 544.3" width="20" height="20">
            <path d="M533.5 278.4c0-18.5-1.6-37-5.1-55H272v104.6h147.5c-6.3 33.8-25.6 62.6-54.5 81.7v67h88c51.6-47.6 80.5-117.8 80.5-198.3z" fill="#4285f4" />
            <path d="M272 544.3c73.8 0 135.8-24.5 181.1-66.6l-88-67c-24.4 16.4-55.7 26-93.1 26-71.6 0-132.3-48.3-154-113.4h-90.6v71.2c45 89.6 137.2 149.8 244.6 149.8z" fill="#34a853" />
            <path d="M118 323.3c-11.4-33.8-11.4-70.5 0-104.3V147.8h-90.6c-36.5 72.1-36.5 158.6 0 230.7z" fill="#fbbc05" />
            <path d="M272 107.7c39.9-.6 77.9 14.7 106.7 42.7l79.8-79.8C407.6 24.6 344.8-.3 272 0 164.6 0 72.4 60.2 27.4 149.8l90.6 71.2C139.7 155.9 200.4 107.7 272 107.7z" fill="#ea4335" />
          </svg>
          <span>Grant Access</span>
        </button>
      </div>
    </div>
  `;
  
  const grantAccessButton = document.getElementById("auth-prompt-grant-access-button");
  if (grantAccessButton) {
    grantAccessButton.addEventListener("click", () => handleGrantAccess(view, searchQuery));
  }
}

function renderLoading(view) {
  // Preserve header if it already exists
  let header = contentEl.querySelector(".content__header");
  const existingHeader = header && header.querySelector(`.content__search-input[data-view="${view}"]`);
  
  if (!existingHeader) {
    // If header is missing or for another view, create header
    if (!header) {
      contentEl.innerHTML = "";
      header = createSearchHeader(view, viewSearchState[view] || "");
      contentEl.appendChild(header);
    }
  }
  
  // Remove old content (grid, placeholder), but preserve header
  const oldGrid = contentEl.querySelector(".content__grid");
  const oldPlaceholder = contentEl.querySelector(".content__placeholder");
  if (oldGrid) oldGrid.remove();
  if (oldPlaceholder) oldPlaceholder.remove();
  
  // Remove old loader if exists
  const oldLoader = contentEl.querySelector(".content__loader");
  if (oldLoader) oldLoader.remove();
  
  // Add new loader
  const loader = document.createElement("div");
  loader.className = "content__loader";
  loader.innerHTML = `<span>Loading ${escapeHtml(DRIVE_VIEW_LABELS[view] || "files")}…</span>`;
  contentEl.appendChild(loader);
}

function renderAccount() {


  const userEmail = signedInUser.email || "Google user";
  const userName = userEmail.split("@")[0];

  contentEl.innerHTML = `
    <div class="account">
      <div class="account__header">
        <div class="account__avatar-wrapper">
          ${avatarImg && !avatarImg.hidden ? 
            `<img src="${avatarImg.src}" alt="Avatar" class="account__avatar-img" />` :
            `<div class="account__avatar-fallback">${userName.charAt(0).toUpperCase()}</div>`
          }
        </div>
        <div class="account__info">
          <h2 class="account__name">${escapeHtml(userName)}</h2>
          <p class="account__email">${escapeHtml(userEmail)}</p>
        </div>
      </div>

      <div class="account__pro">
        <div class="account__pro-content">
          <svg class="account__pro-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          <div class="account__pro-text">
            <h3 class="account__pro-title">Upgrade to Pro</h3>
            <p class="account__pro-description">Unlock AI features directly in Google Docs</p>
          </div>
        </div>
        <button class="account__pro-button" type="button">Upgrade</button>
      </div>

      <div class="account__actions">
        <button class="account__logout" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>Log Out</span>
        </button>
      </div>
    </div>
  `;

  // Logout button handler
  const logoutButton = contentEl.querySelector(".account__logout");
  if (logoutButton) {
    logoutButton.addEventListener("click", handleLogout);
  }

  // Pro upgrade button handler
  const proButton = contentEl.querySelector(".account__pro-button");
  if (proButton) {
    proButton.addEventListener("click", () => {
      // Placeholder for pro upgrade action
      console.log("Pro upgrade clicked");
      // You can add actual upgrade logic here
    });
  }
}

function handleLogout() {
  if (!chrome?.identity) {
    console.warn("Chrome identity API not available");
    return;
  }

  closeAccountMenu();

  const tokensToRevoke = new Set();

  // Clear in-memory token immediately
  if (cachedToken) {
    tokensToRevoke.add(cachedToken);
    invalidateToken(cachedToken);
  }

  const currentAccountId = activeAccountId || accountStore.active_account_id || null;
  const currentStored = currentAccountId ? accountStore.accounts?.[currentAccountId] : null;
  if (currentStored?.access_token) {
    tokensToRevoke.add(currentStored.access_token);
  }

  const cachedPerAccount = tokenCache.get(currentAccountId);
  if (cachedPerAccount) {
    tokensToRevoke.add(cachedPerAccount);
  }

  // Revoke only current account tokens
  Promise.all([...tokensToRevoke].map(revokeOAuthToken)).finally(() => {
    performLogout();
  });
}

function performLogout() {
  const currentAccountId = activeAccountId || accountStore.active_account_id || null;

  if (currentAccountId) {
    delete accountStore.accounts[currentAccountId];
    tokenCache.delete(currentAccountId);
    if (accountStore.active_account_id === currentAccountId) {
      const remainingIds = Object.keys(accountStore.accounts);
      accountStore.active_account_id = remainingIds[0] || "";
      activeAccountId = accountStore.active_account_id || null;
      if (activeAccountId) {
        const remaining = accountStore.accounts[activeAccountId];
        cachedToken = remaining?.access_token || null;
        if (cachedToken) tokenCache.set(activeAccountId, cachedToken);
        signedInUser = remaining?.email
          ? { id: activeAccountId, email: remaining.email, photoUrl: remaining.photoUrl || null }
          : null;
      } else {
        cachedToken = null;
        signedInUser = null;
      }
    }
  } else {
    cachedToken = null;
    signedInUser = null;
  }

  // Sync in-memory profile list for UI
  syncAccountProfilesFromStore();
  if (activeAccountId) {
    setActiveAccount(activeAccountId, cachedToken || tokenCache.get(activeAccountId) || null);
  } else {
    setActiveAccount(null);
  }

  // Persist updated store
  persistAccountStore();

  // Clear view caches for removed account
  driveCache.clear();
  drivePageState.clear();
  searchResultsCache.clear(); // Clear search results cache
  currentGridRequest = 0;
  Object.keys(viewSearchState).forEach((view) => {
    viewSearchState[view] = "";
  });

  // Update UI: if another account remains, stay signed-in; else show auth prompt
  if (signedInUser) {
    const storedPhoto = accountStore.accounts?.[activeAccountId || accountStore.active_account_id || ""]?.photoUrl;
    toggleAccountAvatar(signedInUser.photoUrl || storedPhoto || "");
    toggleAuthUI(true);
    hideAuthPrompt();
    // reload data for active account
    if (GRID_VIEWS.has("drive")) {
      renderLoading("drive");
      loadDriveContent("drive", { force: true });
    }
  } else {
    toggleAccountAvatar("");
    toggleAuthUI(false);
    showAuthPromptAfterLogout();
  }
}

function showAuthPromptAfterLogout() {
  // After logout, show auth prompt with Sign in button
  activeView = null;
  setActive(null);
  
  // Clear all content and show auth prompt
  contentEl.innerHTML = `
    <p class="content__placeholder" style="display: none;">Select an action to see Drive updates.</p>
    <div class="auth-prompt" id="auth-prompt">
      <div class="auth-prompt__image-wrapper">
        <svg class="auth-prompt__image" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
          <!-- Google Office illustration SVG -->
          <rect x="0" y="0" width="200" height="150" fill="#f8f9fa" rx="8"/>
          <!-- Google G logo in center -->
          <circle cx="100" cy="75" r="25" fill="#4285f4"/>
          <circle cx="100" cy="75" r="15" fill="#fff"/>
          <rect x="100" y="60" width="15" height="30" fill="#4285f4"/>
          <rect x="100" y="75" width="15" height="15" fill="#4285f4"/>
          <!-- People icons around -->
          <circle cx="60" cy="45" r="8" fill="#34a853"/>
          <rect x="55" y="53" width="10" height="15" fill="#34a853" rx="2"/>
          <circle cx="140" cy="45" r="8" fill="#ea4335"/>
          <rect x="135" y="53" width="10" height="15" fill="#ea4335" rx="2"/>
          <circle cx="60" cy="105" r="8" fill="#fbbc04"/>
          <rect x="55" y="113" width="10" height="15" fill="#fbbc04" rx="2"/>
          <circle cx="140" cy="105" r="8" fill="#673ab7"/>
          <rect x="135" y="113" width="10" height="15" fill="#673ab7" rx="2"/>
          <!-- Connecting lines -->
          <line x1="68" y1="50" x2="92" y2="70" stroke="#e8eaed" stroke-width="2"/>
          <line x1="132" y1="50" x2="108" y2="70" stroke="#e8eaed" stroke-width="2"/>
          <line x1="68" y1="110" x2="92" y2="90" stroke="#e8eaed" stroke-width="2"/>
          <line x1="132" y1="110" x2="108" y2="90" stroke="#e8eaed" stroke-width="2"/>
        </svg>
      </div>
      <div class="auth-prompt__content">
        <p class="auth-prompt__description">Sign in to get access to the most convenient Google Drive manager</p>
        <button class="auth-prompt__button" id="auth-prompt-button" type="button">
          <svg class="auth-prompt__button-icon" viewBox="0 0 533.5 544.3" width="20" height="20">
            <path d="M533.5 278.4c0-18.5-1.6-37-5.1-55H272v104.6h147.5c-6.3 33.8-25.6 62.6-54.5 81.7v67h88c51.6-47.6 80.5-117.8 80.5-198.3z" fill="#4285f4" />
            <path d="M272 544.3c73.8 0 135.8-24.5 181.1-66.6l-88-67c-24.4 16.4-55.7 26-93.1 26-71.6 0-132.3-48.3-154-113.4h-90.6v71.2c45 89.6 137.2 149.8 244.6 149.8z" fill="#34a853" />
            <path d="M118 323.3c-11.4-33.8-11.4-70.5 0-104.3V147.8h-90.6c-36.5 72.1-36.5 158.6 0 230.7z" fill="#fbbc05" />
            <path d="M272 107.7c39.9-.6 77.9 14.7 106.7 42.7l79.8-79.8C407.6 24.6 344.8-.3 272 0 164.6 0 72.4 60.2 27.4 149.8l90.6 71.2C139.7 155.9 200.4 107.7 272 107.7z" fill="#ea4335" />
          </svg>
          <span>Sign in with Google</span>
        </button>
      </div>
    </div>
  `;
  
  // Rebind auth button event
  const authPromptButton = document.getElementById("auth-prompt-button");
  if (authPromptButton) {
    authPromptButton.addEventListener("click", handleSignIn);
  }
  
  // Update UI to show unauthenticated state
  toggleAuthUI(false);
}

function updateContent(view) {
  if (view === "create") {
    renderCreateShortcuts();
    return;
  }

  if (GRID_VIEWS.has(view)) {
    renderLoading(view);
    loadDriveContent(view);
    return;
  }
}

function setActive(button) {
  // Clear all active states first
  buttons.forEach((btn) => {
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
  });
  
  if (accountButton) {
    accountButton.classList.remove("active");
    accountButton.setAttribute("aria-pressed", "false");
  }
  
  // Set active for the clicked button
  if (button) {
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
  }
}

async function handleSearchInput(event) {
  const input = event.currentTarget;
  const view = input.dataset.view;
  if (!SEARCHABLE_VIEWS.has(view)) return;
  
  const query = input.value;
  viewSearchState[view] = query;
  const caretPos = input.selectionStart ?? query.length;
  
  // Clear previous debounce timer for this view
  const existingTimer = searchDebounceTimers.get(view);
  if (existingTimer) {
    clearTimeout(existingTimer);
    searchDebounceTimers.delete(view);
  }
  
  // If query is empty, immediately load all documents from drive (or selected type)
  if (!query.trim()) {
    searchResultsCache.delete(view); // Clear search results cache
    
    // Immediately make request to get all documents from drive
    // If specific document type is selected, load all documents of that type
    renderLoading(view);
    loadDriveContent(view, { force: true, typeFilter: viewTypeFilter[view] || null, searchQuery: null });
    
    requestAnimationFrame(() => {
      const refreshedInput = contentEl.querySelector(`.content__search-input[data-view="${view}"]`);
      if (refreshedInput) {
        refreshedInput.focus();
        const nextPos = Math.min(caretPos, refreshedInput.value.length);
        refreshedInput.setSelectionRange(nextPos, nextPos);
      }
    });
    return;
  }
  
  // If there is text in Search field, load data with search query
  const timer = setTimeout(async () => {
    try {
      const currentInput = contentEl.querySelector(`.content__search-input[data-view="${view}"]`);
      if (currentInput && currentInput.value === query) {
        // Use standard loading logic with search query
        renderLoading(view);
        loadDriveContent(view, { 
          force: false, 
          typeFilter: viewTypeFilter[view] || null, 
          searchQuery: query 
        });
      }
    } catch (error) {
      console.error("Search error:", error);
      const finalInput = contentEl.querySelector(`.content__search-input[data-view="${view}"]`);
      if (finalInput && finalInput.value === query) {
        // Preserve header if it exists
        let header = contentEl.querySelector(".content__header");
        if (!header || !header.querySelector(`.content__search-input[data-view="${view}"]`)) {
          // If header is missing, create it
          if (header) header.remove();
          header = createSearchHeader(view, query);
          contentEl.appendChild(header);
        }
        
        // Remove old content, but preserve header
        const oldGrid = contentEl.querySelector(".content__grid");
        const oldPlaceholder = contentEl.querySelector(".content__placeholder");
        const oldLoader = contentEl.querySelector(".content__loader");
        if (oldGrid) oldGrid.remove();
        if (oldPlaceholder) oldPlaceholder.remove();
        if (oldLoader) oldLoader.remove();
        
        const errorMsg = document.createElement("p");
        errorMsg.className = "content__placeholder";
        if (error instanceof AuthRequiredError) {
          errorMsg.textContent = "You need to re-authorize to search files.";
        } else {
          errorMsg.textContent = `Search failed. Please try again.`;
        }
        contentEl.appendChild(errorMsg);
      }
    } finally {
      searchDebounceTimers.delete(view);
    }
  }, 500); // Debounce 500ms
  
  searchDebounceTimers.set(view, timer);
  
  // Show loading state, preserving header
  let header = contentEl.querySelector(".content__header");
  if (!header || !header.querySelector(`.content__search-input[data-view="${view}"]`)) {
    // If header is missing, create it
    if (header) header.remove();
    header = createSearchHeader(view, query);
    contentEl.appendChild(header);
  } else {
    // Update search value in existing header
    const searchInput = header.querySelector(`.content__search-input[data-view="${view}"]`);
    if (searchInput && searchInput.value !== query) {
      searchInput.value = query;
    }
    
    // Remove old content, but preserve header
    const oldGrid = contentEl.querySelector(".content__grid");
    const oldPlaceholder = contentEl.querySelector(".content__placeholder");
    if (oldGrid) oldGrid.remove();
    if (oldPlaceholder) oldPlaceholder.remove();
  }
  
  // Remove old loader if exists
  const oldLoader = contentEl.querySelector(".content__loader");
  if (oldLoader) oldLoader.remove();
  
  const loading = document.createElement("p");
  loading.className = "content__placeholder";
  loading.textContent = "Searching...";
  contentEl.appendChild(loading);
  
  requestAnimationFrame(() => {
    const refreshedInput = contentEl.querySelector(`.content__search-input[data-view="${view}"]`);
    if (refreshedInput) {
      refreshedInput.focus();
      const nextPos = Math.min(caretPos, refreshedInput.value.length);
      refreshedInput.setSelectionRange(nextPos, nextPos);
    }
  });
}

function isFilePinned(fileId) {
  return pinnedFileIds.includes(fileId);
}

function refreshCurrentGrid() {
  if (!GRID_VIEWS.has(activeView)) return;
  // Use the actual value from the search field if it exists
  const searchInput = contentEl.querySelector(`.content__search-input[data-view="${activeView}"]`);
  const currentQuery = searchInput?.value?.trim() || viewSearchState[activeView] || "";
  const searchQuery = currentQuery || null;
  const files = driveCache.get(getDriveCacheKey(activeView, viewTypeFilter[activeView] || null, searchQuery));
  if (files) {
    renderGrid(activeView, files, currentQuery);
    setupInfiniteScroll(activeView, viewTypeFilter[activeView] || null);
  }
}

function togglePinnedState(fileId) {
  const index = pinnedFileIds.indexOf(fileId);
  if (index >= 0) {
    pinnedFileIds.splice(index, 1);
  } else {
    pinnedFileIds.unshift(fileId);
  }
  persistPinnedState();
  refreshCurrentGrid();
}

function removePinnedState(fileId) {
  const index = pinnedFileIds.indexOf(fileId);
  if (index >= 0) {
    pinnedFileIds.splice(index, 1);
    persistPinnedState();
  }
}

function persistPinnedState() {
  if (chrome?.storage?.sync?.set) {
    chrome.storage.sync.set({ [PIN_STORAGE_KEY]: pinnedFileIds });
  }
}

function loadPinnedState() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync?.get) {
      pinnedFileIds = [];
      resolve();
      return;
    }
    chrome.storage.sync.get([PIN_STORAGE_KEY], (result) => {
      const stored = result?.[PIN_STORAGE_KEY];
      pinnedFileIds = Array.isArray(stored) ? stored : [];
      resolve();
    });
  });
}

function showDeleteConfirm(card, file) {
  if (card.querySelector(".doc-card__confirm")) return;
  const dialog = document.createElement("div");
  dialog.className = "doc-card__confirm";
  dialog.innerHTML = `
    <p>Delete “${escapeHtml(file.name)}”?</p>
    <div class="doc-card__confirm-actions">
      <button type="button" data-cancel>Cancel</button>
      <button type="button" data-confirm>OK</button>
    </div>
  `;

  const cancelBtn = dialog.querySelector("[data-cancel]");
  const confirmBtn = dialog.querySelector("[data-confirm]");

  cancelBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    dialog.remove();
  });

  confirmBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    confirmBtn.disabled = true;
    deleteDriveFile(file.id)
      .then(() => {
        removeFileFromCaches(file.id);
        removePinnedState(file.id);
        dialog.remove();
        refreshCurrentGrid();
      })
      .catch((error) => {
        dialog.remove();
        if (error instanceof AuthRequiredError) {
          console.error("Delete error (auth):", error);
          renderAuthPromptForGrantAccess(activeView);
        } else {
          console.error("Delete error:", error);
          renderStatus("Failed to delete the document. Please try again later.", "Back to files", () =>
            updateContent(activeView),
          );
        }
      });
  });

  card.appendChild(dialog);
}

async function deleteDriveFile(fileId, options = {}) {
  const { interactive = false, retried, reconsented } = options;
  
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&supportsTeamDrives=true`;
  
  const response = await executeDriveRequest(async (token) => {
    return await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }, interactive);

  if (response.status === 403) {
    const payload = await response.json().catch(() => null);
    const reason = payload?.error?.errors?.[0]?.reason;
    const permError =
      reason === "insufficientFilePermissions" ||
      reason === "fileNotWritable" ||
      reason === "insufficientPermissions" ||
      reason === "forbidden";

    if (permError) {
      const message =
        payload?.error?.message ||
        "This account does not have permission to delete this file. Switch to the owner/editor and try again.";
      throw new Error(message);
    }

    if (!retried) {
      // Retry once with interactive prompt to refresh scopes/session for the active account
      return deleteDriveFile(fileId, { interactive: true, retried: true });
    }

    const message =
      payload?.error?.message ||
      (response.status === 403 ? "Insufficient permissions to delete the file." : "Session expired, please re-authorize.");
    throw new AuthRequiredError(message);
  }

  if (!response.ok && response.status !== 204) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `Failed to delete the file (status ${response.status}).`);
  }
}

function removeFileFromCaches(fileId) {
  driveCache.forEach((files, key) => {
    const filtered = files.filter((file) => file.id !== fileId);
    driveCache.set(key, filtered);
    const state = drivePageState.get(key);
    if (state) {
      drivePageState.set(key, { ...state, files: filtered });
    }
  });
}

function toggleAccountAvatar(photoUrl) {
    if (!accountButton) return;
  
    // If photoUrl exists and is a valid URL — show avatar
    if (photoUrl && photoUrl.trim() !== "") {
      // Keep fallback visible until the avatar is fully loaded
      if (avatarFallback) {
        avatarFallback.hidden = false;
        avatarFallback.removeAttribute("hidden");
      }
      if (avatarImg) {
        // Reset visibility while loading a fresh avatar
        avatarImg.hidden = true;
        avatarImg.setAttribute("hidden", "hidden");
        avatarImg.removeAttribute("src");

        avatarImg.onload = () => {
          avatarImg.hidden = false;
          avatarImg.removeAttribute("hidden");
          if (avatarFallback) {
            avatarFallback.hidden = true;
            avatarFallback.setAttribute("hidden", "hidden");
          }
        };

        avatarImg.onerror = () => {
          avatarImg.hidden = true;
          avatarImg.setAttribute("hidden", "hidden");
          avatarImg.removeAttribute("src");
          if (avatarFallback) {
            avatarFallback.hidden = false;
            avatarFallback.removeAttribute("hidden");
          }
        };

        avatarImg.src = photoUrl;
      }
    } else {
      // No avatar — show fallback
      if (avatarImg) {
        avatarImg.hidden = true;
        avatarImg.setAttribute("hidden", "hidden");
        avatarImg.removeAttribute("src");
      }
      if (avatarFallback) {
        avatarFallback.hidden = false;
        avatarFallback.removeAttribute("hidden");
      }
  
      // Show SVG profile icon as fallback
      // If email exists, we could show initials, but we keep the icon
      if (signedInUser?.email) {
        const initials = signedInUser.email
          .split("@")[0]
          .split(/[.\-_]/)
          .map(part => part[0]?.toUpperCase() || "")
          .join("");
        // Could add initials text, but SVG is already displayed
        // avatarFallback.textContent = initials || ""; 
      }
    }
  }

function closeAccountMenu() {
  if (accountMenuEl) {
    accountMenuEl.classList.remove("account-menu--open");
  }
  if (accountMenuOutsideHandler) {
    document.removeEventListener("mousedown", accountMenuOutsideHandler);
    document.removeEventListener("keydown", accountMenuOutsideHandler);
    accountMenuOutsideHandler = null;
  }
}

function openAccountMenu() {
  if (!accountButton) return;
  if (!accountMenuEl) {
    accountMenuEl = document.createElement("div");
    accountMenuEl.className = "account-menu";
    accountMenuEl.style.userSelect = "none";
    accountMenuEl.style.caretColor = "transparent";
    accountMenuEl.setAttribute("tabindex", "-1");
    accountMenuEl.addEventListener("mousedown", (e) => {
      // Prevent text caret when clicking on empty space
      if (!(e.target instanceof HTMLButtonElement) && !(e.target instanceof SVGElement) && !(e.target instanceof HTMLImageElement)) {
        e.preventDefault();
      }
    });
    accountMenuEl.innerHTML = `
      <div class="account-menu__list"></div>
    `;
    document.body.appendChild(accountMenuEl);
  }

  const listEl = accountMenuEl.querySelector(".account-menu__list");
  if (!listEl) return;

  const visibleProfiles = accountProfiles.filter((profile) => profile.id !== activeAccountId);
  const itemsHtml = visibleProfiles
    .map((profile) => {
      const avatarContent = profile.photoUrl
        ? `<img src="${escapeHtml(profile.photoUrl)}" alt="${escapeHtml(profile.email)}" />`
        : `<span class="account-menu__initial">${escapeHtml((profile.email || "?")[0].toUpperCase())}</span>`;
      return `
        <button class="account-menu__item" data-account-id="${escapeHtml(profile.id)}" title="${escapeHtml(profile.email)}">
          ${avatarContent}
        </button>
      `;
    })
    .join("");

  const canAddMore = accountProfiles.length < 4;

  listEl.innerHTML = `
    ${itemsHtml}
    ${canAddMore ? `
      <button class="account-menu__item account-menu__item--add" data-account-add title="Add account">
        <span class="account-menu__plus">+</span>
      </button>
    ` : ""}
    <button class="account-menu__item account-menu__item--logout" data-account-logout title="Log out">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="16 17 21 12 16 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="21" y1="12" x2="9" y2="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  `;

  listEl.querySelectorAll("[data-account-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const accountId = btn.getAttribute("data-account-id");
      handleAccountSelect(accountId);
    });
  });

  const addBtn = listEl.querySelector("[data-account-add]");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      closeAccountMenu();
      startAddAccountFlow();
    });
  }

  const logoutBtn = listEl.querySelector("[data-account-logout]");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      closeAccountMenu();
      handleLogout();
    });
  }

  const rect = accountButton.getBoundingClientRect();
  const menuWidth = 56;
  const offset = 8;
  const left = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - offset);
  accountMenuEl.style.top = `${rect.bottom + offset}px`;
  accountMenuEl.style.left = `${Math.max(offset, left)}px`;

  accountMenuEl.classList.add("account-menu--open");

  if (!accountMenuOutsideHandler) {
    accountMenuOutsideHandler = (event) => {
      const isEscape = event instanceof KeyboardEvent && event.key === "Escape";
      const isOutsideClick =
        event instanceof MouseEvent &&
        accountMenuEl &&
        !accountMenuEl.contains(event.target) &&
        !accountButton.contains(event.target);

      if (isEscape || isOutsideClick) {
        closeAccountMenu();
      }
    };
    document.addEventListener("mousedown", accountMenuOutsideHandler);
    document.addEventListener("keydown", accountMenuOutsideHandler);
  }
}

function handleAccountSelect(accountId) {
  if (!accountId || accountId === activeAccountId) {
    closeAccountMenu();
    return;
  }

  const stored = accountStore.accounts?.[accountId];
  const storedToken = stored?.access_token || tokenCache.get(accountId) || null;
  setActiveAccount(accountId, storedToken);
  if (stored?.email) {
    signedInUser = { id: accountId, email: stored.email };
  }
  driveCache.clear();
  drivePageState.clear();
  searchResultsCache.clear(); // Clear search results cache
  currentGridRequest = 0;
  Object.keys(viewSearchState).forEach((view) => {
    viewSearchState[view] = "";
  });

  // Immediately show loading state if Drive view is active
  if (activeView === "drive") {
    renderLoading("drive");
  }

  initIdentity()
    .then(() => {
      if (GRID_VIEWS.has(activeView)) {
        renderLoading(activeView);
        loadDriveContent(activeView, { force: true, typeFilter: viewTypeFilter[activeView] || null });
      }

      // Always refresh Drive data when switching accounts
      if (GRID_VIEWS.has("drive")) {
        const driveOptions = { force: true, typeFilter: viewTypeFilter.drive || null };
        loadDriveContent("drive", driveOptions);
      }
    })
    .finally(() => {
      closeAccountMenu();
    });
}

function startAddAccountFlow() {
  closeAccountMenu();

  // Request all permissions at once for new users (minimizes clicks - 1 screen instead of 2)
  // includeGrantedScopes ensures incremental authorization still works for existing users
  return startGoogleOAuthFlow({ 
    scopes: ALL_REQUIRED_SCOPES,
    prompt: "consent",
    includeGrantedScopes: true 
  })
    .then(async (authResult) => {
      if (!authResult?.userId || !authResult?.email || !authResult?.accessToken) {
        console.warn("OAuth flow did not return required fields", authResult);
        return;
      }

      const existing = accountStore.accounts?.[authResult.userId] || {};
      const mergedRefreshToken = authResult.refreshToken || existing.refresh_token || "";
      accountStore.accounts[authResult.userId] = {
        email: authResult.email,
        access_token: authResult.accessToken,
        refresh_token: mergedRefreshToken,
        expires_at: authResult.expiresAt || 0,
        photoUrl: authResult.picture || existing.photoUrl || null,
      };
      accountStore.active_account_id = authResult.userId;

      syncAccountProfilesFromStore();
      await persistAccountStore();

      const token = authResult.accessToken;
      setActiveAccount(authResult.userId, token);
      signedInUser = { id: authResult.userId, email: authResult.email };
      upsertAccountProfile({
        id: authResult.userId,
        email: authResult.email,
        photoUrl: authResult.picture || existing.photoUrl || null,
        accessToken: token,
        refreshToken: mergedRefreshToken,
        expiresAt: authResult.expiresAt || 0,
      });
      toggleAccountAvatar(authResult.picture || null);
      toggleAuthUI(true);
      hideAuthPrompt();

      const driveButton = buttons.find((btn) => btn.dataset.view === "drive");
      if (driveButton) {
        activeView = "drive";
        setActive(driveButton);
      }
      if (GRID_VIEWS.has("drive")) {
        renderLoading("drive");
        loadDriveContent("drive", { force: true });
      }
    })
    .catch((error) => {
      // Ignore user cancellation errors
      const errorMessage = error?.message || String(error);
      const isUserCancellation = 
        errorMessage.toLowerCase().includes("did not approve") ||
        errorMessage.toLowerCase().includes("authorization was cancelled") ||
        errorMessage.toLowerCase().includes("user cancelled") ||
        errorMessage.toLowerCase().includes("access_denied");
      
      if (!isUserCancellation) {
        console.error("Add account error:", error);
      }
      // If user cancelled authorization, just do nothing
    });
}

// Avatar loading error handler
avatarImg?.addEventListener("error", () => {
    toggleAccountAvatar(null);
  });

function showAuthPrompt() {
  const authPrompt = document.getElementById("auth-prompt");
  if (authPrompt) {
    authPrompt.hidden = false;
    // Hide placeholder
    const placeholder = contentEl.querySelector(".content__placeholder");
    if (placeholder) placeholder.style.display = "none";
  }
}

function hideAuthPrompt() {
  const authPrompt = document.getElementById("auth-prompt");
  if (authPrompt) {
    authPrompt.hidden = true;
  }
}

function toggleAuthUI(isSignedIn) {
  if (!signInButton || !accountButton) return;
  
  const toolbarNav = document.getElementById("toolbar-nav");
  const toolbarCreate = document.querySelector(".toolbar__create");
  const toolbarCreateIcons = document.getElementById("toolbar-create-icons");
  const authPrompt = document.getElementById("auth-prompt");
  const toolbarSectionLeft = document.querySelector(".toolbar__section--left");
  const toolbarSectionCenter = document.querySelector(".toolbar__section--center");
  const toolbarSectionRight = document.querySelector(".toolbar__section--right");
  
  if (isSignedIn) {
    signInButton.hidden = true;
    accountButton.hidden = false;
    if (toolbarNav) {
      toolbarNav.hidden = false;
      toolbarNav.style.display = "flex";
    }
    if (toolbarCreate) toolbarCreate.hidden = false;
    if (toolbarCreateIcons) {
      toolbarCreateIcons.hidden = true;
      toolbarCreateIcons.style.display = "none";
    }
    if (authPrompt) authPrompt.hidden = true;
    if (toolbarSectionLeft) toolbarSectionLeft.style.display = "flex";
    if (toolbarSectionCenter) toolbarSectionCenter.style.display = "flex";
    if (toolbarSectionRight) toolbarSectionRight.style.display = "flex";
  } else {
    // Show sign in button and hide other elements
    signInButton.hidden = false;
    accountButton.hidden = true;
    if (toolbarNav) {
      toolbarNav.hidden = true;
      toolbarNav.style.display = "none"; // don't show Drive/Recent tabs for unauthorized users
    }
    if (toolbarCreate) toolbarCreate.hidden = true;
    if (toolbarSectionLeft) toolbarSectionLeft.style.display = "none";
    if (toolbarSectionCenter) toolbarSectionCenter.style.display = "flex";
    if (toolbarSectionRight) toolbarSectionRight.style.display = "none";
    if (toolbarCreateIcons) {
      toolbarCreateIcons.hidden = false;
      toolbarCreateIcons.style.display = "flex"; // show row of document icons
      renderCreateIconsInToolbar();
    }
    if (authPrompt) {
      authPrompt.hidden = false;
    }
  }
}

function renderCreateIconsInToolbar() {
  const container = document.getElementById("toolbar-create-icons");
  if (!container) return;
  
  container.innerHTML = "";
  
  CREATE_SHORTCUTS.forEach((item) => {
    const button = document.createElement("button");
    button.className = "toolbar__create-icon-btn";
    button.type = "button";
    button.title = item.label;
    button.innerHTML = `<img src="${item.iconUrl}" alt="${item.label}" width="20" height="20" />`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDocumentInSideWindow(item.url);
    });
    container.appendChild(button);
  });
}

function initIdentity() {
  return new Promise((resolve) => {
    if (!chrome?.identity?.getProfileUserInfo) {
      signedInUser = null;
      toggleAuthUI(false);
      showAuthPrompt();
      resolve();
      return;
    }

    // First check if user explicitly logged out from extension
    if (chrome?.storage?.sync?.get) {
      chrome.storage.sync.get([LOGOUT_STATE_KEY], (result) => {
        const isLoggedOut = result?.[LOGOUT_STATE_KEY];
        
        if (isLoggedOut) {
          // User explicitly logged out from extension - show auth prompt
          signedInUser = null;
          cachedToken = null;
          toggleAuthUI(false);
          showAuthPrompt();
          resolve();
          return;
        }

        const storedActiveId = accountStore.active_account_id || activeAccountId;
        const storedActiveAccount = storedActiveId ? accountStore.accounts?.[storedActiveId] : null;
        if (storedActiveAccount?.email) {
          signedInUser = { id: storedActiveId, email: storedActiveAccount.email };
          setActiveAccount(storedActiveId, storedActiveAccount.access_token || null);
          toggleAuthUI(true);
          fetchUserAvatar({ size: 64, interactive: false })
            .then((photoUrl) => {
              if (photoUrl) {
                toggleAccountAvatar(photoUrl);
              }
            })
            .catch((error) => {
              console.warn("Failed to fetch avatar for stored account", error);
            })
            .finally(resolve);
          hideAuthPrompt();
          return;
        }
        
        // Try to get extension auth token (non-interactive)
        // This will only succeed if user is authorized in extension
        getAuthToken(false)
          .then((token) => {
            // User is authorized in extension - get profile info
            cachedToken = token;
            if (activeAccountId) {
              tokenCache.set(activeAccountId, token);
            }
            chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (userInfo) => {
              if (chrome.runtime.lastError) {
                console.warn("Identity error:", chrome.runtime.lastError.message);
                signedInUser = null;
                setActiveAccount(null);
                toggleAuthUI(false);
                showAuthPrompt();
                resolve();
                return;
              }

              const hasAccount = Boolean(userInfo?.email);
              signedInUser = hasAccount ? userInfo : null;
              if (hasAccount) {
                setActiveAccount(userInfo.id || null, cachedToken);
              } else {
                setActiveAccount(null);
              }
              toggleAuthUI(hasAccount);

              if (hasAccount) {
                // Get avatar through Google OAuth2 UserInfo API
                fetchUserAvatar({ size: 64, interactive: false })
                  .then((photoUrl) => {
                    if (photoUrl) {
                      toggleAccountAvatar(photoUrl);
                    } else {
                      // Fallback to old method if API didn't return photo
                      const fallbackUrl = userInfo.id
                        ? `https://lh3.googleusercontent.com/a/${userInfo.id}?sz=64`
                        : null;
                      toggleAccountAvatar(fallbackUrl);
                    }
                    upsertAccountProfile({
                      id: userInfo.id,
                      email: userInfo.email,
                      photoUrl: avatarImg?.src || photoUrl || null,
                    });
                  })
                  .catch((error) => {
                    console.warn("Failed to fetch avatar, using fallback:", error);
                    // Fallback to old method if API is unavailable
                    const fallbackUrl = userInfo.id
                      ? `https://lh3.googleusercontent.com/a/${userInfo.id}?sz=64`
                      : null;
                    toggleAccountAvatar(fallbackUrl);
                    upsertAccountProfile({
                      id: userInfo.id,
                      email: userInfo.email,
                      photoUrl: fallbackUrl,
                    });
                  });
                hideAuthPrompt();
              } else {
                showAuthPrompt();
              }
              
              resolve();
            });
          })
          .catch(() => {
            // No token available - user is not authorized in extension
            // Show auth prompt regardless of Google login status
            signedInUser = null;
            cachedToken = null;
            setActiveAccount(null);
            toggleAuthUI(false);
            showAuthPrompt();
            resolve();
          });
      });
    } else {
      // No storage available - try to get extension auth token
      const storedActiveId = accountStore.active_account_id || activeAccountId;
      const storedActiveAccount = storedActiveId ? accountStore.accounts?.[storedActiveId] : null;
      if (storedActiveAccount?.email) {
        signedInUser = { id: storedActiveId, email: storedActiveAccount.email };
        setActiveAccount(storedActiveId, storedActiveAccount.access_token || null);
        toggleAuthUI(true);
        fetchUserAvatar({ size: 64, interactive: false })
          .then((photoUrl) => {
            if (photoUrl) {
              toggleAccountAvatar(photoUrl);
            }
          })
          .catch((error) => {
            console.warn("Failed to fetch avatar for stored account (no sync)", error);
          })
          .finally(resolve);
        hideAuthPrompt();
        return;
      }

      getAuthToken(false)
        .then((token) => {
          cachedToken = token;
          if (activeAccountId) {
            tokenCache.set(activeAccountId, token);
          }
          chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (userInfo) => {
            if (chrome.runtime.lastError) {
              console.warn("Identity error:", chrome.runtime.lastError.message);
              signedInUser = null;
              setActiveAccount(null);
              toggleAuthUI(false);
              showAuthPrompt();
              resolve();
              return;
            }

            const hasAccount = Boolean(userInfo?.email);
            signedInUser = hasAccount ? userInfo : null;
            if (hasAccount) {
              setActiveAccount(userInfo.id || null, cachedToken);
            } else {
              setActiveAccount(null);
            }
            toggleAuthUI(hasAccount);

            if (hasAccount) {
              // Get avatar through Google OAuth2 UserInfo API
              fetchUserAvatar({ size: 64, interactive: false })
                .then((photoUrl) => {
                  if (photoUrl) {
                    toggleAccountAvatar(photoUrl);
                  } else {
                    // Fallback to old method if API didn't return photo
                    const fallbackUrl = userInfo.id
                      ? `https://lh3.googleusercontent.com/a/${userInfo.id}?sz=64`
                      : null;
                    toggleAccountAvatar(fallbackUrl);
                  }
                  upsertAccountProfile({
                    id: userInfo.id,
                    email: userInfo.email,
                    photoUrl: avatarImg?.src || photoUrl || null,
                  });
                })
                .catch((error) => {
                  console.warn("Failed to fetch avatar, using fallback:", error);
                  // Fallback to old method if API is unavailable
                  const fallbackUrl = userInfo.id
                    ? `https://lh3.googleusercontent.com/a/${userInfo.id}?sz=64`
                    : null;
                  toggleAccountAvatar(fallbackUrl);
                  upsertAccountProfile({
                    id: userInfo.id,
                    email: userInfo.email,
                    photoUrl: fallbackUrl,
                  });
                });
              hideAuthPrompt();
            } else {
              showAuthPrompt();
            }
            
            resolve();
          });
        })
        .catch(() => {
          // No token available - user is not authorized in extension
          signedInUser = null;
          cachedToken = null;
          toggleAuthUI(false);
          showAuthPrompt();
          resolve();
        });
    }
  });
}

function isAuthError(message = "", interactive) {
  if (!message) return !interactive;
  const normalized = message.toLowerCase();
  return AUTH_ERROR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

/**
 * Checks if token is expired or will expire soon (with 5 minute buffer)
 * @param {number} expiresAt - Token expiration time in milliseconds
 * @returns {boolean} - true if token is expired or will expire soon
 */
function isTokenExpiredOrExpiringSoon(expiresAt) {
  if (!expiresAt) return true;
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 minute buffer
  return expiresAt - bufferTime <= now;
}

/**
 * Refreshes access token using refresh token
 * @param {string} accountId - Account ID
 * @param {Object} storedAccount - Account data from storage
 * @returns {Promise<string|null>} - New access token or null on error
 */
async function refreshAccessTokenForAccount(accountId, storedAccount) {
  if (!storedAccount?.refresh_token) {
    console.warn(`No refresh token available for account ${accountId}`);
    return null;
  }

  try {
    console.log(`Refreshing access token for account ${accountId}`);
    const refreshed = await refreshGoogleAccessToken(storedAccount.refresh_token);
    const refreshedToken = refreshed?.accessToken;
    
    if (!refreshedToken) {
      console.error("Refresh token response did not contain access token");
      return null;
    }

    const now = Date.now();
    const refreshedExpiresAt = refreshed?.expiresAt || 
      (refreshed?.expiresIn ? now + refreshed.expiresIn * 1000 : now + 3_600_000);
    const refreshedRefresh = refreshed?.refreshToken || storedAccount.refresh_token;

    // Update account data
    accountStore.accounts[accountId] = {
      ...storedAccount,
      access_token: refreshedToken,
      refresh_token: refreshedRefresh,
      expires_at: refreshedExpiresAt,
    };

    // Update caches
    cachedToken = refreshedToken;
    tokenCache.set(accountId, refreshedToken);
    
    // Save updated data
    await persistAccountStore();
    
    console.log(`Successfully refreshed access token for account ${accountId}`);
    return refreshedToken;
  } catch (error) {
    const errorMessage = error?.message || String(error);
    console.error(`Failed to refresh access token for account ${accountId}:`, errorMessage);
    
    // Check if error indicates invalid refresh token
    const isInvalidRefreshToken = 
      errorMessage.includes("invalid_grant") ||
      errorMessage.includes("invalid_request") ||
      errorMessage.includes("Token has been expired or revoked");
    
    if (isInvalidRefreshToken) {
      console.warn(`Refresh token is invalid for account ${accountId}, clearing account data`);
      // Remove invalid refresh token from storage
      if (accountStore.accounts[accountId]) {
        delete accountStore.accounts[accountId].refresh_token;
        await persistAccountStore();
      }
    }
    
    return null;
  }
}

async function getAuthToken(interactive = false, extraOptions = {}) {
  const opts = typeof extraOptions === "object" && extraOptions !== null ? extraOptions : {};
  const { forcePrompt = false, accountIdOverride, forceNewSession = false } = opts;

  const accountId = accountIdOverride !== undefined ? accountIdOverride : activeAccountId || accountStore.active_account_id || null;
  const storedAccount = accountId ? accountStore.accounts?.[accountId] : null;
  const now = Date.now();

  // If forceNewSession, clear cached token
  if (forceNewSession) {
    cachedToken = null;
    if (accountId) {
      tokenCache.delete(accountId);
    }
  }

  // If there is a saved account with token
  if (!forcePrompt && storedAccount?.access_token) {
    const expiresAt = storedAccount.expires_at || 0;
    
    // Check if token has not expired
    if (!isTokenExpiredOrExpiringSoon(expiresAt)) {
      // Token is valid, use it
      cachedToken = storedAccount.access_token;
      tokenCache.set(accountId, cachedToken);
      return cachedToken;
    }
    
    // Token expired or will expire soon, try to refresh
    if (storedAccount.refresh_token) {
      const refreshedToken = await refreshAccessTokenForAccount(accountId, storedAccount);
      if (refreshedToken) {
        return refreshedToken;
      }
      // If refresh failed, continue
    } else {
      console.warn(`No refresh token available for account ${accountId}, token expired`);
    }
  }

  // If there is a cached token (but no saved account)
  if (!forcePrompt && cachedToken) {
    // Check if there is a saved account for this token
    if (accountId && storedAccount) {
      const expiresAt = storedAccount.expires_at || 0;
      if (!isTokenExpiredOrExpiringSoon(expiresAt)) {
        return cachedToken;
      }
    } else {
      // If no expiration data, use cache (but this is not ideal)
      return cachedToken;
    }
  }

  // If we're here, there is no valid token
  // For non-interactive calls, throw error
  if (!interactive) {
    throw new AuthRequiredError("Authorization required. Please sign in again.");
  }

  // Interactive path: perform OAuth flow
  // Request all permissions at once for new users (minimizes clicks - 1 screen instead of 2)
  // includeGrantedScopes ensures incremental authorization still works for existing users
  try {
    const authResult = await startGoogleOAuthFlow({ 
      scopes: ALL_REQUIRED_SCOPES,
      prompt: "consent",
      includeGrantedScopes: true 
    });
    if (!authResult?.accessToken || !authResult?.userId) {
      throw new AuthRequiredError("Authorization failed");
    }

    const mergedRefresh = authResult.refreshToken || "";
    const expiresAt = authResult.expiresAt || (authResult.expiresIn ? now + authResult.expiresIn * 1000 : now + 3_600_000);
    
    accountStore.accounts[authResult.userId] = {
      email: authResult.email || "",
      access_token: authResult.accessToken,
      refresh_token: mergedRefresh,
      expires_at: expiresAt,
      photoUrl: authResult.picture || null,
    };
    accountStore.active_account_id = authResult.userId;
    syncAccountProfilesFromStore();
    await persistAccountStore();
    activeAccountId = authResult.userId;
    cachedToken = authResult.accessToken;
    tokenCache.set(authResult.userId, authResult.accessToken);
    drivePageState.clear();
    driveCache.clear();

    return authResult.accessToken;
  } catch (error) {
    console.error("OAuth flow failed:", error);
    throw new AuthRequiredError(`Authorization failed: ${error.message || "Unknown error"}`);
  }
}

function invalidateToken(token) {
  if (!token) return;
  if (chrome?.identity?.removeCachedAuthToken) {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      if (chrome.runtime.lastError) {
        console.warn("Failed to remove cached token:", chrome.runtime.lastError.message);
      }
    });
  }
  if (cachedToken === token) {
    cachedToken = null;
  }
  // Remove token from per-account cache as well
  for (const [accountId, storedToken] of tokenCache.entries()) {
    if (storedToken === token) {
      tokenCache.delete(accountId);
    }
  }
}

/**
 * Executes Drive API request with automatic scope request if needed
 * Automatically requests Drive scopes incrementally if permission error occurs
 * This happens in the background - user only sees Google consent screen if needed
 * @param {Function} fetchFn - Function that executes request with token
 * @param {boolean} interactive - Allow interactive authorization
 * @returns {Promise<any>} - Request result
 */
async function executeDriveRequest(fetchFn, interactive = false) {
  try {
    const response = await executeApiRequestWithTokenRefresh(fetchFn, interactive);
    
    // Check if response indicates insufficient permissions
    if (response.status === 403) {
      const errorPayload = await response.clone().json().catch(() => null);
      const reason = errorPayload?.error?.errors?.[0]?.reason;
      if (reason === "insufficientPermissions" || reason === "insufficientFilePermissions") {
        // Automatically request Drive scopes incrementally
        const authResult = await ensureScopes(DRIVE_SCOPES, {
          loginHint: getActiveAccountEmail() || undefined,
        });

        // Update account store with new token if auth result was returned
        if (authResult?.userId && authResult?.accessToken) {
          const existing = accountStore.accounts?.[authResult.userId] || {};
          accountStore.accounts[authResult.userId] = {
            email: authResult.email || existing.email || "",
            access_token: authResult.accessToken,
            refresh_token: authResult.refreshToken || existing.refresh_token || "",
            expires_at: authResult.expiresAt || existing.expires_at || 0,
            photoUrl: authResult.picture || existing.photoUrl || null,
          };
          
          // Update active account if it matches
          if (activeAccountId === authResult.userId || accountStore.active_account_id === authResult.userId) {
            setActiveAccount(authResult.userId, authResult.accessToken);
            if (authResult.email) {
              signedInUser = { id: authResult.userId, email: authResult.email };
            }
          }
          
          await persistAccountStore();
        }

        // After getting permissions - retry request
        return await executeApiRequestWithTokenRefresh(fetchFn, false);
      }
    }
    
    return response;
  } catch (err) {
    const message = err?.message || "";
    const needsScope =
      err instanceof AuthRequiredError ||
      message.toLowerCase().includes("insufficientpermissions") ||
      message.toLowerCase().includes("insufficientfilepermissions") ||
      message.toLowerCase().includes("forbidden") ||
      message.toLowerCase().includes("insufficient permissions") ||
      message.toLowerCase().includes("re-authorize");

    if (needsScope) {
      // Automatically request Drive scopes incrementally (only Google consent screen will appear)
      try {
        const authResult = await ensureScopes(DRIVE_SCOPES, {
          loginHint: getActiveAccountEmail() || undefined,
        });

        // Update account store with new token if auth result was returned
        if (authResult?.userId && authResult?.accessToken) {
          const existing = accountStore.accounts?.[authResult.userId] || {};
          accountStore.accounts[authResult.userId] = {
            email: authResult.email || existing.email || "",
            access_token: authResult.accessToken,
            refresh_token: authResult.refreshToken || existing.refresh_token || "",
            expires_at: authResult.expiresAt || existing.expires_at || 0,
            photoUrl: authResult.picture || existing.photoUrl || null,
          };
          
          // Update active account if it matches
          if (activeAccountId === authResult.userId || accountStore.active_account_id === authResult.userId) {
            setActiveAccount(authResult.userId, authResult.accessToken);
            if (authResult.email) {
              signedInUser = { id: authResult.userId, email: authResult.email };
            }
          }
          
          await persistAccountStore();
        }

        // After getting permissions - retry request
        return await executeApiRequestWithTokenRefresh(fetchFn, false);
      } catch (scopeError) {
        // If scope request failed, throw original error
        throw err;
      }
    }
    throw err;
  }
}

/**
 * Executes API request with automatic token refresh on 401 error
 * @param {Function} fetchFn - Function that executes request with token
 * @param {boolean} interactive - Allow interactive authorization
 * @returns {Promise<any>} - Request result
 */
async function executeApiRequestWithTokenRefresh(fetchFn, interactive = false) {
  let token = await getAuthToken(interactive);
  let response = await fetchFn(token);
  
  // If we got 401, try to refresh token and retry request
  if (response.status === 401) {
    console.log("Received 401, attempting to refresh token and retry request");
    invalidateToken(token);
    
    // Try to get new token (with refresh through refresh token)
    try {
      token = await getAuthToken(interactive, { forcePrompt: false });
      response = await fetchFn(token);
      
      // If 401 again, refresh token is invalid
      if (response.status === 401) {
        console.error("Token refresh failed, refresh token may be invalid");
        invalidateToken(token);
        throw new AuthRequiredError("Session expired. Please sign in again.");
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        throw error;
      }
      console.error("Failed to refresh token after 401:", error);
      throw new AuthRequiredError("Session expired. Please sign in again.");
    }
  }
  
  return response;
}

/**
 * Revoke OAuth token on Google's side to force a fresh OAuth grant next time.
 * Best-effort: failures are logged but do not block logout completion.
 * @param {string} token
 * @returns {Promise<void>}
 */
function revokeOAuthToken(token) {
  if (!token) return Promise.resolve();
  return fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
    .catch((error) => {
      console.warn("Failed to revoke OAuth token", error);
    })
    .then(() => undefined);
}

/**
 * Gets user avatar URL through Google OAuth2 UserInfo API
 * @param {Object} options - Options for getting avatar
 * @param {boolean} options.interactive - Request token in interactive mode
 * @param {number} options.size - Avatar size (default 64)
 * @returns {Promise<string|null>} Avatar URL or null if failed to get
 */
async function fetchUserAvatar({ interactive = false, size = 64 } = {}) {
  try {
    const response = await executeApiRequestWithTokenRefresh(async (token) => {
      return await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
    }, interactive);

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const message = errorPayload?.error?.message;
      console.error("UserInfo API error:", message || response.statusText);
      throw new Error(`UserInfo API error: ${message || response.statusText}`);
    }

    const data = await response.json();
    
    // Extract photo URL from response
    if (data?.picture) {
      let photoUrl = data.picture;
      
      // If need to change size, replace s=96 parameter with desired size
      if (size && photoUrl) {
        // URL is usually in format: https://lh3.googleusercontent.com/a/...=s96-c
        // Replace s=96 with desired size
        photoUrl = photoUrl.replace(/s\d+-c$/, `s${size}-c`);
        
        // If no size parameter, add it
        if (!photoUrl.includes('=s')) {
          photoUrl = `${photoUrl}=s${size}-c`;
        }
      }
      
      return photoUrl;
    }
    
    // If photo not found, return null
    return null;
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      throw error;
    }
    console.error("Failed to fetch user avatar:", error);
    return null;
  }
}

async function fetchUserProfileFromToken(token, size = 64) {
  if (!token) return null;
  try {
    const response = await executeApiRequestWithTokenRefresh(async (token) => {
      return await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
    }, false);
    
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.id || !data?.email) return null;
    let photoUrl = data.picture || null;
    if (photoUrl && size) {
      photoUrl = photoUrl.replace(/s\d+-c$/, `s${size}-c`);
      if (!photoUrl.includes("=s")) {
        photoUrl = `${photoUrl}=s${size}-c`;
      }
    }
    return {
      id: data.id,
      email: data.email,
      photoUrl,
    };
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      console.warn("Auth required while fetching profile:", e);
    } else {
      console.warn("Failed to fetch profile via token", e);
    }
    return null;
  }
}

function buildDriveQuery(view, typeFilter, searchQuery = null) {
  const base = DRIVE_QUERIES[view] || DRIVE_QUERIES.drive;
  let query = base;
  
  // If there is a search query, add name filtering
  if (searchQuery && searchQuery.trim()) {
    const escapedQuery = searchQuery.replace(/['"]/g, "\\$&");
    query = `(${base}) and name contains '${escapedQuery}'`;
  }
  
  // If there is a type filter, add it
  if (typeFilter) {
    const mime = GOOGLE_TYPES.find((t) => t.key === typeFilter)?.mime;
    if (mime) {
      query = `(${query}) and mimeType='${mime}'`;
    }
  }
  
  return query;
}

/**
 * Search files through Google Drive API by name
 * @param {string} searchQuery - Search query
 * @param {boolean} interactive - Request token in interactive mode
 * @returns {Promise<Array>} Array of found files
 */
async function searchDriveFiles(searchQuery, { interactive = false } = {}) {
  if (!searchQuery || !searchQuery.trim()) {
    return [];
  }

  // Escape special characters in search query
  const escapedQuery = searchQuery.replace(/['"]/g, "\\$&");
  
  // Search all Google document types containing query in name
  const query = `name contains '${escapedQuery}' and mimeType contains 'application/vnd.google-apps'`;
  
  const params = new URLSearchParams({
    q: query,
    fields: "nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink,modifiedTime,viewedByMeTime)",
    orderBy: "modifiedTime desc",
    pageSize: "50", // Increase size for search
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "false",
    corpora: "user",
  });

  const response = await executeDriveRequest(async (token) => {
    return await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }, interactive);

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const message = errorPayload?.error?.message;
    const reason = errorPayload?.error?.errors?.[0]?.reason;
    if (response.status === 403 && reason === "insufficientPermissions") {
      throw new AuthRequiredError("You need to re-authorize to search files.");
    }
    throw new Error(`Drive API search error: ${message || response.statusText}`);
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Executes API request with automatic token refresh on 401 error
 * @param {Function} fetchFn - Function that executes request with token
 * @param {boolean} interactive - Allow interactive authorization
 * @returns {Promise<any>} - Request result
 */
async function fetchDriveFiles(view, { interactive = false, pageToken = null, typeFilter = null, searchQuery = null } = {}) {
  const params = new URLSearchParams({
    q: buildDriveQuery(view, typeFilter, searchQuery),
    fields: "nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink,modifiedTime,viewedByMeTime)",
    orderBy: "modifiedTime desc",
    pageSize: "10",
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "false",
    corpora: "user",
  });

  if (view === "recent") {
    params.set("orderBy", "viewedByMeTime desc");
  }

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
  
  const response = await executeDriveRequest(async (token) => {
    return await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }, interactive);

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const message = errorPayload?.error?.message;
    const reason = errorPayload?.error?.errors?.[0]?.reason;
    
    if (response.status === 403 && reason === "insufficientPermissions") {
      throw new AuthRequiredError("You need to re-authorize to view files.");
    }
    
    throw new Error(`Drive API error: ${message || response.statusText}`);
  }

  const data = await response.json();
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken || null,
  };
}

function getDriveCacheKey(view, typeFilter = viewTypeFilter[view] || null, searchQuery = null) {
  const searchPart = searchQuery && searchQuery.trim() ? `::search:${searchQuery.trim()}` : "";
  return `${activeAccountId || "anon"}::${view}::${typeFilter || "all"}${searchPart}`;
}

async function ensureDriveData(view, options = {}) {
  const { force = false, interactive = false, typeFilter = viewTypeFilter[view] || null, searchQuery = viewSearchState[view] || null } = options;
  const cacheKey = getDriveCacheKey(view, typeFilter, searchQuery);
  const pageState = drivePageState.get(cacheKey);

  if (!force && driveCache.has(cacheKey)) {
    return driveCache.get(cacheKey);
  }

  // Reset state if forced
  const initialState = {
    files: [],
    nextPageToken: null,
    loading: false,
    exhausted: false,
  };
  drivePageState.set(cacheKey, { ...initialState, loading: true });

  const { files, nextPageToken } = await fetchDriveFiles(view, { interactive, pageToken: null, typeFilter, searchQuery });
  driveCache.set(cacheKey, files);
  drivePageState.set(cacheKey, {
    files,
    nextPageToken,
    loading: false,
    exhausted: !nextPageToken,
  });
  return files;
}

function loadDriveContent(view, options = {}) {
  const requestId = ++currentGridRequest;
  const searchQuery = options.searchQuery !== undefined ? options.searchQuery : (viewSearchState[view] || null);
  ensureDriveData(view, { ...options, searchQuery })
    .then((files) => {
      if (requestId !== currentGridRequest) return;
      if (files.length === 0 && searchQuery && searchQuery.trim()) {
        // If no search results, show message, preserving header
        let header = contentEl.querySelector(".content__header");
        if (!header || !header.querySelector(`.content__search-input[data-view="${view}"]`)) {
          // If header is missing, create it
          if (header) header.remove();
          header = createSearchHeader(view, searchQuery);
          contentEl.appendChild(header);
        } else {
          // Update type filter display to match currently selected type
          const baseButton = header.querySelector(`.content__type-filter-base`);
          if (baseButton) {
            const currentType = viewTypeFilter[view];
            if (currentType && TYPE_FILTER_ICONS[currentType]) {
              baseButton.innerHTML = `<img src="${TYPE_FILTER_ICONS[currentType]}" alt="${currentType}" width="20" height="20" />`;
              baseButton.title =
                currentType === "docs"
                  ? "Documents"
                  : currentType === "sheets"
                    ? "Sheets"
                    : currentType === "slides"
                      ? "Slides"
                      : "Forms";
            } else {
              baseButton.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 9h6M9 15h6M9 12h6"/></svg>`;
              baseButton.title = "All types";
            }
          }
        }
        
        // Remove old content, but preserve header
        const oldGrid = contentEl.querySelector(".content__grid");
        const oldPlaceholder = contentEl.querySelector(".content__placeholder");
        const oldLoader = contentEl.querySelector(".content__loader");
        if (oldGrid) oldGrid.remove();
        if (oldPlaceholder) oldPlaceholder.remove();
        if (oldLoader) oldLoader.remove();
        
        const empty = document.createElement("p");
        empty.className = "content__placeholder";
        empty.textContent = `No files found matching "${escapeHtml(searchQuery)}".`;
        contentEl.appendChild(empty);
      } else {
        renderGrid(view, files, searchQuery || "");
        setupInfiniteScroll(view, options.typeFilter ?? (viewTypeFilter[view] || null));
      }
    })
    .catch((error) => {
      if (requestId !== currentGridRequest) return;
      if (error instanceof AuthRequiredError) {
        renderAuthPromptForGrantAccess(view, searchQuery);
        return;
      }
      console.error("Drive load error:", error);
      renderStatus("Failed to load documents. Try again later.", "Retry", () =>
        loadDriveContent(view, { force: true, searchQuery }),
      );
    });
}
  
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const { view } = button.dataset;
      const previousView = activeView;
      activeView = view;
  
      setActive(button);
      
      // Clear search results cache when switching view
      if (previousView && previousView !== view && SEARCHABLE_VIEWS.has(previousView)) {
        searchResultsCache.delete(previousView);
      }
      
      // Force refresh for Drive and Recent views
      if (view === "drive" || view === "recent") {
        renderLoading(view);
        loadDriveContent(view, { force: true });
      } else {
        updateContent(view);
      }
    });
  });

  // Account button handler (separate from other buttons)
  if (accountButton) {
    accountButton.addEventListener("click", () => {
      // Toggle account menu visibility
      if (accountMenuEl?.classList.contains("account-menu--open")) {
        closeAccountMenu();
      } else {
        openAccountMenu();
      }
    });
  }
  
loadAccountStore().then(() => {
  loadPinnedState().finally(() => {
    // Check if user just logged out - if so, don't show Create view
    if (chrome?.storage?.sync?.get) {
      chrome.storage.sync.get([LOGOUT_STATE_KEY], (result) => {
        const isLoggedOut = result?.[LOGOUT_STATE_KEY];
        if (!isLoggedOut && signedInUser) {
          // User is signed in and not logged out - show Create view by default
          const createButton = buttons.find((btn) => btn.dataset.view === "create");
          if (createButton) {
            activeView = "create";
            setActive(createButton);
            updateContent("create");
          }
        }
        // If logged out, auth prompt will be shown by initIdentity
      });
    } else {
      // No storage - show Create view by default only if signed in
      const createButton = signedInUser
        ? buttons.find((btn) => btn.dataset.view === "create")
        : null;
      if (createButton) {
        activeView = "create";
        setActive(createButton);
        updateContent("create");
      }
    }
  });

  // Initialize identity and UI
  initIdentity().then(() => {
    // Check if user is logged out - if so, show auth prompt instead of Create
    if (chrome?.storage?.sync?.get) {
      chrome.storage.sync.get([LOGOUT_STATE_KEY], (result) => {
        const isLoggedOut = result?.[LOGOUT_STATE_KEY];
        if (isLoggedOut && !signedInUser) {
          // User is logged out - show auth prompt
          showAuthPromptAfterLogout();
        } else if (!isLoggedOut && activeView !== "create" && signedInUser) {
          // User is not logged out and Create view is not shown - show it
          const createButton = buttons.find((btn) => btn.dataset.view === "create");
          if (createButton) {
            activeView = "create";
            setActive(createButton);
            updateContent("create");
          }
        }
        
        // Update auth UI based on sign-in status
        if (!signedInUser) {
          toggleAuthUI(false);
        }
      });
    } else {
      // No storage - update UI based on sign-in status
      if (!signedInUser) {
        toggleAuthUI(false);
      }
    }
  });
});

function handleSignIn() {
  const authButton = document.getElementById("auth-prompt-button") || signInButton;
  if (!authButton) return;

  // Show brief status so it's visible that something is happening
  const originalLabel = authButton.innerHTML;
  authButton.textContent = "Signing in...";
  authButton.disabled = true;

  // Clear cached token in memory immediately
  cachedToken = null;
  
  // Clear logout state (user is trying to sign in) - do this asynchronously, don't wait
  if (chrome?.storage?.sync?.set) {
    chrome.storage.sync.set({ [LOGOUT_STATE_KEY]: false });
  }
  
  // Clear all cached tokens asynchronously (don't wait for it)
  chrome.identity.clearAllCachedAuthTokens(() => {
    console.log("All Google auth tokens cleared");
  });
  
  startAddAccountFlow()
    .catch((error) => {
      console.error("Sign in error:", error);
    })
    .finally(() => {
      authButton.innerHTML = originalLabel;
      authButton.disabled = false;
    });
}

if (signInButton) {
  signInButton.addEventListener("click", handleSignIn);
}

const authPromptButton = document.getElementById("auth-prompt-button");
if (authPromptButton) {
  authPromptButton.addEventListener("click", handleSignIn);
}

// Theme Switcher
const THEME_STORAGE_KEY = "driveDeskTheme";
const themeSwitcher = document.getElementById("theme-switcher");

function loadTheme() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync?.get) {
      resolve("light");
      return;
    }
    chrome.storage.sync.get([THEME_STORAGE_KEY], (result) => {
      const theme = result?.[THEME_STORAGE_KEY] || "light";
      resolve(theme);
    });
  });
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    if (themeSwitcher) {
      themeSwitcher.checked = true;
    }
  } else {
    document.documentElement.removeAttribute("data-theme");
    if (themeSwitcher) {
      themeSwitcher.checked = false;
    }
  }
}

function saveTheme(theme) {
  if (chrome?.storage?.sync?.set) {
    chrome.storage.sync.set({ [THEME_STORAGE_KEY]: theme });
  }
}

if (themeSwitcher) {
  themeSwitcher.addEventListener("change", (event) => {
    const isDark = event.target.checked;
    const theme = isDark ? "dark" : "light";
    applyTheme(theme);
    saveTheme(theme);
  });
}

// Load theme on startup
loadTheme().then((theme) => {
  applyTheme(theme);
});

