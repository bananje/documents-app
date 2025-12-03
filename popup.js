class AuthRequiredError extends Error {
  constructor(message = "Google authorization is required") {
    super(message);
    this.name = "AuthRequiredError";
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

const viewContent = {
  account: {
    title: "Account",
    body: "Sign in to view your Google Drive profile summary.",
  },
};

const CREATE_SHORTCUTS = [
  {
    key: "docs",
    label: "Документ",
    description: "Пустой Google Doc",
    url: "https://docs.google.com/document/create",
    iconUrl: "https://img.icons8.com/color/48/google-docs--v1.png",
  },
  {
    key: "sheets",
    label: "Таблица",
    description: "Пустой Google Sheet",
    url: "https://docs.google.com/spreadsheets/create",
    iconUrl: "https://img.icons8.com/color/48/google-sheets.png",
  },
  {
    key: "slides",
    label: "Презентация",
    description: "Пустой Google Slides",
    url: "https://docs.google.com/presentation/create",
    iconUrl: "https://img.icons8.com/color/48/google-slides.png",
  },
  {
    key: "forms",
    label: "Форма",
    description: "Пустая Google Form",
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
const driveCache = new Map();
let currentGridRequest = 0;
const SEARCHABLE_VIEWS = new Set(["drive", "recent"]);
const viewSearchState = {
  drive: "",
  recent: "",
};

const viewTypeFilter = {
  drive: null, // null = all types, "docs" | "sheets" | "slides" | "forms"
  recent: null,
};

const TYPE_FILTER_ICONS = {
  docs: "https://img.icons8.com/color/48/google-docs--v1.png",
  sheets: "https://img.icons8.com/color/48/google-sheets.png",
  slides: "https://img.icons8.com/color/48/google-slides.png",
  forms: "https://img.icons8.com/fluency/48/google-forms.png",
};
let activeView = "drive";
const PIN_STORAGE_KEY = "driveDeskPinnedIds";
let pinnedFileIds = [];
// Счетчик для позиционирования до 4 окон (2x2), без сложного трекинга
let transientWindowIndex = 0;

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
    if (chrome?.runtime?.sendMessage) {
      // Используем background script для более надежного открытия окон
      const screenWidth = window.screen?.availWidth || window.innerWidth || 1920;
      const screenHeight = window.screen?.availHeight || window.innerHeight || 1080;

      const halfWidth = Math.floor(screenWidth / 2);
      const halfHeight = Math.floor(screenHeight / 2);

      const index = transientWindowIndex % 4;
      transientWindowIndex += 1;

      const positions = [
        { left: 0, top: 0 }, // верхний левый
        { left: 0, top: halfHeight }, // нижний левый
        { left: halfWidth, top: halfHeight }, // нижний правый
        { left: halfWidth, top: 0 }, // верхний правый
      ];

      const pos = positions[index];

      chrome.runtime.sendMessage(
        {
          action: "openDriveWindow",
          url: url,
          left: pos.left,
          top: pos.top,
          width: halfWidth,
          height: halfHeight,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("Failed to send message to background:", chrome.runtime.lastError.message);
            // Fallback: открываем напрямую
            if (chrome?.windows?.create) {
              chrome.windows.create({
                url,
                type: "popup", // popup создает окно без адресной строки и некоторых элементов интерфейса
                left: pos.left,
                top: pos.top,
                width: halfWidth,
                height: halfHeight,
                focused: true,
              });
            }
          }
        },
      );
    } else if (chrome?.windows?.create) {
      // Fallback: открываем напрямую из popup
      const screenWidth = window.screen?.availWidth || window.innerWidth || 1920;
      const screenHeight = window.screen?.availHeight || window.innerHeight || 1080;

      const halfWidth = Math.floor(screenWidth / 2);
      const halfHeight = Math.floor(screenHeight / 2);

      const index = transientWindowIndex % 4;
      transientWindowIndex += 1;

      const positions = [
        { left: 0, top: 0 },
        { left: 0, top: halfHeight },
        { left: halfWidth, top: halfHeight },
        { left: halfWidth, top: 0 },
      ];

      const pos = positions[index];

      chrome.windows.create({
        url,
        type: "popup", // popup создает окно без адресной строки и некоторых элементов интерфейса
        left: pos.left,
        top: pos.top,
        width: halfWidth,
        height: halfHeight,
        focused: true,
      });
    } else {
      window.open(url, "_blank", "noopener");
    }
  } catch (error) {
    console.error("Failed to open document in side window:", error);
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank", "noopener");
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

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "doc-card__action doc-card__action--delete";
  deleteButton.innerHTML = ACTION_ICONS.delete;
  deleteButton.title = "Удалить документ";
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showDeleteConfirm(card, file);
  });

  if (view === "drive") {
    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.className = "doc-card__action doc-card__action--pin";
    pinButton.innerHTML = ACTION_ICONS.pin;
    pinButton.title = "Закрепить документ";
    if (isFilePinned(file.id)) {
      pinButton.classList.add("active");
      pinButton.title = "Открепить документ";
    }
    pinButton.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePinnedState(file.id);
    });
    actions.append(pinButton, deleteButton);
  } else {
    actions.append(deleteButton);
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

  // Добавляем индикатор закреплённого состояния в правом верхнем углу
  if (view === "drive" && isFilePinned(file.id)) {
    const pinIndicator = document.createElement("div");
    pinIndicator.className = "doc-card__pin-indicator";
    pinIndicator.innerHTML = ACTION_ICONS.pin;
    pinIndicator.title = "Документ закреплён";
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

function renderGrid(view, files, query = "") {
  contentEl.innerHTML = "";

  const header = document.createElement("div");
  header.className = "content__header";

  if (SEARCHABLE_VIEWS.has(view)) {
    // Type filter selector with dropdown
    const typeFilterWrapper = document.createElement("div");
    typeFilterWrapper.className = "content__type-filter-wrapper";
    
    const typeFilter = document.createElement("div");
    typeFilter.className = "content__type-filter";
    
    // Base button (shows current selection)
    const baseButton = document.createElement("button");
    baseButton.type = "button";
    baseButton.className = "content__type-filter-base";
    baseButton.setAttribute("aria-expanded", "false");
    
    const currentType = viewTypeFilter[view];
    if (currentType && TYPE_FILTER_ICONS[currentType]) {
      baseButton.innerHTML = `<img src="${TYPE_FILTER_ICONS[currentType]}" alt="${currentType}" width="20" height="20" />`;
      baseButton.title = currentType === "docs" ? "Документы" : currentType === "sheets" ? "Таблицы" : currentType === "slides" ? "Презентации" : "Формы";
    } else {
      baseButton.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 9h6M9 15h6M9 12h6"/></svg>`;
      baseButton.title = "Все типы";
    }
    
    // Dropdown menu
    const dropdown = document.createElement("div");
    dropdown.className = "content__type-filter-dropdown";
    
    // Add "all" option
    const allOption = document.createElement("button");
    allOption.type = "button";
    allOption.className = "content__type-filter-option";
    allOption.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 9h6M9 15h6M9 12h6"/></svg>`;
    allOption.title = "Все типы";
    allOption.addEventListener("click", (e) => {
      e.stopPropagation();
      viewTypeFilter[view] = null;
      renderGrid(view, files, query);
    });
    dropdown.appendChild(allOption);

    // Add type options
    Object.entries(TYPE_FILTER_ICONS).forEach(([type, iconUrl]) => {
      const typeOption = document.createElement("button");
      typeOption.type = "button";
      typeOption.className = "content__type-filter-option";
      typeOption.innerHTML = `<img src="${iconUrl}" alt="${type}" width="20" height="20" />`;
      typeOption.title = type === "docs" ? "Документы" : type === "sheets" ? "Таблицы" : type === "slides" ? "Презентации" : "Формы";
      typeOption.addEventListener("click", (e) => {
        e.stopPropagation();
        viewTypeFilter[view] = type;
        renderGrid(view, files, query);
      });
      dropdown.appendChild(typeOption);
    });
    
    // Dropdown visibility is handled by CSS :hover
    // Just ensure it's not hidden by default for CSS transitions
    dropdown.hidden = false;
    
    typeFilter.appendChild(baseButton);
    typeFilter.appendChild(dropdown);
    typeFilterWrapper.appendChild(typeFilter);
    header.appendChild(typeFilterWrapper);

    // Search input
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.className = "content__search-input";
    input.value = query;
    input.dataset.view = view;
    input.addEventListener("input", handleSearchInput);
    header.appendChild(input);
  } else {
    const heading = document.createElement("h2");
    heading.className = "content__title";
    heading.textContent = DRIVE_VIEW_LABELS[view] || "Files";
    header.appendChild(heading);
  }

  contentEl.appendChild(header);

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
    <h2>Создать новый файл</h2>
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

function renderLoading(view) {
  contentEl.innerHTML = `
    <div class="content__loader">
      <span>Loading ${escapeHtml(DRIVE_VIEW_LABELS[view] || "files")}…</span>
    </div>
  `;
}

function resolveAccountView() {
  if (signedInUser) {
    return {
      title: "Account",
      body: `Signed in as ${signedInUser.email || "Google user"}.\nManage Drive shortcuts and preferences from this hub.`,
    };
  }
  return viewContent.account;
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

  const state = view === "account" ? resolveAccountView() : viewContent[view];
  if (!state) {
    contentEl.innerHTML = `<p class="content__placeholder">Nothing to show yet.</p>`;
    return;
  }

  contentEl.innerHTML = `
    <h2>${state.title}</h2>
    <p>${state.body}</p>
  `;
}

function setActive(button) {
  buttons.forEach((btn) => {
    const isActive = btn === button;
    const view = btn.dataset.view;
    btn.classList.toggle("active", isActive && view !== "create");
    btn.setAttribute("aria-pressed", String(isActive));
  });
}

function handleSearchInput(event) {
  const input = event.currentTarget;
  const view = input.dataset.view;
  if (!SEARCHABLE_VIEWS.has(view)) return;
  const query = input.value;
  viewSearchState[view] = query;
  const caretPos = input.selectionStart ?? query.length;
  const files = driveCache.get(view) || [];
  renderGrid(view, files, query);
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
  const files = driveCache.get(activeView);
  if (files) {
    renderGrid(activeView, files, viewSearchState[activeView] || "");
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
    <p>Удалить «${escapeHtml(file.name)}»?</p>
    <div class="doc-card__confirm-actions">
      <button type="button" data-cancel>Отмена</button>
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
          renderStatus(
            "Нужны права для удаления документа.",
            "Разрешить доступ",
            () => loadDriveContent(activeView, { interactive: true, force: true }),
          );
        } else {
          console.error("Delete error:", error);
          renderStatus("Не удалось удалить документ. Повторите попытку позже.", "Назад к файлам", () =>
            updateContent(activeView),
          );
        }
      });
  });

  card.appendChild(dialog);
}

