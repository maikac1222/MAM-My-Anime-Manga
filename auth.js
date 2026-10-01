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
    const cleanUsername = username.trim();
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

  window.MamAuth = { authenticate, createAccount, getUser, saveFavoriteGenres, saveAnimeToWatchLater, saveAnimeBookmark, toggleAnimeFavorite, saveMangaToWatchLater, saveMangaBookmark, toggleMangaFavorite };
})();