const detailStatus = document.querySelector("#detail-status");
const animeId = new URLSearchParams(window.location.search).get("id");
const bookmarkDialog = document.querySelector("#bookmark-dialog");
let currentAnime = null;
let currentUser = null;
let suggestionLoadGeneration = 0;

async function fetchJikan(path) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetch(`https://api.jikan.moe/v4${path}`);
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
      continue;
    }

    if (response.ok) {
      return response.json();
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
      continue;
    }
    throw new Error("Anime information could not be loaded.");
  }
}

function getCover(show) {
  return show.images?.webp?.large_image_url
    || show.images?.jpg?.large_image_url
    || show.images?.webp?.image_url
    || show.images?.jpg?.image_url
    || "";
}

function animePreviewCacheKey(id) {
  return `mam.anime-preview.v1:${id}`;
}

function readAnimePreview(id) {
  try {
    return JSON.parse(localStorage.getItem(animePreviewCacheKey(id)) || "null");
  } catch {
    return null;
  }
}

function cacheAnimePreview(show) {
  const id = show?.mal_id;
  if (!id) {
    return;
  }
  const preview = {
    mal_id: id,
    title: show.title || show.name || "Untitled anime",
    title_english: show.title_english || null,
    synopsis: show.synopsis || show.description || "",
    year: show.year || null,
    creator: show.creator || null,
    episodes: show.episodes || null,
    status: show.status || null,
    type: show.type || null,
    genres: show.genres || [],
    images: show.images || {}
  };
  try {
    localStorage.setItem(animePreviewCacheKey(id), JSON.stringify(preview));
  } catch {
    return;
  }
}

async function fetchAniListAnime(malId) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        query: "query ($malId: Int) { Media(idMal: $malId, type: ANIME) { idMal title { english romaji native } coverImage { extraLarge large } description(asHtml: false) episodes status format genres averageScore startDate { year } staff(sort: RELEVANCE, perPage: 12) { edges { role node { name { full } } } } } }",
        variables: { malId: Number(malId) }
      })
    });
    if (!response.ok) {
      throw new Error("AniList detail request failed");
    }
    const payload = await response.json();
    const anime = payload.data?.Media;
    if (!anime?.idMal) {
      return null;
    }
    const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
    const creatorRoles = new Map([
      ["original creator", 0],
      ["original work", 1],
      ["original story", 2],
      ["story & art", 3],
      ["director", 4],
      ["screenplay", 5]
    ]);
    const creatorCredit = (anime.staff?.edges || [])
      .filter((edge) => creatorRoles.has(edge.role?.toLowerCase()))
      .sort((first, second) => creatorRoles.get(first.role.toLowerCase()) - creatorRoles.get(second.role.toLowerCase()))[0];
    const genreIds = { Action: 1, Adventure: 2, Comedy: 4, Drama: 8, Fantasy: 10, Horror: 14, Mystery: 7, Romance: 22, "Sci-Fi": 24, "Slice of Life": 36, Sports: 30, Supernatural: 37 };
    return {
      mal_id: anime.idMal,
      title_english: anime.title?.english || "",
      title: anime.title?.romaji || anime.title?.native || "Untitled anime",
      title_japanese: anime.title?.native || "",
      synopsis: anime.description || "",
      year: anime.startDate?.year || null,
      creator: creatorCredit?.node?.name?.full
        ? `${creatorCredit.node.name.full} (${creatorCredit.role})`
        : null,
      episodes: anime.episodes || null,
      status: anime.status === "RELEASING" ? "Currently Airing" : anime.status === "FINISHED" ? "Finished Airing" : anime.status || null,
      type: anime.format === "TV" ? "TV" : anime.format || null,
      score: anime.averageScore ? anime.averageScore / 10 : null,
      genres: (anime.genres || []).map((name) => ({ mal_id: genreIds[name] || 0, name })),
      images: { webp: { large_image_url: cover }, jpg: { large_image_url: cover } }
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function getAnimeEpisodeTotal(malId) {
  try {
    const firstPage = await fetchJikan(`/anime/${encodeURIComponent(malId)}/episodes?page=1`);
    const reportedTotal = Number(firstPage.pagination?.items?.total);
    if (Number.isFinite(reportedTotal) && reportedTotal > 0) {
      return reportedTotal;
    }

    const lastPage = Number(firstPage.pagination?.last_visible_page) || 1;
    const pageSize = Number(firstPage.pagination?.items?.per_page) || firstPage.data?.length || 0;
    if (lastPage === 1) {
      return firstPage.data?.length || null;
    }
    if (!pageSize) {
      return null;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 400));
    const finalPage = await fetchJikan(`/anime/${encodeURIComponent(malId)}/episodes?page=${lastPage}`);
    return (lastPage - 1) * pageSize + (finalPage.data?.length || 0);
  } catch {
    return null;
  }
}

