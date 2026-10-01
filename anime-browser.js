const animeGenres = [
  { id: 1, name: "Action" },
  { id: 2, name: "Adventure" },
  { id: 4, name: "Comedy" },
  { id: 8, name: "Drama" },
  { id: 10, name: "Fantasy" },
  { id: 14, name: "Horror" },
  { id: 7, name: "Mystery" },
  { id: 22, name: "Romance" },
  { id: 24, name: "Sci-Fi" },
  { id: 36, name: "Slice of Life" },
  { id: 30, name: "Sports" },
  { id: 37, name: "Supernatural" }
];

const genreOptions = document.querySelector("#genre-options");
const genreSearch = document.querySelector("#genre-search");
const animeSearch = document.querySelector("#anime-search");
const animeGrid = document.querySelector("#anime-grid");
const animeStatus = document.querySelector("#anime-status");
const selectedGenres = new Set();
let activeController = null;
let requestSequence = 0;
let searchTimer = 0;

function renderGenreOptions() {
  const chips = animeGenres.map((genre) => {
    const chip = document.createElement("button");
    chip.className = "genre-chip";
    chip.type = "button";
    chip.textContent = genre.name;
    chip.dataset.genreId = String(genre.id);
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", () => {
      if (selectedGenres.has(genre.id)) {
        selectedGenres.delete(genre.id);
        chip.setAttribute("aria-pressed", "false");
      } else {
        selectedGenres.add(genre.id);
        chip.setAttribute("aria-pressed", "true");
      }
      updateGenreSelection();
      queueAnimeSearch();
    });
    return chip;
  });
  genreOptions.replaceChildren(...chips);
}

function updateGenreSelection() {
  const selection = document.querySelector("#genre-selection");
  const selectedNames = animeGenres.filter((genre) => selectedGenres.has(genre.id)).map((genre) => genre.name);
  selection.textContent = selectedNames.length ? selectedNames.join(", ") : "No filters selected";
}

function filterGenreOptions() {
  const query = genreSearch.value.trim().toLowerCase();
  genreOptions.querySelectorAll(".genre-chip").forEach((chip) => {
    chip.hidden = !chip.textContent.toLowerCase().includes(query);
  });
}

function makeAnimeCard(show) {
  const card = document.createElement("a");
  const title = show.title_english || show.title || "Untitled anime";
  card.className = "anime-card";
  card.href = `anime-detail.html?id=${encodeURIComponent(show.mal_id)}`;

  const coverUrl = show.images?.webp?.large_image_url
    || show.images?.jpg?.large_image_url
    || show.images?.webp?.image_url
    || show.images?.jpg?.image_url;
  if (coverUrl) {
    const cover = document.createElement("img");
    cover.src = coverUrl;
    cover.alt = `Cover for ${title}`;
    cover.loading = "lazy";
    cover.decoding = "async";
    card.append(cover);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "anime-cover-placeholder";
    placeholder.textContent = "Cover unavailable";
    card.append(placeholder);
  }

  const titleLabel = document.createElement("span");
  titleLabel.className = "anime-card-title";
  titleLabel.textContent = title;
  const metadata = document.createElement("span");
  metadata.className = "anime-card-meta";
  metadata.textContent = [show.type, show.episodes ? `${show.episodes} episodes` : "Episode count unknown"]
    .filter(Boolean)
    .join(" · ");
  card.append(titleLabel, metadata);
  return card;
}

function renderAnime(shows) {
  animeGrid.replaceChildren(...shows.map(makeAnimeCard));
}

