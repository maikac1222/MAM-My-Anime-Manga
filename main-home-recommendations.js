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

const offlineRecommendations = {
  anime: [
    { mal_id: 16498, title: "Attack on Titan", genres: ["Action", "Adventure", "Drama", "Fantasy"] },
    { mal_id: 5114, title: "Fullmetal Alchemist: Brotherhood", genres: ["Action", "Adventure", "Drama", "Fantasy"] },
    { mal_id: 1535, title: "Death Note", genres: ["Mystery", "Supernatural", "Thriller"] },
    { mal_id: 20, title: "Naruto", genres: ["Action", "Adventure"] },
    { mal_id: 21, title: "One Piece", genres: ["Action", "Adventure", "Fantasy"] }
  ],
  manga: [
    { mal_id: 2, title: "Berserk", genres: ["Action", "Adventure", "Drama", "Fantasy"] },
    { mal_id: 13, title: "One Piece", genres: ["Action", "Adventure", "Fantasy"] },
    { mal_id: 21, title: "Death Note", genres: ["Mystery", "Supernatural", "Thriller"] },
    { mal_id: 119161, title: "Spy x Family", genres: ["Action", "Comedy"] },
    { mal_id: 104, title: "Yotsuba&!", genres: ["Comedy", "Slice of Life"] }
  ]
};

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
    .filter(({ show }) => getPosterUrls(show).length > 0 || show.offlineFallback)
    .slice(0, 12)
    .map(({ show }) => ({
      ...show,
      offlineFallback: show.offlineFallback || false,
      url: show.url || (category === "manga" ? `https://myanimelist.net/manga/${show.mal_id}` : "")
    }));
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

function renderRecommendations(carousel, status, recommendations, category) {
  if (!recommendations.length) {
    return false;
  }

  const posterTrack = carousel.querySelector(".poster-track");
  const cards = recommendations.map((show) => {
    const title = show.title_english || show.title || "Untitled";
    const posterUrls = getPosterUrls(show);
    let poster;

    if (posterUrls.length) {
      poster = document.createElement("img");
      let posterIndex = 0;
      poster.src = posterUrls[posterIndex];
      poster.alt = `Poster for ${title}`;
      poster.loading = "lazy";
      poster.decoding = "async";
      poster.addEventListener("error", () => {
        posterIndex += 1;
        if (posterIndex < posterUrls.length) {
          poster.src = posterUrls[posterIndex];
        }
      });
    } else {
      poster = document.createElement("span");
      poster.className = "poster-card-placeholder";
      poster.setAttribute("aria-hidden", "true");
      poster.textContent = "Offline pick";
    }

    const titleLabel = document.createElement("span");
    titleLabel.className = "poster-card-title";
    titleLabel.textContent = title;

    const description = document.createElement("p");
    description.className = "poster-card-description";
    description.textContent = show.synopsis?.replace(/\s+/g, " ").trim() || "Offline recommendation.";

    const card = document.createElement("a");
    card.className = "poster-card";
    card.href = `${category}-detail.html?id=${encodeURIComponent(show.mal_id)}`;
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
  const fallback = offlineRecommendations[category].map((show) => ({
    ...show,
    genres: show.genres.map((name) => ({ name })),
    synopsis: "Offline recommendation.",
    offlineFallback: true
  }));
  const initialRecommendations = cached?.length
    ? cached
    : rankRecommendations(fallback, preferredGenres, category);
  const hasInitialRecommendations = renderRecommendations(carousel, status, initialRecommendations, category);

  try {
    const responseData = await fetchTopShows(category, () => {
      if (!hasInitialRecommendations) {
        status.textContent = "Retrying recommendations...";
      }
    });
    const recommendations = rankRecommendations(responseData.data || [], preferredGenres, category);

    if (!recommendations.length) {
      throw new Error("No recommendations available");
    }

    writeRecommendationCache(cacheKey, recommendations);
    renderRecommendations(carousel, status, recommendations, category);
  } catch {
    if (!hasInitialRecommendations) {
      status.textContent = "Recommendations couldn't load. Check your connection and refresh.";
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