(() => {
  const accountsStorageKey = "mam.accounts.v1";
  const sessionStorageKey = "mam.session.v1";
  const iterations = 120000;
  const encoder = new TextEncoder();

  function getAccounts() {
    try {
      const accounts = JSON.parse(localStorage.getItem(accountsStorageKey) || "[]");
      return Array.isArray(accounts) ? accounts : [];
    } catch {
      return [];
    }
  }

  function encodeBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }

  function decodeBase64(value) {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  }

  async function hashPassword(password, salt) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const hash = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );
    return encodeBase64(new Uint8Array(hash));
  }

  async function createAccount({ username, email, password }) {
    if (password.length > 18) {
      return { error: new Error("Password must be 18 characters or fewer.") };
    }

    const cleanUsername = username.trim();
    if (cleanUsername.length > 25) {
      return { error: new Error("Username must be 25 characters or fewer.") };
    }

    const cleanEmail = email.trim();
    const normalizedEmail = cleanEmail.toLowerCase();
    const normalizedUsername = cleanUsername.toLowerCase();
    const accounts = getAccounts();

    if (accounts.some((account) => account.normalizedEmail === normalizedEmail)) {
      return { error: new Error("That email already has an account.") };
    }

    if (accounts.some((account) => account.normalizedUsername === normalizedUsername)) {
      return { error: new Error("That username is already taken.") };
    }

    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      accounts.push({
        username: cleanUsername,
        normalizedUsername,
        email: cleanEmail,
        normalizedEmail,
        salt: encodeBase64(salt),
        passwordHash: await hashPassword(password, salt)
      });
      localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
      return { data: { account: { username: cleanUsername, email: cleanEmail } }, error: null };
    } catch {
      return { error: new Error("Unable to save this account in the browser.") };
    }
  }

  async function authenticate(identifier, password) {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    const accounts = getAccounts();
    const account = accounts.find((savedAccount) => savedAccount.normalizedEmail === normalizedIdentifier)
      || accounts.find((savedAccount) => savedAccount.normalizedUsername === normalizedIdentifier);

    if (!account) {
      return { error: new Error("Email or password is incorrect.") };
    }

    try {
      const passwordHash = await hashPassword(password, decodeBase64(account.salt));
      if (passwordHash !== account.passwordHash) {
        return { error: new Error("Email or password is incorrect.") };
      }

      account.loginCount = (account.loginCount || 0) + 1;
      account.lastLoginAt = new Date().toISOString();
      localStorage.setItem(accountsStorageKey, JSON.stringify(
        getAccounts().map((savedAccount) => savedAccount.normalizedEmail === account.normalizedEmail ? account : savedAccount)
      ));
      localStorage.setItem(sessionStorageKey, account.normalizedEmail);
      return {
        data: {
          user: {
            email: account.email,
            username: account.username,
            loginCount: account.loginCount,
            lastLoginAt: account.lastLoginAt
          }
        },
        error: null
      };
    } catch {
      return { error: new Error("Unable to verify this account in the browser.") };
    }
  }

  async function getUser() {
    const normalizedEmail = localStorage.getItem(sessionStorageKey);
    const account = getAccounts().find((savedAccount) => savedAccount.normalizedEmail === normalizedEmail);

    return {
      data: {
        user: account
          ? {
              email: account.email,
              username: account.username,
              profilePicture: account.profilePicture || "",
              favoriteGenres: account.favoriteGenres || (account.favoriteGenre ? [account.favoriteGenre] : []),
              animeList: account.animeList || [],
              animeBookmarks: account.animeBookmarks || [],
              favoriteAnime: account.favoriteAnime || [],
              mangaList: account.mangaList || [],
              mangaBookmarks: account.mangaBookmarks || [],
              favoriteManga: account.favoriteManga || [],
              loginCount: account.loginCount || 0,
              lastLoginAt: account.lastLoginAt || null
            }
          : null
      },
      error: null
    };
  }

  async function updateProfile({ username, profilePicture }) {
    const normalizedEmail = localStorage.getItem(sessionStorageKey);
    const accounts = getAccounts();
    const account = accounts.find((savedAccount) => savedAccount.normalizedEmail === normalizedEmail);

    if (!account) {
      return { error: new Error("Your session has expired. Please log in again.") };
    }

    const cleanUsername = String(username || "").trim();
    const normalizedUsername = cleanUsername.toLowerCase();
    if (!cleanUsername || cleanUsername.length > 25) {
      return { error: new Error("Username must be between 1 and 25 characters.") };
    }
    if (accounts.some((savedAccount) => savedAccount !== account && savedAccount.normalizedUsername === normalizedUsername)) {
      return { error: new Error("That username is already taken.") };
    }
    if (profilePicture && (!profilePicture.startsWith("data:image/") || profilePicture.length > 1400000)) {
      return { error: new Error("The resized profile image is too large. Try another photo.") };
    }

    account.username = cleanUsername;
    account.normalizedUsername = normalizedUsername;
    account.profilePicture = profilePicture || "";
    try {
      localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
    } catch {
      return { error: new Error("Unable to save profile changes in this browser.") };
    }
    return { data: { account: { username: account.username, email: account.email, profilePicture: account.profilePicture } }, error: null };
  }

  async function updateCredentials({ currentPassword, newEmail, newPassword, confirmPassword }) {
    const normalizedEmail = localStorage.getItem(sessionStorageKey);
    const accounts = getAccounts();
    const account = accounts.find((savedAccount) => savedAccount.normalizedEmail === normalizedEmail);

    if (!account) {
      return { error: new Error("Your session has expired. Please log in again.") };
    }

    try {
      const currentHash = await hashPassword(currentPassword, decodeBase64(account.salt));
      if (currentHash !== account.passwordHash) {
        return { error: new Error("Current password is incorrect.") };
      }

      const cleanEmail = String(newEmail || "").trim();
      const normalizedNewEmail = cleanEmail.toLowerCase();
      const changeEmail = Boolean(cleanEmail && normalizedNewEmail !== account.normalizedEmail);
      if (changeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return { error: new Error("Enter a valid email address.") };
      }
      if (changeEmail && accounts.some((savedAccount) => savedAccount !== account && savedAccount.normalizedEmail === normalizedNewEmail)) {
        return { error: new Error("That email already has an account.") };
      }

      const changePassword = Boolean(newPassword || confirmPassword);
      if (!changeEmail && !changePassword) {
        return { error: new Error("Enter a new email or password to update.") };
      }
      if (changePassword && (newPassword.length < 8 || newPassword.length > 18)) {
        return { error: new Error("New password must be 8 to 18 characters.") };
      }
      if (changePassword && newPassword !== confirmPassword) {
        return { error: new Error("New passwords do not match.") };
      }

      if (changePassword) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        account.salt = encodeBase64(salt);
        account.passwordHash = await hashPassword(newPassword, salt);
      }
      if (changeEmail) {
        account.email = cleanEmail;
        account.normalizedEmail = normalizedNewEmail;
      }

      localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
      if (changeEmail) {
        localStorage.setItem(sessionStorageKey, normalizedNewEmail);
      }
      return { data: { account: { username: account.username, email: account.email } }, error: null };
    } catch {
      return { error: new Error("Unable to update account settings in this browser.") };
    }
  }

  function logout() {
    localStorage.removeItem(sessionStorageKey);
  }

  function saveFavoriteGenres(genres) {
    const normalizedEmail = localStorage.getItem(sessionStorageKey);
    const accounts = getAccounts();
    const account = accounts.find((savedAccount) => savedAccount.normalizedEmail === normalizedEmail);

    if (!account) {
      return false;
    }

    account.favoriteGenres = [...new Set(genres)];
    delete account.favoriteGenre;
    localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
    return true;
  }

  function saveAnimeRecord(collectionName, anime) {
    const normalizedEmail = localStorage.getItem(sessionStorageKey);
    const accounts = getAccounts();
    const account = accounts.find((savedAccount) => savedAccount.normalizedEmail === normalizedEmail);

    if (!account || !anime?.id) {
      return false;
    }

    const records = account[collectionName] || [];
    const existingIndex = records.findIndex((record) => String(record.id) === String(anime.id));
    if (existingIndex === -1) {
      records.push(anime);
    } else {
      records[existingIndex] = { ...records[existingIndex], ...anime };
    }
    account[collectionName] = records;
    localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
    return true;
  }

  function saveAnimeToWatchLater(anime) {
    return saveAnimeRecord("animeList", anime);
  }

  function saveAnimeBookmark(anime) {
    return saveAnimeRecord("animeBookmarks", anime);
  }

  function toggleAnimeFavorite(anime) {
    const normalizedEmail = localStorage.getItem(sessionStorageKey);
    const accounts = getAccounts();
    const account = accounts.find((savedAccount) => savedAccount.normalizedEmail === normalizedEmail);

    if (!account || !anime?.id) {
      return null;
    }

    const favorites = account.favoriteAnime || [];
    const existingIndex = favorites.findIndex((record) => String(record.id) === String(anime.id));
    const isFavorite = existingIndex === -1;
    if (isFavorite) {
      favorites.push(anime);
    } else {
      favorites.splice(existingIndex, 1);
    }
    account.favoriteAnime = favorites;

    try {
      localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
      return isFavorite;
    } catch {
      return null;
    }
  }

  function saveMangaToWatchLater(manga) {
    return saveAnimeRecord("mangaList", manga);
  }

  function saveMangaBookmark(manga) {
    return saveAnimeRecord("mangaBookmarks", manga);
  }

  function toggleMangaFavorite(manga) {
    const normalizedEmail = localStorage.getItem(sessionStorageKey);
    const accounts = getAccounts();
    const account = accounts.find((savedAccount) => savedAccount.normalizedEmail === normalizedEmail);

    if (!account || !manga?.id) {
      return null;
    }

    const favorites = account.favoriteManga || [];
    const existingIndex = favorites.findIndex((record) => String(record.id) === String(manga.id));
    const isFavorite = existingIndex === -1;
    if (isFavorite) {
      favorites.push(manga);
    } else {
      favorites.splice(existingIndex, 1);
    }
    account.favoriteManga = favorites;

    try {
      localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
      return isFavorite;
    } catch {
      return null;
    }
  }

  function initializeProfileControls() {
    const triggers = [...document.querySelectorAll(".profile-link")];
    if (!triggers.length) {
      return;
    }

    const menu = document.createElement("div");
    menu.className = "profile-menu";
    menu.id = "profile-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    menu.innerHTML = `
      <button type="button" role="menuitemradio" data-theme-choice="light">Light mode</button>
      <button type="button" role="menuitemradio" data-theme-choice="dark">Dark mode</button>
      <div class="profile-menu-divider" role="separator"></div>
      <button type="button" role="menuitem" data-open-dialog="profile">Profile</button>
      <button type="button" role="menuitem" data-open-dialog="credentials">Password &amp; email</button>
    `;

    const profileDialog = document.createElement("dialog");
    profileDialog.className = "account-dialog";
    profileDialog.id = "profile-settings-dialog";
    profileDialog.setAttribute("aria-labelledby", "profile-settings-heading");
    profileDialog.innerHTML = `
      <form class="account-form" id="profile-settings-form">
        <h2 id="profile-settings-heading">Profile</h2>
        <div class="profile-picture-preview" id="profile-picture-preview" aria-label="Profile picture preview">
          <span aria-hidden="true">No photo</span>
        </div>
        <label for="profile-picture-input">Profile picture</label>
        <input id="profile-picture-input" type="file" accept="image/*">
        <p class="account-form-note">Image files up to 5 MB are resized for profile use.</p>
        <button class="account-secondary-button" id="remove-profile-picture" type="button">Remove photo</button>
        <label for="profile-username">Username</label>
        <input id="profile-username" type="text" maxlength="25" autocomplete="nickname" required>
        <label for="profile-username-confirm">Confirm username</label>
        <input id="profile-username-confirm" type="text" maxlength="25" autocomplete="off" required>
        <p class="account-form-status" id="profile-settings-status" role="status" aria-live="polite"></p>
        <div class="account-form-actions">
          <button class="account-secondary-button" type="button" data-close-dialog>Cancel</button>
          <button type="submit">Save profile</button>
        </div>
      </form>
    `;

    const cropDialog = document.createElement("dialog");
    cropDialog.className = "account-dialog";
    cropDialog.id = "profile-crop-dialog";
    cropDialog.setAttribute("aria-labelledby", "profile-crop-heading");
    cropDialog.innerHTML = `
      <form class="account-form" id="profile-crop-form">
        <h2 id="profile-crop-heading">Crop profile picture</h2>
        <canvas class="profile-crop-canvas" id="profile-crop-canvas" width="512" height="512" aria-label="Crop preview. Drag the image to reposition it."></canvas>
        <label for="profile-crop-zoom">Zoom</label>
        <input id="profile-crop-zoom" type="range" min="1" max="3" step="0.01" value="1">
        <p class="account-form-status" id="profile-crop-status" role="status" aria-live="polite"></p>
        <div class="account-form-actions">
          <button class="account-secondary-button" type="button" data-close-dialog>Cancel</button>
          <button type="submit">Use cropped photo</button>
        </div>
      </form>
    `;

    const credentialsDialog = document.createElement("dialog");
    credentialsDialog.className = "account-dialog";
    credentialsDialog.id = "credentials-settings-dialog";
    credentialsDialog.setAttribute("aria-labelledby", "credentials-settings-heading");
    credentialsDialog.innerHTML = `
      <form class="account-form" id="credentials-settings-form">
        <h2 id="credentials-settings-heading">Password &amp; email</h2>
        <p class="account-current-email" id="current-account-email"></p>
        <label for="current-password">Confirm current password</label>
        <div class="account-password-row">
          <input id="current-password" type="password" autocomplete="current-password" required>
          <button class="account-password-toggle" type="button" aria-label="Show current password" aria-pressed="false" aria-controls="current-password" data-password-label="current password">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle><path class="eye-slash" d="M4 4 20 20"></path></svg>
          </button>
        </div>
        <label for="account-new-email">New email</label>
        <input id="account-new-email" type="email" autocomplete="email" placeholder="Leave blank to keep current email">
        <label for="account-new-password">New password</label>
        <div class="account-password-row">
          <input id="account-new-password" type="password" minlength="8" maxlength="18" autocomplete="new-password">
          <button class="account-password-toggle" type="button" aria-label="Show new password" aria-pressed="false" aria-controls="account-new-password" data-password-label="new password">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle><path class="eye-slash" d="M4 4 20 20"></path></svg>
          </button>
        </div>
        <label for="account-confirm-new-password">Confirm new password</label>
        <div class="account-password-row">
          <input id="account-confirm-new-password" type="password" minlength="8" maxlength="18" autocomplete="new-password">
          <button class="account-password-toggle" type="button" aria-label="Show confirm new password" aria-pressed="false" aria-controls="account-confirm-new-password" data-password-label="confirm new password">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle><path class="eye-slash" d="M4 4 20 20"></path></svg>
          </button>
        </div>
        <p class="account-form-status" id="credentials-settings-status" role="status" aria-live="polite"></p>
        <div class="account-form-actions">
          <button class="account-secondary-button" type="button" data-close-dialog>Cancel</button>
          <button type="submit">Save changes</button>
        </div>
      </form>
    `;

    const accountActions = triggers[0].closest(".account-actions, .signup-account-actions");
    accountActions.append(menu);
    document.body.append(profileDialog, cropDialog, credentialsDialog);

    function closeMenu() {
      menu.hidden = true;
      triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    }

    function applyTheme(theme) {
      const selectedTheme = theme === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = selectedTheme;
      localStorage.setItem("mam.theme.v1", selectedTheme);
      menu.querySelectorAll("[data-theme-choice]").forEach((button) => {
        const selected = button.dataset.themeChoice === selectedTheme;
        button.setAttribute("aria-checked", String(selected));
        button.classList.toggle("is-selected", selected);
      });
    }

    function updateProfileIcon(profilePicture) {
      triggers.forEach((trigger) => {
        const existingImage = trigger.querySelector(".profile-avatar-image");
        if (!profilePicture) {
          existingImage?.remove();
          const icon = trigger.querySelector("svg");
          if (icon) {
            icon.hidden = false;
            icon.style.removeProperty("display");
          }
          return;
        }

        const image = existingImage || document.createElement("img");
        image.className = "profile-avatar-image";
        image.alt = "";
        image.src = profilePicture;
        if (!existingImage) trigger.append(image);
        const icon = trigger.querySelector("svg");
        if (icon) {
          icon.hidden = true;
          icon.style.setProperty("display", "none", "important");
        }
      });
    }

    function showDialog(dialog) {
      closeMenu();
      dialog.showModal();
    }

    const theme = localStorage.getItem("mam.theme.v1") || "dark";
    applyTheme(theme);
    window.MamAuth.getUser().then(({ data }) => {
      updateProfileIcon(data.user?.profilePicture || "");
      menu.querySelectorAll("[data-open-dialog]").forEach((button) => {
        button.disabled = !data.user;
      });
    });

    triggers.forEach((trigger) => {
      trigger.setAttribute("role", "button");
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-controls", menu.id);
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        const shouldOpen = menu.hidden;
        menu.hidden = !shouldOpen;
        triggers.forEach((item) => item.setAttribute("aria-expanded", String(shouldOpen)));
      });
    });

    menu.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.themeChoice) {
        applyTheme(button.dataset.themeChoice);
        closeMenu();
        return;
      }

      if (button.dataset.openDialog === "profile") {
        const { data } = await window.MamAuth.getUser();
        const user = data.user;
        if (!user) return;
        document.querySelector("#profile-username").value = user.username || "";
        document.querySelector("#profile-username-confirm").value = user.username || "";
        profilePictureData = user.profilePicture || "";
        renderProfilePicturePreview(profilePictureData);
        document.querySelector("#profile-settings-status").textContent = "";
        showDialog(profileDialog);
      } else if (button.dataset.openDialog === "credentials") {
        document.querySelector("#credentials-settings-form").reset();
        document.querySelector("#credentials-settings-status").textContent = "";
        document.querySelector("#current-account-email").textContent = `Current email: ${(await window.MamAuth.getUser()).data.user?.email || ""}`;
        showDialog(credentialsDialog);
      }
    });

    let profilePictureData = "";
    const pictureInput = document.querySelector("#profile-picture-input");
    const picturePreview = document.querySelector("#profile-picture-preview");
    const profileStatus = document.querySelector("#profile-settings-status");
    const cropCanvas = document.querySelector("#profile-crop-canvas");
    const cropContext = cropCanvas.getContext("2d");
    const cropZoomInput = document.querySelector("#profile-crop-zoom");
    const cropStatus = document.querySelector("#profile-crop-status");
    let cropBitmap = null;
    let cropZoom = 1;
    let cropOffsetX = 0;
    let cropOffsetY = 0;
    let cropDrag = null;

    function renderProfilePicturePreview(source) {
      picturePreview.replaceChildren();
      if (source) {
        const image = document.createElement("img");
        image.src = source;
        image.alt = "Selected profile picture";
        picturePreview.append(image);
      } else {
        const emptyState = document.createElement("span");
        emptyState.textContent = "No photo";
        picturePreview.append(emptyState);
      }
    }

    function getCropMetrics() {
      const fitScale = Math.max(cropCanvas.width / cropBitmap.width, cropCanvas.height / cropBitmap.height);
      const width = cropBitmap.width * fitScale * cropZoom;
      const height = cropBitmap.height * fitScale * cropZoom;
      return {
        width,
        height,
        maxOffsetX: Math.max(0, (width - cropCanvas.width) / 2),
        maxOffsetY: Math.max(0, (height - cropCanvas.height) / 2)
      };
    }

    function drawCropPreview() {
      if (!cropBitmap) return;
      const metrics = getCropMetrics();
      cropOffsetX = Math.max(-metrics.maxOffsetX, Math.min(metrics.maxOffsetX, cropOffsetX));
      cropOffsetY = Math.max(-metrics.maxOffsetY, Math.min(metrics.maxOffsetY, cropOffsetY));
      cropContext.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
      cropContext.drawImage(
        cropBitmap,
        (cropCanvas.width - metrics.width) / 2 + cropOffsetX,
        (cropCanvas.height - metrics.height) / 2 + cropOffsetY,
        metrics.width,
        metrics.height
      );
    }

    async function getCroppedProfilePicture() {
      const blob = await new Promise((resolve) => cropCanvas.toBlob(resolve, "image/webp", 0.82));
      if (!blob) throw new Error("This image could not be processed.");
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(String(reader.result || "")));
        reader.addEventListener("error", () => reject(new Error("This image could not be read.")));
        reader.readAsDataURL(blob);
      });
    }

    async function saveProfilePicture(picture) {
      profileStatus.textContent = "Saving profile picture...";
      const { data } = await window.MamAuth.getUser();
      if (!data.user) {
        profileStatus.textContent = "Your session has expired. Please log in again.";
        return;
      }

      const result = await window.MamAuth.updateProfile({ username: data.user.username, profilePicture: picture });
      if (result.error) {
        profileStatus.textContent = result.error.message;
        return;
      }

      profilePictureData = result.data.account.profilePicture;
      updateProfileIcon(profilePictureData);
      profileStatus.textContent = "Profile picture updated.";
    }

    pictureInput.addEventListener("change", async () => {
      const file = pictureInput.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        profileStatus.textContent = "Choose an image file.";
        pictureInput.value = "";
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        profileStatus.textContent = "Choose an image smaller than 5 MB.";
        pictureInput.value = "";
        return;
      }

      try {
        cropBitmap?.close();
        cropBitmap = await createImageBitmap(file);
        cropZoom = 1;
        cropOffsetX = 0;
        cropOffsetY = 0;
        cropZoomInput.value = "1";
        cropStatus.textContent = "";
        drawCropPreview();
        cropDialog.showModal();
      } catch (error) {
        profileStatus.textContent = error.message || "This image could not be opened.";
        pictureInput.value = "";
      }
    });

    cropZoomInput.addEventListener("input", () => {
      cropZoom = Number(cropZoomInput.value);
      drawCropPreview();
    });

    cropCanvas.addEventListener("pointerdown", (event) => {
      if (!cropBitmap) return;
      cropDrag = { pointerX: event.clientX, pointerY: event.clientY, offsetX: cropOffsetX, offsetY: cropOffsetY };
      cropCanvas.setPointerCapture(event.pointerId);
    });

    cropCanvas.addEventListener("pointermove", (event) => {
      if (!cropDrag) return;
      const bounds = cropCanvas.getBoundingClientRect();
      cropOffsetX = cropDrag.offsetX + (event.clientX - cropDrag.pointerX) * cropCanvas.width / bounds.width;
      cropOffsetY = cropDrag.offsetY + (event.clientY - cropDrag.pointerY) * cropCanvas.height / bounds.height;
      drawCropPreview();
    });

    cropCanvas.addEventListener("pointerup", () => {
      cropDrag = null;
    });
    cropCanvas.addEventListener("pointercancel", () => {
      cropDrag = null;
    });

    cropDialog.addEventListener("close", () => {
      cropBitmap?.close();
      cropBitmap = null;
      cropDrag = null;
      pictureInput.value = "";
    });

    cropDialog.querySelector("[data-close-dialog]").addEventListener("click", () => cropDialog.close());
    document.querySelector("#profile-crop-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const applyButton = event.currentTarget.querySelector('[type="submit"]');
      applyButton.disabled = true;
      cropStatus.textContent = "Processing cropped photo...";
      try {
        profilePictureData = await getCroppedProfilePicture();
        renderProfilePicturePreview(profilePictureData);
        cropDialog.close();
        await saveProfilePicture(profilePictureData);
      } catch (error) {
        cropStatus.textContent = error.message || "This image could not be processed.";
      } finally {
        applyButton.disabled = false;
      }
    });

    document.querySelector("#remove-profile-picture").addEventListener("click", () => {
      profilePictureData = "";
      pictureInput.value = "";
      renderProfilePicturePreview("");
      void saveProfilePicture("");
    });

    profileDialog.querySelector("[data-close-dialog]").addEventListener("click", () => profileDialog.close());
    credentialsDialog.querySelector("[data-close-dialog]").addEventListener("click", () => credentialsDialog.close());
    credentialsDialog.querySelectorAll(".account-password-toggle").forEach((toggle) => {
      const passwordInput = document.getElementById(toggle.getAttribute("aria-controls"));
      toggle.addEventListener("click", () => {
        const showingPassword = passwordInput.type === "password";
        passwordInput.type = showingPassword ? "text" : "password";
        toggle.setAttribute("aria-pressed", String(showingPassword));
        toggle.setAttribute("aria-label", `${showingPassword ? "Hide" : "Show"} ${toggle.dataset.passwordLabel}`);
      });
    });

    document.querySelector("#profile-settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector("#profile-settings-status");
      const username = document.querySelector("#profile-username").value;
      const confirmedUsername = document.querySelector("#profile-username-confirm").value;
      if (username.trim() !== confirmedUsername.trim()) {
        status.textContent = "Usernames do not match.";
        return;
      }

      const result = await window.MamAuth.updateProfile({ username, profilePicture: profilePictureData });
      if (result.error) {
        status.textContent = result.error.message;
        return;
      }
      updateProfileIcon(result.data.account.profilePicture);
      status.textContent = "Profile updated.";
      window.setTimeout(() => profileDialog.close(), 500);
    });

    document.querySelector("#credentials-settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector("#credentials-settings-status");
      const result = await window.MamAuth.updateCredentials({
        currentPassword: document.querySelector("#current-password").value,
        newEmail: document.querySelector("#account-new-email").value,
        newPassword: document.querySelector("#account-new-password").value,
        confirmPassword: document.querySelector("#account-confirm-new-password").value
      });
      if (result.error) {
        status.textContent = result.error.message;
        return;
      }
      status.textContent = "Account settings updated.";
      window.setTimeout(() => credentialsDialog.close(), 500);
    });

    document.addEventListener("click", (event) => {
      if (!menu.hidden && !accountActions.contains(event.target)) {
        closeMenu();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  window.MamAuth = { authenticate, createAccount, getUser, updateProfile, updateCredentials, logout, saveFavoriteGenres, saveAnimeToWatchLater, saveAnimeBookmark, toggleAnimeFavorite, saveMangaToWatchLater, saveMangaBookmark, toggleMangaFavorite };

  document.querySelectorAll(".logout-button").forEach((button) => {
    button.addEventListener("click", () => {
      logout();
      window.location.replace("index.html");
    });
  });
  initializeProfileControls();
})();