async function deleteDriveFile(fileId, options = {}) {
  const token = await getAuthToken(options.interactive ?? false);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    invalidateToken(token);
    throw new AuthRequiredError("Сессия истекла, требуется повторная авторизация.");
  }

  if (response.status === 403) {
    throw new AuthRequiredError("Недостаточно прав для удаления файла.");
  }

  if (!response.ok && response.status !== 204) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || "Не удалось удалить файл.");
  }
}

function removeFileFromCaches(fileId) {
  driveCache.forEach((files, key) => {
    const filtered = files.filter((file) => file.id !== fileId);
    driveCache.set(key, filtered);
  });
}

function toggleAccountAvatar(photoUrl) {
    if (!accountButton) return;
  
    // Если photoUrl есть — показываем его
    if (photoUrl) {
      avatarImg.src = photoUrl;
      avatarImg.hidden = false;
      avatarFallback?.setAttribute("hidden", "hidden");
    } else {
      // fallback всегда показываем
      if (avatarImg) {
        avatarImg.hidden = true;
        avatarImg.removeAttribute("src");
      }
      avatarFallback?.removeAttribute("hidden");
  
      // Дополнительно можно поставить "default avatar" через Gravatar/initials
      // Например, вставим инициалы вместо картинки
      if (signedInUser?.email) {
        const initials = signedInUser.email
          .split("@")[0]
          .split(/[.\-_]/)
          .map(part => part[0]?.toUpperCase() || "")
          .join("");
        avatarFallback.textContent = initials || "U"; // U = Unknown
      } else {
        avatarFallback.textContent = "U"; // неизвестный пользователь
      }
    }
  }

