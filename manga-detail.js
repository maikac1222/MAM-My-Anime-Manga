const mangaStatus = document.querySelector("#manga-detail-status");
const mangaId = new URLSearchParams(window.location.search).get("id");
const mangaDialog = document.querySelector("#manga-bookmark-dialog");
let currentManga = null;
let currentUser = null;
let mangaSuggestionGeneration = 0;

async function fetchJikanManga(path) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://api.jikan.moe/v4${path}`, { signal: AbortSignal.timeout(7000) });
      if (response.ok) {
        return response.json();
      }
      if (response.status !== 429 && response.status < 500) {
        throw new Error("Manga request failed");
      }
      lastError = new Error("Manga request failed");
    } catch (error) {
      lastError = error;
    }
    if (attempt === 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error("Manga request failed");
}

function getMangaCover(manga) {
  return manga.images?.webp?.large_image_url
    || manga.images?.jpg?.large_image_url
    || manga.images?.webp?.image_url
    || manga.images?.jpg?.image_url
    || "";
}

function mangaCacheKey(id) {
  return `mam.manga-preview.v1:${id}`;
}

function readMangaPreview(id) {
  try {
    return JSON.parse(localStorage.getItem(mangaCacheKey(id)) || "null");
  } catch {
    return null;
  }
}

function cacheMangaPreview(manga) {
  if (!manga?.mal_id) {
    return;
  }
  try {
    localStorage.setItem(mangaCacheKey(manga.mal_id), JSON.stringify({
      mal_id: manga.mal_id,
      title: manga.title || manga.name || "Untitled manga",
      title_english: manga.title_english || null,
      synopsis: manga.synopsis || manga.description || "",
      chapters: manga.chapters || null,
      volumes: manga.volumes || null,
      year: manga.year || null,
      authors: manga.authors || [],
      images: manga.images || {}
    }));
  } catch {
    return;
  }
}

async function fetchAniListManga(malId) {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(7000),
    body: JSON.stringify({
      query: "query ($malId: Int) { Media(idMal: $malId, type: MANGA) { idMal title { english romaji native } coverImage { extraLarge large } description(asHtml: false) chapters volumes startDate { year } staff(sort: RELEVANCE, perPage: 12) { edges { role node { name { full } } } } } }",
      variables: { malId: Number(malId) }
    })
  });
  if (!response.ok) {
    throw new Error("AniList manga request failed");
  }
  const payload = await response.json();
  const manga = payload.data?.Media;
  if (!manga?.idMal) {
    return null;
  }
  const creator = (manga.staff?.edges || []).find((edge) => ["original creator", "story & art", "story", "art"].includes(edge.role?.toLowerCase()));
  const cover = manga.coverImage?.extraLarge || manga.coverImage?.large || "";
  return {
    mal_id: manga.idMal,
    title_english: manga.title?.english || "",
    title: manga.title?.romaji || manga.title?.native || "Untitled manga",
    synopsis: manga.description || "",
    chapters: manga.chapters || null,
    volumes: manga.volumes || null,
    year: manga.startDate?.year || null,
    authors: creator?.node?.name?.full ? [{ name: creator.node.name.full, role: creator.role }] : [],
    images: { webp: { large_image_url: cover }, jpg: { large_image_url: cover } }
  };
}

function mergeMangaDetails(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    title: primary.title || fallback.title,
    title_english: primary.title_english || fallback.title_english,
    synopsis: primary.synopsis || fallback.synopsis,
    chapters: primary.chapters || fallback.chapters,
    volumes: primary.volumes || fallback.volumes,
    year: primary.year || fallback.year,
    authors: primary.authors?.length ? primary.authors : fallback.authors,
    images: getMangaCover(primary) ? primary.images : fallback.images
  };
}

function getMangaYear(manga) {
  if (manga.year) return manga.year;
  const published = manga.published?.from;
  return published ? new Date(published).getFullYear() : "Unknown";
}

function getMangaCreator(manga) {
  const author = manga.authors?.[0];
  return author ? `${author.name}${author.role ? ` (${author.role})` : ""}` : "Creator information unavailable.";
}

function addMangaFact(label, value) {
  const fact = document.createElement("p");
  fact.textContent = `${label}: ${value}`;
  document.querySelector("#manga-facts").append(fact);
  return fact;
}

function makeMangaSuggestion(manga, label) {
  cacheMangaPreview(manga);
  const title = manga.title_english || manga.title || manga.name || "Untitled manga";
  const card = document.createElement("a");
  card.className = "suggested-manga";
  card.href = `manga-detail.html?id=${encodeURIComponent(manga.mal_id)}`;
  card.setAttribute("aria-label", `${title}, ${label}`);
  const coverUrl = getMangaCover(manga);
  if (coverUrl) {
    const cover = document.createElement("img");
    cover.src = coverUrl;
    cover.alt = `Cover for ${title}`;
    cover.loading = "lazy";
    cover.decoding = "async";
    card.append(cover);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "suggested-cover-placeholder";
    placeholder.textContent = "Cover unavailable";
    card.append(placeholder);
  }
  const type = document.createElement("span");
  type.className = "suggested-manga-label";
  type.textContent = label;
  const titleLabel = document.createElement("span");
  titleLabel.className = "suggested-manga-title";
  titleLabel.textContent = title;
  card.append(type, titleLabel);
  return card;
}