function mergeAnimeDetails(primary, fallback) {
  if (!primary) {
    return fallback;
  }
  if (!fallback) {
    return primary;
  }
  return {
    ...fallback,
    ...primary,
    title: primary.title || fallback.title,
    title_english: primary.title_english || fallback.title_english,
    title_japanese: primary.title_japanese || fallback.title_japanese,
    synopsis: primary.synopsis || fallback.synopsis,
    year: primary.year || fallback.year,
    creator: primary.creator || fallback.creator,
    episodes: primary.episodes || fallback.episodes,
    status: primary.status || fallback.status,
    type: primary.type || fallback.type,
    genres: primary.genres?.length ? primary.genres : fallback.genres,
    images: getCover(primary) ? primary.images : fallback.images
  };
}

function addFact(label, value) {
  const fact = document.createElement("p");
  fact.textContent = `${label}: ${value}`;
  document.querySelector("#anime-facts").append(fact);
  return fact;
}

function getAnimeYear(show) {
  if (show.year) {
    return show.year;
  }
  const releaseDate = show.aired?.from;
  return releaseDate ? new Date(releaseDate).getFullYear() : "Unknown";
}

async function loadAnimeCreator(show) {
  if (show.creator) {
    return show.creator;
  }

  const cached = readAnimePreview(show.mal_id);
  if (cached?.creator) {
    return cached.creator;
  }

  const rolePriority = new Map([
    ["original creator", 0],
    ["original work", 1],
    ["original story", 2],
    ["story & art", 3],
    ["director", 4],
    ["screenplay", 5],
    ["series composition", 6]
  ]);

  let staffResponse = null;
  try {
    staffResponse = await fetchJikan(`/anime/${show.mal_id}/staff`);
  } catch {
    staffResponse = null;
  }
  const credits = (staffResponse?.data || [])
    .flatMap((member) => (member.positions || []).map((position) => ({ member, position })))
    .filter(({ position }) => rolePriority.has(position.toLowerCase()))
    .sort((first, second) => rolePriority.get(first.position.toLowerCase()) - rolePriority.get(second.position.toLowerCase()));
  if (credits.length) {
    const { member, position } = credits[0];
    return `${member.person?.name || "Creator unavailable"} (${position})`;
  }

  try {
    const aniListShow = await fetchAniListAnime(show.mal_id);
    if (aniListShow?.creator) {
      return aniListShow.creator;
    }
  } catch {
    return "Creator information unavailable.";
  }

  return "Creator information unavailable.";
}

function getTitleVariants(show) {
  return [show.title, show.title_english, show.title_japanese, ...(show.title_synonyms || [])]
    .filter(Boolean);
}