// Обработчик ошибки загрузки аватарки
avatarImg?.addEventListener("error", () => {
    toggleAccountAvatar(null);
  });

function toggleAuthUI(isSignedIn) {
  if (!signInButton || !accountButton) return;
  if (isSignedIn) {
    signInButton.hidden = true;
    accountButton.hidden = false;
  } else {
    signInButton.hidden = false;
    accountButton.hidden = true;
  }
}

function initIdentity() {
  if (!chrome?.identity?.getProfileUserInfo) {
    toggleAuthUI(false);
    return;
  }

  chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (userInfo) => {
    if (chrome.runtime.lastError) {
      console.warn("Identity error:", chrome.runtime.lastError.message);
      toggleAuthUI(false);
      return;
    }

    const hasAccount = Boolean(userInfo?.email);
    signedInUser = hasAccount ? userInfo : null;
    toggleAuthUI(hasAccount);

    if (hasAccount) {
      const photoUrl = userInfo.id ? `https://profiles.google.com/s2/photos/profile/${userInfo.id}?sz=64` : null;
      toggleAccountAvatar(photoUrl);
    }
  });
}

function isAuthError(message = "", interactive) {
  if (!message) return !interactive;
  const normalized = message.toLowerCase();
  return AUTH_ERROR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    if (!chrome?.identity?.getAuthToken) {
      reject(new AuthRequiredError("Chrome identity is unavailable"));
      return;
    }
    if (cachedToken) {
      resolve(cachedToken);
      return;
    }
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const message = chrome.runtime.lastError?.message;
      if (message || !token) {
        if (isAuthError(message, interactive)) {
          reject(new AuthRequiredError(message || "Authorization required"));
        } else {
          reject(new Error(message || "Unable to obtain auth token"));
        }
        return;
      }
      cachedToken = token;
      resolve(token);
    });
  });
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
}

