function updateCarouselControls(carousel) {
  const posterTrack = carousel.querySelector(".poster-track");
  const maximumScroll = posterTrack.scrollWidth - posterTrack.clientWidth;
  carousel.querySelectorAll(".carousel-control").forEach((button) => {
    const direction = Number(button.dataset.scroll);
    button.disabled = direction < 0
      ? posterTrack.scrollLeft <= 1
      : posterTrack.scrollLeft >= maximumScroll - 1;
  });
}

function setupCarouselControls(carousel) {
  const posterTrack = carousel.querySelector(".poster-track");
  carousel.querySelectorAll(".carousel-control").forEach((button) => {
    button.addEventListener("click", () => {
      posterTrack.scrollBy({
        left: Number(button.dataset.scroll) * posterTrack.clientWidth * 0.8,
        behavior: "smooth"
      });
    });
  });

  posterTrack.addEventListener("scroll", () => updateCarouselControls(carousel), { passive: true });
  window.addEventListener("resize", () => updateCarouselControls(carousel));
}

function getPosterUrls(show) {
  return [
    show.images?.webp?.large_image_url,
    show.images?.jpg?.large_image_url,
    show.images?.webp?.image_url,
    show.images?.jpg?.image_url,
    show.images?.webp?.small_image_url,
    show.images?.jpg?.small_image_url
  ].filter((url, index, urls) => url && urls.indexOf(url) === index);
}

function createOfflineCover(title, category, index) {
  const palettes = category === "manga"
    ? [["#26363a", "#bfffe1"], ["#462d32", "#f4edbd"], ["#34314a", "#bfe9ff"]]
    : [["#3d2929", "#f4edbd"], ["#293b45", "#bfe9ff"], ["#3b3343", "#bfffe1"]];
  const [background, accent] = palettes[index % palettes.length];
  const words = title.trim().split(/\s+/);
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length > 15 && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  });
  if (currentLine) lines.push(currentLine);

  const escapeXml = (value) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;"
  })[character]);
  const titleLines = lines.slice(0, 4).map((line, lineIndex) => (
    `<text x="24" y="${320 + lineIndex * 28}" fill="#fff8e8" font-family="Georgia,serif" font-size="23" font-weight="700">${escapeXml(line)}</text>`
  )).join("");
  const artwork = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><rect width="300" height="450" fill="${background}"/><path d="M0 0h300v110L0 330Z" fill="${accent}" opacity=".22"/><circle cx="210" cy="150" r="92" fill="none" stroke="${accent}" stroke-width="2" opacity=".75"/><circle cx="210" cy="150" r="67" fill="${accent}" opacity=".18"/><path d="M0 275 300 82v120L0 395Z" fill="#111820" opacity=".5"/><path d="M25 25h250v400H25z" fill="none" stroke="${accent}" stroke-width="3" opacity=".75"/><text x="24" y="292" fill="${accent}" font-family="Arial,sans-serif" font-size="12" letter-spacing="3">${category.toUpperCase()}</text>${titleLines}<text x="24" y="406" fill="${accent}" font-family="Arial,sans-serif" font-size="10" letter-spacing="2">MAM COLLECTION</text></svg>`;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(artwork)}`;
}

function getRecommendationCacheKey(category, preferredGenres, user) {
  const identity = user?.email?.toLowerCase() || "guest";
  const genres = [...preferredGenres].sort().join(",");
  return `mam.recommendations.v1:${encodeURIComponent(identity)}:${category}:${encodeURIComponent(genres)}`;
}

function readRecommendationCache(cacheKey) {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
    return Array.isArray(cached?.shows) ? cached.shows : null;
  } catch {
    return null;
  }
}

function writeRecommendationCache(cacheKey, shows) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), shows }));
  } catch {
    return false;
  }
  return true;
}

function rankRecommendations(shows, preferredGenres, category) {
  return shows
    .map((show) => ({
      show,
      matchingGenres: (show.genres || []).filter((genre) => {
        const name = typeof genre === "string" ? genre : genre?.name;
        return name && preferredGenres.has(name.toLowerCase());
      }).length
    }))
    .sort((first, second) => second.matchingGenres - first.matchingGenres || (second.show.score || 0) - (first.show.score || 0))
    .filter(({ show }) => getPosterUrls(show).length > 0)
    .slice(0, 12)
    .map(({ show }) => show);
}

async function fetchTopShows(category, onRetry) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 7000);
    let response;
    let responseData;

    try {
      response = await fetch(`https://api.jikan.moe/v4/top/${category}?limit=25`, {
        signal: controller.signal
      });
      if (response.ok) {
        responseData = await response.json();
      }
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (response?.ok) {
      return responseData;
    }
    if (response && response.status !== 429 && response.status < 500) {
      throw new Error("Recommendation request failed");
    }
    if (response) {
      lastError = new Error("Recommendation request failed");
    }
    if (attempt === 1) {
      throw lastError || new Error("Recommendation request failed");
    }

    onRetry();
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
}