function getSeasonTitleKey(title) {
  return title.toLowerCase()
    .replace(/\bseason\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, " ")
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasExplicitSeasonNumber(title) {
  return /\bseason\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b|\b\d+(?:st|nd|rd|th)\s+season\b/i.test(title);
}

async function loadSeasonCount(show) {
  if (show.type !== "TV") {
    return 0;
  }

  const seriesTitles = new Set(getTitleVariants(show).map(getSeasonTitleKey).filter(Boolean));
  let seasonCount = 1;
  let currentId = show.mal_id;
  const visited = new Set([String(currentId)]);

  for (let index = 0; index < 15; index += 1) {
    try {
      const relations = await fetchJikan(`/anime/${currentId}/relations`);
      const sequelEntries = (relations.data || [])
        .filter((relation) => relation.relation?.toLowerCase() === "sequel")
        .flatMap((relation) => relation.entry || [])
        .filter((entry) => entry.type === "anime" && !visited.has(String(entry.mal_id)));
      let nextSeason = null;

      for (const entry of sequelEntries) {
        try {
          const sequelResponse = await fetchJikan(`/anime/${entry.mal_id}/full`);
          const sequel = sequelResponse.data;
          const sequelTitles = getTitleVariants(sequel);
          const isSameSeries = sequelTitles.some((title) => seriesTitles.has(getSeasonTitleKey(title)));
          const hasSeasonNumber = sequelTitles.some(hasExplicitSeasonNumber);
          if (sequel.type === "TV" && isSameSeries && hasSeasonNumber) {
            nextSeason = sequel;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!nextSeason) {
        break;
      }

      currentId = nextSeason.mal_id;
      visited.add(String(currentId));
      seasonCount += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    } catch {
      break;
    }
  }

  return seasonCount;
}

function makeSuggestionCard(show, label) {
  cacheAnimePreview(show);
  const title = show.title_english || show.title || show.name || "Untitled anime";
  const card = document.createElement("a");
  card.className = "suggested-anime";
  card.href = `anime-detail.html?id=${encodeURIComponent(show.mal_id)}`;
  card.setAttribute("aria-label", `${title}, ${label}`);

  const coverUrl = getCover(show);
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

  const typeLabel = document.createElement("span");
  typeLabel.className = "suggested-anime-label";
  typeLabel.textContent = label;
  const titleLabel = document.createElement("span");
  titleLabel.className = "suggested-anime-title";
  titleLabel.textContent = title;
  card.append(typeLabel, titleLabel);
  return card;
}

async function loadFranchiseSuggestions(show, seenIds, suggestionGrid, generation) {
  const status = document.querySelector("#suggestions-status");
  const retryButton = document.querySelector("#retry-suggestions");
  const allowedRelations = new Set(["sequel", "prequel", "spin-off", "spin off", "side story", "parent story"]);

  try {
    const response = await fetchJikan(`/anime/${show.mal_id}/relations`);
    if (generation !== suggestionLoadGeneration) {
      return;
    }
    const entries = (response.data || [])
      .filter((relation) => allowedRelations.has((relation.relation || "").toLowerCase()))
      .flatMap((relation) => (relation.entry || []).map((entry) => ({ entry, relation: relation.relation })))
      .filter(({ entry }) => entry.type === "anime" && !seenIds.has(String(entry.mal_id)))
      .slice(0, 6);

    for (let index = 0; index < entries.length; index += 1) {
      const { entry, relation } = entries[index];
      const entryId = String(entry.mal_id);
      if (seenIds.has(entryId)) {
        continue;
      }
      seenIds.add(entryId);
      let relatedAnime = { mal_id: entry.mal_id, name: entry.name };
      try {
        const details = await fetchJikan(`/anime/${entry.mal_id}/full`);
        if (generation !== suggestionLoadGeneration) {
          return;
        }
        relatedAnime = details.data;
      } catch {
        relatedAnime.title = entry.name;
      }
      suggestionGrid.append(makeSuggestionCard(relatedAnime, relation));
      status.hidden = true;
      retryButton.hidden = true;
      if (index < entries.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
    }
  } catch {
    return;
  }
}

async function loadSimilarAnime(show) {
  const generation = ++suggestionLoadGeneration;
  const status = document.querySelector("#suggestions-status");
  const suggestionGrid = document.querySelector("#suggested-anime");
  const retryButton = document.querySelector("#retry-suggestions");
  retryButton.hidden = true;
  suggestionGrid.replaceChildren();
  status.hidden = false;
  status.textContent = "Finding similar anime...";
  const seenIds = new Set([String(show.mal_id)]);
  let recommendations = [];
  let requestFailed = false;
  let genreRequestFailed = false;

  try {
    try {
      const response = await fetchJikan(`/anime/${show.mal_id}/recommendations`);
      if (generation !== suggestionLoadGeneration) {
        return;
      }
      recommendations = (response.data || [])
        .map((item) => item.entry)
        .filter((entry) => entry?.mal_id && entry.type === "anime");
    } catch {
      requestFailed = true;
    }
    if (generation !== suggestionLoadGeneration) {
      return;
    }

    recommendations = recommendations.filter((entry) => !seenIds.has(String(entry.mal_id)));
    let similarLabel = "Similar anime";
    if (!recommendations.length) {
      const genreIds = (show.genres || [])
        .map((genre) => Number(genre.mal_id))
        .filter((id) => Number.isInteger(id) && id > 0)
        .slice(0, 3);
      if (genreIds.length) {
        try {
          const genreResponse = await fetchJikan(`/anime?genres=${genreIds.join(",")}&order_by=members&sort=desc&limit=10`);
          if (generation !== suggestionLoadGeneration) {
            return;
          }
          recommendations.push(...(genreResponse.data || []).filter((entry) => entry.type === "anime"));
          similarLabel = "Similar genre";
        } catch {
          genreRequestFailed = true;
        }
      }
    }
    if (generation !== suggestionLoadGeneration) {
      return;
    }

    let similarCount = 0;
    for (const entry of recommendations) {
      if (!entry?.mal_id || seenIds.has(String(entry.mal_id))) {
        continue;
      }
      seenIds.add(String(entry.mal_id));
      suggestionGrid.append(makeSuggestionCard(entry, similarLabel));
      similarCount += 1;
      if (similarCount === 8) {
        break;
      }
    }

    status.hidden = suggestionGrid.childElementCount > 0;
    if (!suggestionGrid.childElementCount) {
      const failedToLoad = requestFailed || genreRequestFailed;
      status.textContent = failedToLoad
        ? "Recommendations couldn't load. Check your connection and try again."
        : "No similar anime were found.";
      retryButton.hidden = !failedToLoad;
    }
    loadFranchiseSuggestions(show, seenIds, suggestionGrid, generation);
  } catch {
    if (generation !== suggestionLoadGeneration) {
      return;
    }
    status.textContent = "Recommendations couldn't load. Check your connection and try again.";
    retryButton.hidden = false;
    loadFranchiseSuggestions(show, seenIds, suggestionGrid, generation);
  }
}

function showBookmarkDialog() {
  const existing = (currentUser.animeBookmarks || []).find((anime) => String(anime.id) === String(currentAnime.id));
  document.querySelector("#season-progress").value = String(existing?.seasonProgress || 1);
  const episodeInput = document.querySelector("#episode-progress");
  const completedInput = document.querySelector("#anime-completed");
  const totalEpisodes = Number(currentAnime.episodeCount) || Number(existing?.episodeCount);
  const isComplete = Boolean(existing?.completed || (totalEpisodes > 0 && Number(existing?.episodeProgress) >= totalEpisodes));
  episodeInput.value = String(isComplete && totalEpisodes > 0 ? totalEpisodes : existing?.episodeProgress || 0);
  if (totalEpisodes > 0) {
    episodeInput.max = String(totalEpisodes);
  }
  completedInput.checked = isComplete;
  document.querySelector("#completion-status").textContent = "";
  document.querySelector("#anime-comment").value = existing?.comment || "";
  bookmarkDialog.showModal();
}

async function loadAnime() {
  const { data } = await window.MamAuth.getUser();
  if (!data.user) {
    window.location.replace("index.html");
    return;
  }
  currentUser = data.user;

  if (!animeId || !/^\d+$/.test(animeId)) {
    detailStatus.textContent = "This anime link is invalid.";
    return;
  }

  try {
    const cachedPreview = readAnimePreview(animeId);
    let show = null;
    try {
      const response = await fetchJikan(`/anime/${encodeURIComponent(animeId)}/full`);
      show = response.data;
    } catch {
      show = null;
    }

    if (!show || !getCover(show) || !show.synopsis) {
      let aniListShow = null;
      try {
        aniListShow = await fetchAniListAnime(show?.mal_id || animeId);
      } catch {
        aniListShow = null;
      }
      show = mergeAnimeDetails(show, aniListShow);
    }
    show = mergeAnimeDetails(show, cachedPreview);
    if (!show) {
      throw new Error("Anime details are unavailable from online sources.");
    }

    cacheAnimePreview(show);
    const title = show.title_english || show.title || "Untitled anime";
    const cover = getCover(show);
    const synopsis = show.synopsis?.replace(/\s+/g, " ").trim() || "Summary unavailable.";
    currentAnime = {
      id: show.mal_id,
      title,
      cover,
      synopsis,
      episodeCount: show.episodes || null,
      status: show.status || null,
      seasonCount: show.type === "TV" ? 1 : 0
    };

    document.title = `${title} | MAM`;
    const coverImage = document.querySelector("#anime-cover");
    coverImage.src = cover;
    coverImage.alt = `Cover for ${title}`;
    document.querySelector("#anime-title").textContent = title;
    document.querySelector("#anime-synopsis").textContent = synopsis;
    addFact("Episodes", show.episodes || "Unknown");
    addFact("Number of seasons", show.type === "TV" ? "1 (checking series)" : "N/A");
    addFact("Year", getAnimeYear(show));
    const creatorFact = addFact("Creator", show.creator || "Loading...");
    document.querySelector("#detail-hero").hidden = false;
    detailStatus.hidden = true;
    if (!show.creator) {
      loadAnimeCreator(show).then((creator) => {
        show.creator = creator;
        currentAnime.creator = creator;
        cacheAnimePreview(show);
        creatorFact.textContent = `Creator: ${creator}`;
      });
    }

    const saved = (currentUser.animeList || []).some((anime) => String(anime.id) === String(currentAnime.id));
    if (saved) {
      document.querySelector("#watch-later").textContent = "Saved to My Tracker";
    }

    const favoriteButton = document.querySelector("#favorite-anime");
    const favoriteLabel = favoriteButton.querySelector("span");
    const isAlreadyFavorite = (currentUser.favoriteAnime || []).some((anime) => String(anime.id) === String(currentAnime.id));
    favoriteButton.setAttribute("aria-pressed", String(isAlreadyFavorite));
    favoriteLabel.textContent = isAlreadyFavorite ? "Favorited" : "Favorite";
    favoriteButton.addEventListener("click", () => {
      const isFavorite = window.MamAuth.toggleAnimeFavorite(currentAnime);
      if (isFavorite === null) {
        document.querySelector("#save-status").textContent = "Favorite couldn't be updated. Please try again.";
        return;
      }

      currentUser.favoriteAnime = currentUser.favoriteAnime || [];
      currentUser.favoriteAnime = isFavorite
        ? [...currentUser.favoriteAnime.filter((anime) => String(anime.id) !== String(currentAnime.id)), currentAnime]
        : currentUser.favoriteAnime.filter((anime) => String(anime.id) !== String(currentAnime.id));
      favoriteButton.setAttribute("aria-pressed", String(isFavorite));
      favoriteLabel.textContent = isFavorite ? "Favorited" : "Favorite";
      document.querySelector("#save-status").textContent = isFavorite
        ? `${title} is in My Tracker > Favorite Anime.`
        : `${title} was removed from My Tracker > Favorite Anime.`;
    });

    document.querySelector("#watch-later").addEventListener("click", () => {
      if (window.MamAuth.saveAnimeToWatchLater(currentAnime)) {
        document.querySelector("#watch-later").textContent = "Saved to My Tracker";
        document.querySelector("#save-status").textContent = `${title} is saved in My Tracker > Saved.`;
      }
    });
    document.querySelector("#open-bookmark").addEventListener("click", showBookmarkDialog);
    document.querySelector("#cancel-bookmark").addEventListener("click", () => bookmarkDialog.close());
    document.querySelector("#retry-suggestions").addEventListener("click", () => loadSimilarAnime(show));
    const completedInput = document.querySelector("#anime-completed");
    const episodeInput = document.querySelector("#episode-progress");
    const completionStatus = document.querySelector("#completion-status");
    completedInput.addEventListener("change", async () => {
      if (!completedInput.checked) {
        completionStatus.textContent = "";
        return;
      }

      let totalEpisodes = Number(currentAnime.episodeCount);
      if (!Number.isFinite(totalEpisodes) || totalEpisodes <= 0) {
        completionStatus.textContent = "Finding the episode total...";
        totalEpisodes = await getAnimeEpisodeTotal(currentAnime.id);
      }
      if (!totalEpisodes) {
        completedInput.checked = false;
        completionStatus.textContent = "Could not find the episode total. Enter your episode manually.";
        return;
      }

      currentAnime.episodeCount = totalEpisodes;
      episodeInput.max = String(totalEpisodes);
      episodeInput.value = String(totalEpisodes);
      completionStatus.textContent = `Episode set to ${totalEpisodes}.`;
    });

    document.querySelector("#bookmark-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const completed = completedInput.checked;
      if (completed && !(Number(currentAnime.episodeCount) > 0)) {
        completionStatus.textContent = "Finding the episode total...";
        const totalEpisodes = await getAnimeEpisodeTotal(currentAnime.id);
        if (!totalEpisodes) {
          completionStatus.textContent = "Could not find the episode total. Enter your episode manually.";
          return;
        }
        currentAnime.episodeCount = totalEpisodes;
        episodeInput.max = String(totalEpisodes);
        episodeInput.value = String(totalEpisodes);
      }
      const seasonProgress = Number(document.querySelector("#season-progress").value);
      const episodeProgress = completed ? Number(currentAnime.episodeCount) : Number(episodeInput.value);
      const comment = document.querySelector("#anime-comment").value.trim();
      const savedBookmark = window.MamAuth.saveAnimeBookmark({
        ...currentAnime,
        seasonProgress,
        episodeProgress,
        completed,
        comment
      });

      if (!savedBookmark) {
        return;
      }
      currentUser.animeBookmarks = currentUser.animeBookmarks || [];
      const previousIndex = currentUser.animeBookmarks.findIndex((anime) => String(anime.id) === String(currentAnime.id));
      const bookmark = { ...currentAnime, seasonProgress, episodeProgress, completed, comment };
      if (previousIndex === -1) {
        currentUser.animeBookmarks.push(bookmark);
      } else {
        currentUser.animeBookmarks[previousIndex] = bookmark;
      }
      bookmarkDialog.close();
      document.querySelector("#save-status").textContent = "Bookmark saved. Find it in My Tracker.";
    });

    const seasonCountFact = document.querySelector("#anime-facts p:nth-child(2)");
    const seasonCount = await loadSeasonCount(show);
    currentAnime.seasonCount = seasonCount;
    seasonCountFact.textContent = `Number of seasons: ${seasonCount || "N/A"}`;
    document.querySelector("#season-progress").max = String(Math.max(seasonCount, 1));
    if (show.episodes) {
      document.querySelector("#episode-progress").max = String(show.episodes);
    }
    loadSimilarAnime(show);
  } catch {
    detailStatus.textContent = "Anime details couldn't load. Check your connection and try again.";
  }
}

loadAnime();