async function fetchDriveFiles(view, { interactive = false } = {}) {
  const token = await getAuthToken(interactive);
  const params = new URLSearchParams({
    q: DRIVE_QUERIES[view] || DRIVE_QUERIES.drive,
    fields: "files(id,name,mimeType,thumbnailLink,webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: "12",
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "false",
    corpora: "user",
  });

  if (view === "recent") {
    params.set("orderBy", "viewedByMeTime desc");
  }

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    invalidateToken(token);
    throw new AuthRequiredError("Session expired, please re-authorize.");
  }

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const message = errorPayload?.error?.message;
    const reason = errorPayload?.error?.errors?.[0]?.reason;
    if (response.status === 403 && reason === "insufficientPermissions") {
      invalidateToken(token);
      throw new AuthRequiredError("Для просмотра файлов нужно повторно подтвердить доступ.");
    }
    throw new Error(`Drive API error: ${message || response.statusText}`);
  }

  const data = await response.json();
  return data.files || [];
}

async function ensureDriveData(view, options = {}) {
  const { force = false, interactive = false } = options;
  if (!force && driveCache.has(view)) {
    return driveCache.get(view);
  }
  const files = await fetchDriveFiles(view, { interactive });
  driveCache.set(view, files);
  return files;
}

function loadDriveContent(view, options = {}) {
    const requestId = ++currentGridRequest;
    ensureDriveData(view, options)
      .then((files) => {
        if (requestId !== currentGridRequest) return;
        renderGrid(view, files, viewSearchState[view] || "");
      })
      .catch((error) => {
        if (requestId !== currentGridRequest) return;
        if (error instanceof AuthRequiredError) {
          renderStatus(
            "Мы не можем показать файлы без доступа к Google Drive.",
            "Разрешить доступ",
            () => loadDriveContent(view, { interactive: true, force: true }),
          );
          return;
        }
        console.error("Drive load error:", error);
        renderStatus("Не удалось загрузить документы. Повторите попытку позже.", "Повторить", () =>
          loadDriveContent(view, { force: true }),
        );
      });
  }
  
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const { view } = button.dataset;
      activeView = view;
  
      setActive(button);
      
      // Force refresh for Drive view
      if (view === "drive") {
        renderLoading(view);
        loadDriveContent(view, { force: true });
      } else {
        updateContent(view);
      }
    });
  });
  
  if (signInButton) {
    signInButton.addEventListener("click", () => {
      getAuthToken(true)
        .then(() => {
          initIdentity();
          renderStatus("Доступ предоставлен. Выберите раздел Drive, чтобы посмотреть файлы.");
        })
        .catch((error) => {
          const message = error instanceof AuthRequiredError ? "Авторизация отменена. Попробуйте ещё раз." : error.message;
          renderStatus(message);
        });
    });
  }
  
loadPinnedState().finally(() => {
  const defaultButton = buttons.find((btn) => btn.dataset.view === "drive");
  if (defaultButton) {
    setActive(defaultButton);
    updateContent("drive");
  }
});

initIdentity();
if (typeof loadDocumentWindows === 'function') {
  loadDocumentWindows();
}