async function fetchAniListResults(query, page, signal) {
  const selectedGenreNames = animeGenres
    .filter((genre) => selectedGenres.has(genre.id))
    .map((genre) => genre.name);
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    signal,
    body: JSON.stringify({
      query: "query ($page: Int, $search: String, $genres: [String]) { Page(page: $page, perPage: 24) { media(type: ANIME, sort: POPULARITY_DESC, search: $search, genre_in: $genres) { idMal title { english romaji } coverImage { large extraLarge } episodes format genres averageScore } } }",
      variables: {
        page,
        search: query || null,
        genres: selectedGenreNames.length ? selectedGenreNames : null
      }
    })
  });
  if (!response.ok) {
    throw new Error("AniList anime request failed");
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error("AniList anime request failed");
  }
  return (payload.data?.Page?.media || [])
    .filter((show) => show.idMal && (show.title?.english || show.title?.romaji))
    .map((show) => {
      const cover = show.coverImage?.extraLarge || show.coverImage?.large;
      return {
        mal_id: show.idMal,
        title_english: show.title.english,
        title: show.title.romaji,
        type: show.format,
        episodes: show.episodes,
        score: show.averageScore,
        genres: (show.genres || []).map((name) => ({ name })),
        images: { webp: { large_image_url: cover }, jpg: { large_image_url: cover } }
      };
    });
}

async function fetchAnimeResults(query, sequence) {
  if (activeController) {
    activeController.abort();
  }
  let controller = new AbortController();
  activeController = controller;
  let timeoutId = window.setTimeout(() => controller.abort(), 7000);
  const page = query || selectedGenres.size ? 1 : Math.floor(Math.random() * 20) + 1;
  const params = new URLSearchParams({
    limit: "24",
    order_by: "members",
    sort: "desc",
    page: String(page)
  });
  if (query) {
    params.set("q", query);
  }
  if (selectedGenres.size) {
    params.set("genres", [...selectedGenres].join(","));
  }

  try {
    let shows;
    let source = "Jikan";
    try {
      const response = await fetch(`https://api.jikan.moe/v4/anime?${params}`, { signal: controller.signal });
      if (!response.ok) {
        throw new Error("Jikan anime request failed");
      }
      const payload = await response.json();
      shows = payload.data || [];
    } catch {
      if (sequence !== requestSequence) {
        return;
      }
      window.clearTimeout(timeoutId);
      controller.abort();
      controller = new AbortController();
      activeController = controller;
      timeoutId = window.setTimeout(() => controller.abort(), 7000);
      shows = await fetchAniListResults(query, page, controller.signal);
      source = "AniList";
    }

    if (!shows.length && source === "Jikan") {
      window.clearTimeout(timeoutId);
      controller.abort();
      controller = new AbortController();
      activeController = controller;
      timeoutId = window.setTimeout(() => controller.abort(), 7000);
      shows = await fetchAniListResults(query, page, controller.signal);
      source = "AniList";
    }

    if (sequence !== requestSequence) {
      return;
    }
    if (!shows.length) {
      animeGrid.replaceChildren();
      animeStatus.hidden = false;
      animeStatus.textContent = "No online anime matched those filters.";
      return;
    }
    renderAnime(shows);
    animeStatus.hidden = source !== "AniList";
    if (source === "AniList") {
      animeStatus.textContent = "Showing online anime picks from AniList.";
    }
  } catch {
    if (sequence !== requestSequence) {
      return;
    }
    animeGrid.replaceChildren();
    animeStatus.hidden = false;
    animeStatus.textContent = "Online anime couldn't load. Check your connection and try again.";
  } finally {
    window.clearTimeout(timeoutId);
    if (activeController === controller) {
      activeController = null;
    }
  }
}

function loadAnime() {
  const sequence = ++requestSequence;
  const query = animeSearch.value.trim();
  animeStatus.hidden = false;
  animeStatus.textContent = "Loading anime...";
  fetchAnimeResults(query, sequence);
}

function queueAnimeSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(loadAnime, 350);
}

document.querySelector("#anime-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  window.clearTimeout(searchTimer);
  loadAnime();
});

document.querySelector("#genre-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const firstVisible = [...genreOptions.querySelectorAll(".genre-chip")].find((chip) => !chip.hidden);
  if (firstVisible && genreSearch.value.trim() && !selectedGenres.has(Number(firstVisible.dataset.genreId))) {
    firstVisible.click();
  }
});

animeSearch.addEventListener("input", queueAnimeSearch);
genreSearch.addEventListener("input", filterGenreOptions);
document.querySelector("#shuffle-anime").addEventListener("click", loadAnime);

renderGenreOptions();
window.MamAuth.getUser().then(({ data }) => {
  if (!data.user) {
    window.location.replace("index.html");
    return;
  }
  loadAnime();
});