async function fetchAniListAnime() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        query: "query { Page(page: 1, perPage: 24) { media(type: ANIME, sort: POPULARITY_DESC) { idMal title { english romaji } coverImage { extraLarge large } description(asHtml: false) episodes format genres averageScore } } }"
      })
    });
    if (!response.ok) {
      throw new Error("Online Anime recommendations could not be loaded");
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error("Online Anime recommendations could not be loaded");
    }

    return (payload.data?.Page?.media || [])
      .filter((anime) => anime.idMal && (anime.title?.english || anime.title?.romaji))
      .map((anime) => {
        const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
        return {
          mal_id: anime.idMal,
          title_english: anime.title?.english || "",
          title: anime.title?.romaji || "Untitled anime",
          synopsis: anime.description || "",
          episodes: anime.episodes || null,
          type: anime.format || null,
          score: anime.averageScore ? anime.averageScore / 10 : null,
          genres: (anime.genres || []).map((name) => ({ name })),
          images: { webp: { large_image_url: cover }, jpg: { large_image_url: cover } }
        };
      });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchAniListManga() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        query: "query { Page(page: 1, perPage: 24) { media(type: MANGA, sort: POPULARITY_DESC) { idMal title { english romaji } coverImage { extraLarge large } description(asHtml: false) chapters volumes format genres averageScore } } }"
      })
    });
    if (!response.ok) {
      throw new Error("Online Manga recommendations could not be loaded");
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error("Online Manga recommendations could not be loaded");
    }

    return (payload.data?.Page?.media || [])
      .filter((manga) => manga.idMal && (manga.title?.english || manga.title?.romaji))
      .map((manga) => {
        const cover = manga.coverImage?.extraLarge || manga.coverImage?.large || "";
        return {
          mal_id: manga.idMal,
          title_english: manga.title?.english || "",
          title: manga.title?.romaji || "Untitled Manga",
          synopsis: manga.description || "",
          chapters: manga.chapters || null,
          volumes: manga.volumes || null,
          type: manga.format || "Manga",
          score: manga.averageScore ? manga.averageScore / 10 : null,
          genres: (manga.genres || []).map((name) => ({ name })),
          images: { webp: { large_image_url: cover }, jpg: { large_image_url: cover } }
        };
      });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function renderRecommendations(carousel, status, recommendations, category) {
  if (!recommendations.length) {
    return false;
  }
  const detailPages = { anime: "anime-detail.html", manga: "manga-detail.html" };
  const detailPage = detailPages[category];
  if (!detailPage) {
    return false;
  }

  const posterTrack = carousel.querySelector(".poster-track");
  const cards = recommendations.map((show, index) => {
    const title = show.title_english || show.title || "Untitled";
    const posterUrls = getPosterUrls(show);
    let poster;

    poster = document.createElement("img");
    let posterIndex = 0;
    poster.src = posterUrls[posterIndex] || createOfflineCover(title, category, index);
    poster.alt = `${posterUrls.length ? "Cover" : "Cover-style artwork"} for ${title}`;
    poster.loading = "lazy";
    poster.decoding = "async";
    if (posterUrls.length) {
      poster.addEventListener("error", () => {
        posterIndex += 1;
        if (posterIndex < posterUrls.length) {
          poster.src = posterUrls[posterIndex];
        } else {
          poster.src = createOfflineCover(title, category, index);
          poster.alt = `Cover-style artwork for ${title}`;
        }
      });
    }

    const titleLabel = document.createElement("span");
    titleLabel.className = "poster-card-title";
    titleLabel.textContent = title;

    const description = document.createElement("p");
    description.className = "poster-card-description";
    description.textContent = show.synopsis?.replace(/\s+/g, " ").trim() || "No synopsis available.";

    const card = document.createElement("a");
    card.className = "poster-card";
    card.href = `${detailPage}?id=${encodeURIComponent(show.mal_id)}`;
    card.append(poster, titleLabel, description);
    return card;
  });

  status.hidden = true;
  posterTrack.replaceChildren(status, ...cards);
  updateCarouselControls(carousel);
  return true;
}

async function loadRecommendations(carousel, preferredGenres, user) {
  const posterTrack = carousel.querySelector(".poster-track");
  const status = posterTrack.querySelector(".poster-status");
  const category = carousel.dataset.category;
  const cacheKey = getRecommendationCacheKey(category, preferredGenres, user);
  const cached = readRecommendationCache(cacheKey);
  const initialRecommendations = cached?.length ? cached : [];
  const hasInitialRecommendations = renderRecommendations(carousel, status, initialRecommendations, category);

  try {
    let onlineShows;
    let usedAniListFallback = false;
    try {
      const responseData = await fetchTopShows(category, () => {
        if (!hasInitialRecommendations) {
          status.textContent = category === "manga" ? "Loading online Manga covers..." : "Retrying recommendations...";
        }
      });
      onlineShows = responseData.data || [];
    } catch (error) {
      usedAniListFallback = true;
      status.textContent = category === "manga" ? "Loading online Manga covers..." : "Loading online Anime recommendations...";
      onlineShows = category === "manga" ? await fetchAniListManga() : await fetchAniListAnime();
    }

    let recommendations = rankRecommendations(onlineShows, preferredGenres, category);
    if (!recommendations.length && !usedAniListFallback) {
      status.textContent = category === "manga" ? "Loading online Manga covers..." : "Loading online Anime recommendations...";
      const alternateShows = category === "manga" ? await fetchAniListManga() : await fetchAniListAnime();
      recommendations = rankRecommendations(alternateShows, preferredGenres, category);
    }

    if (!recommendations.length) {
      throw new Error("No recommendations available");
    }

    writeRecommendationCache(cacheKey, recommendations);
    renderRecommendations(carousel, status, recommendations, category);
  } catch {
    if (!hasInitialRecommendations) {
      status.textContent = category === "manga"
        ? "Online Manga recommendations couldn't load. Check your connection and refresh."
        : "Online Anime recommendations couldn't load. Check your connection and refresh.";
    }
  }
}

async function loadAllRecommendations() {
  const carousels = [...document.querySelectorAll(".home-panel[data-category]")];
  carousels.forEach(setupCarouselControls);

  let user = null;
  try {
    const { data } = await window.MamAuth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  const preferredGenres = new Set(
    (user?.favoriteGenres || []).filter((genre) => typeof genre === "string").map((genre) => genre.toLowerCase())
  );

  await Promise.all(carousels.map((carousel) => loadRecommendations(carousel, preferredGenres, user)));
}

loadAllRecommendations();