async function loadMangaFranchise(manga, seenIds, grid, generation) {
  const allowed = new Set(["sequel", "prequel", "spin-off", "spin off", "side story", "parent story"]);
  try {
    const response = await fetchJikanManga(`/manga/${manga.mal_id}/relations`);
    if (generation !== mangaSuggestionGeneration) return;
    const entries = (response.data || [])
      .filter((relation) => allowed.has((relation.relation || "").toLowerCase()))
      .flatMap((relation) => (relation.entry || []).map((entry) => ({ entry, relation: relation.relation })))
      .filter(({ entry }) => entry.type === "manga" && !seenIds.has(String(entry.mal_id)))
      .slice(0, 6);

    for (const { entry, relation } of entries) {
      const id = String(entry.mal_id);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      let suggestion = { mal_id: entry.mal_id, title: entry.name };
      try {
        suggestion = (await fetchJikanManga(`/manga/${entry.mal_id}/full`)).data;
      } catch {
        try {
          suggestion = await fetchAniListManga(entry.mal_id) || suggestion;
        } catch {
          suggestion = { ...suggestion, title: entry.name };
        }
      }
      if (generation !== mangaSuggestionGeneration) return;
      grid.append(makeMangaSuggestion(suggestion, relation));
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  } catch {
    return;
  }
}

async function loadSimilarManga(manga) {
  const generation = ++mangaSuggestionGeneration;
  const grid = document.querySelector("#suggested-manga");
  const status = document.querySelector("#manga-suggestions-status");
  const retry = document.querySelector("#retry-manga-suggestions");
  grid.replaceChildren();
  retry.hidden = true;
  status.hidden = false;
  status.textContent = "Finding similar manga...";
  const seen = new Set([String(manga.mal_id)]);
  let results = [];
  let requestFailed = false;
  let genreFailed = false;

  try {
    try {
      const response = await fetchJikanManga(`/manga/${manga.mal_id}/recommendations`);
      results = (response.data || []).map((item) => item.entry).filter((entry) => entry?.mal_id && entry.type === "manga");
    } catch {
      requestFailed = true;
    }

    if (!results.length) {
      const genres = (manga.genres || []).map((genre) => Number(genre.mal_id)).filter((id) => id > 0).slice(0, 3);
      if (genres.length) {
        try {
          const response = await fetchJikanManga(`/manga?genres=${genres.join(",")}&order_by=members&sort=desc&limit=10`);
          results = response.data || [];
        } catch {
          genreFailed = true;
        }
      }
    }

    let similarCount = 0;
    for (const entry of results) {
      if (!entry?.mal_id || seen.has(String(entry.mal_id))) continue;
      seen.add(String(entry.mal_id));
      grid.append(makeMangaSuggestion(entry, "Similar manga"));
      similarCount += 1;
      if (similarCount >= 8) break;
    }
    status.hidden = grid.childElementCount > 0;
    if (!grid.childElementCount) {
      const failed = requestFailed || genreFailed;
      status.textContent = failed ? "Manga recommendations couldn't load. Check your connection and try again." : "No similar manga were found.";
      retry.hidden = !failed;
    }
    loadMangaFranchise(manga, seen, grid, generation);
  } catch {
    status.textContent = "Manga recommendations couldn't load. Check your connection and try again.";
    retry.hidden = false;
  }
}

function showMangaBookmark() {
  const existing = (currentUser.mangaBookmarks || []).find((item) => String(item.id) === String(currentManga.id));
  document.querySelector("#volume-progress").value = String(existing?.volumeProgress || 1);
  document.querySelector("#chapter-progress").value = String(existing?.chapterProgress || 0);
  document.querySelector("#manga-completed").checked = Boolean(existing?.completed);
  document.querySelector("#manga-comment").value = existing?.comment || "";
  document.querySelector("#manga-completion-status").textContent = "";
  mangaDialog.showModal();
}

async function loadMangaDetail() {
  const { data } = await window.MamAuth.getUser();
  if (!data.user) {
    window.location.replace("index.html");
    return;
  }
  currentUser = data.user;
  if (!mangaId || !/^\d+$/.test(mangaId)) {
    mangaStatus.textContent = "This manga link is invalid.";
    return;
  }

  try {
    const cached = readMangaPreview(mangaId);
    let manga = null;
    try {
      manga = (await fetchJikanManga(`/manga/${encodeURIComponent(mangaId)}/full`)).data;
    } catch {
      manga = null;
    }
    if (!manga || !getMangaCover(manga) || !manga.synopsis) {
      try {
        manga = mergeMangaDetails(manga, await fetchAniListManga(manga?.mal_id || mangaId));
      } catch {
        manga = mergeMangaDetails(manga, null);
      }
    }
    manga = mergeMangaDetails(manga, cached);
    if (!manga) throw new Error("Manga details unavailable");
    cacheMangaPreview(manga);

    const title = manga.title_english || manga.title || "Untitled manga";
    currentManga = {
      id: manga.mal_id,
      title,
      cover: getMangaCover(manga),
      synopsis: manga.synopsis?.replace(/\s+/g, " ").trim() || "Summary unavailable.",
      chapterCount: manga.chapters || null,
      volumeCount: manga.volumes || null,
      year: getMangaYear(manga),
      creator: getMangaCreator(manga),
      status: manga.status || null
    };

    document.title = `${title} | MAM`;
    const cover = document.querySelector("#manga-cover");
    cover.src = currentManga.cover;
    cover.alt = `Cover for ${title}`;
    document.querySelector("#manga-title").textContent = title;
    document.querySelector("#manga-synopsis").textContent = currentManga.synopsis;
    addMangaFact("Chapters", currentManga.chapterCount || "Unknown");
    addMangaFact("Volumes", currentManga.volumeCount || "Unknown");
    addMangaFact("Year", currentManga.year || "Unknown");
    addMangaFact("Creator", currentManga.creator);
    document.querySelector("#manga-detail-hero").hidden = false;
    mangaStatus.hidden = true;

    const saved = (currentUser.mangaList || []).some((item) => String(item.id) === String(currentManga.id));
    if (saved) document.querySelector("#manga-watch-later").textContent = "Saved to My Tracker";
    document.querySelector("#manga-watch-later").addEventListener("click", () => {
      if (window.MamAuth.saveMangaToWatchLater(currentManga)) {
        document.querySelector("#manga-watch-later").textContent = "Saved to My Tracker";
        document.querySelector("#manga-save-status").textContent = `${title} is saved in My Tracker > Saved Manga.`;
      }
    });

    const favoriteButton = document.querySelector("#favorite-manga");
    const favoriteLabel = favoriteButton.querySelector("span");
    const alreadyFavorite = (currentUser.favoriteManga || []).some((item) => String(item.id) === String(currentManga.id));
    favoriteButton.setAttribute("aria-pressed", String(alreadyFavorite));
    favoriteLabel.textContent = alreadyFavorite ? "Favorited" : "Favorite";
    favoriteButton.addEventListener("click", () => {
      const isFavorite = window.MamAuth.toggleMangaFavorite(currentManga);
      if (isFavorite === null) return;
      currentUser.favoriteManga = currentUser.favoriteManga || [];
      currentUser.favoriteManga = isFavorite
        ? [...currentUser.favoriteManga.filter((item) => String(item.id) !== String(currentManga.id)), currentManga]
        : currentUser.favoriteManga.filter((item) => String(item.id) !== String(currentManga.id));
      favoriteButton.setAttribute("aria-pressed", String(isFavorite));
      favoriteLabel.textContent = isFavorite ? "Favorited" : "Favorite";
      document.querySelector("#manga-save-status").textContent = isFavorite
        ? `${title} is in My Tracker > Favorite Manga.`
        : `${title} was removed from My Tracker > Favorite Manga.`;
    });

    document.querySelector("#open-manga-bookmark").addEventListener("click", showMangaBookmark);
    document.querySelector("#cancel-manga-bookmark").addEventListener("click", () => mangaDialog.close());
    document.querySelector("#retry-manga-suggestions").addEventListener("click", () => loadSimilarManga(manga));
    const completedInput = document.querySelector("#manga-completed");
    const chapterInput = document.querySelector("#chapter-progress");
    completedInput.addEventListener("change", () => {
      if (completedInput.checked && currentManga.chapterCount) {
        chapterInput.max = String(currentManga.chapterCount);
        chapterInput.value = String(currentManga.chapterCount);
        document.querySelector("#manga-completion-status").textContent = `Chapter set to ${currentManga.chapterCount}.`;
      } else if (completedInput.checked) {
        document.querySelector("#manga-completion-status").textContent = "Chapter total unknown; your completed status will still be saved.";
      } else {
        document.querySelector("#manga-completion-status").textContent = "";
      }
    });
    document.querySelector("#manga-bookmark-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const completed = completedInput.checked;
      const chapterProgress = completed && currentManga.chapterCount
        ? Number(currentManga.chapterCount)
        : Number(chapterInput.value);
      const volumeProgress = Number(document.querySelector("#volume-progress").value);
      const comment = document.querySelector("#manga-comment").value.trim();
      const bookmark = { ...currentManga, volumeProgress, chapterProgress, completed, comment };
      if (!window.MamAuth.saveMangaBookmark(bookmark)) return;
      currentUser.mangaBookmarks = currentUser.mangaBookmarks || [];
      const index = currentUser.mangaBookmarks.findIndex((item) => String(item.id) === String(currentManga.id));
      if (index === -1) currentUser.mangaBookmarks.push(bookmark);
      else currentUser.mangaBookmarks[index] = bookmark;
      mangaDialog.close();
      document.querySelector("#manga-save-status").textContent = "Manga bookmark saved. Find it in My Tracker > Bookmarked Manga.";
    });

    loadSimilarManga(manga);
  } catch {
    mangaStatus.textContent = "Manga details couldn't load. Check your connection and try again.";
  }
}

loadMangaDetail();
