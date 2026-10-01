const mangaGenres = [
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
  { id: 37, name: "Supernatural" },
  { id: 18, name: "Mecha" },
  { id: 62, name: "Isekai" },
  { id: 40, name: "Psychological" }
];

const genreOptions = document.querySelector("#genre-options");
const genreSearch = document.querySelector("#genre-search");
const mangaSearch = document.querySelector("#manga-search");
const mangaGrid = document.querySelector("#manga-grid");
const mangaStatus = document.querySelector("#manga-status");
const selectedGenres = new Set();
let activeController = null;
let requestSequence = 0;
let searchTimer = 0;

function renderGenreOptions() {
  const chips = mangaGenres.map((genre) => {
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
      queueMangaSearch();
    });
    return chip;
  });
  genreOptions.replaceChildren(...chips);
}

function updateGenreSelection() {
  const selection = document.querySelector("#genre-selection");
  const selectedNames = mangaGenres.filter((genre) => selectedGenres.has(genre.id)).map((genre) => genre.name);
  selection.textContent = selectedNames.length ? selectedNames.join(", ") : "No filters selected";
}

function filterGenreOptions() {
  const query = genreSearch.value.trim().toLowerCase();
  genreOptions.querySelectorAll(".genre-chip").forEach((chip) => {
    chip.hidden = !chip.textContent.toLowerCase().includes(query);
  });
}

function makeMangaCard(manga) {
  const card = document.createElement("a");
  const title = manga.title_english || manga.title || manga.title_japanese || "Untitled manga";
  card.className = "manga-card";
  card.href = `manga-detail.html?id=${encodeURIComponent(manga.mal_id)}`;

  const coverUrl = manga.images?.webp?.large_image_url
    || manga.images?.jpg?.large_image_url
    || manga.images?.webp?.image_url
    || manga.images?.jpg?.image_url;
  if (coverUrl) {
    const cover = document.createElement("img");
    cover.src = coverUrl;
    cover.alt = `Cover for ${title}`;
    cover.loading = "lazy";
    cover.decoding = "async";
    card.append(cover);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "manga-cover-placeholder";
    placeholder.textContent = "Cover unavailable";
    card.append(placeholder);
  }

  const titleLabel = document.createElement("span");
  titleLabel.className = "manga-card-title";
  titleLabel.textContent = title;
  const metadata = document.createElement("span");
  metadata.className = "manga-card-meta";
  const chapterCount = Number(manga.chapters);
  const volumeCount = Number(manga.volumes);
  metadata.textContent = [
    manga.type,
    chapterCount > 0 ? `${chapterCount} ${chapterCount === 1 ? "chapter" : "chapters"}` : "Chapter count unknown",
    volumeCount > 0 ? `${volumeCount} ${volumeCount === 1 ? "volume" : "volumes"}` : null
  ].filter(Boolean).join(" · ");
  card.append(titleLabel, metadata);
  return card;
}

function renderManga(manga) {
  mangaGrid.replaceChildren(...manga.map(makeMangaCard));
}

async function fetchAniListResults(query, page, signal) {
  const selectedGenreNames = mangaGenres
    .filter((genre) => selectedGenres.has(genre.id))
    .map((genre) => genre.name);
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    signal,
    body: JSON.stringify({
      query: "query ($page: Int, $search: String, $genres: [String]) { Page(page: $page, perPage: 24) { media(type: MANGA, sort: POPULARITY_DESC, search: $search, genre_in: $genres) { idMal title { english romaji native } coverImage { large extraLarge } chapters volumes format genres averageScore } } }",
      variables: {
        page,
        search: query || null,
        genres: selectedGenreNames.length ? selectedGenreNames : null
      }
    })
  });
  if (!response.ok) {
    throw new Error("AniList Manga request failed");
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error("AniList Manga request failed");
  }
  return (payload.data?.Page?.media || [])
    .filter((manga) => manga.idMal && (manga.title?.english || manga.title?.romaji || manga.title?.native))
    .map((manga) => {
      const cover = manga.coverImage?.extraLarge || manga.coverImage?.large;
      return {
        mal_id: manga.idMal,
        title_english: manga.title?.english || "",
        title: manga.title?.romaji || manga.title?.native || "Untitled manga",
        type: manga.format || "Manga",
        chapters: manga.chapters,
        volumes: manga.volumes,
        score: manga.averageScore,
        genres: (manga.genres || []).map((name) => ({ name })),
        images: { webp: { large_image_url: cover }, jpg: { large_image_url: cover } }
      };
    });
}

async function fetchMangaResults(query, sequence) {
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
  if (query) params.set("q", query);
  if (selectedGenres.size) params.set("genres", [...selectedGenres].join(","));

  try {
    let manga;
    let source = "Jikan";
    try {
      const response = await fetch(`https://api.jikan.moe/v4/manga?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Jikan Manga request failed");
      const payload = await response.json();
      manga = payload.data || [];
    } catch {
      if (sequence !== requestSequence) return;
      window.clearTimeout(timeoutId);
      controller.abort();
      controller = new AbortController();
      activeController = controller;
      timeoutId = window.setTimeout(() => controller.abort(), 7000);
      manga = await fetchAniListResults(query, page, controller.signal);
      source = "AniList";
    }

    if (!manga.length && source === "Jikan") {
      window.clearTimeout(timeoutId);
      controller.abort();
      controller = new AbortController();
      activeController = controller;
      timeoutId = window.setTimeout(() => controller.abort(), 7000);
      manga = await fetchAniListResults(query, page, controller.signal);
      source = "AniList";
    }

    if (sequence !== requestSequence) return;
    if (!manga.length) {
      mangaGrid.replaceChildren();
      mangaStatus.hidden = false;
      mangaStatus.textContent = "No online manga matched those filters.";
      return;
    }

    renderManga(manga);
    mangaStatus.hidden = source !== "AniList";
    if (source === "AniList") mangaStatus.textContent = "Showing online manga picks from AniList.";
  } catch {
    if (sequence !== requestSequence) return;
    mangaGrid.replaceChildren();
    mangaStatus.hidden = false;
    mangaStatus.textContent = "Online manga couldn't load. Check your connection and try again.";
  } finally {
    window.clearTimeout(timeoutId);
    if (activeController === controller) activeController = null;
  }
}

function loadManga() {
  const sequence = ++requestSequence;
  mangaStatus.hidden = false;
  mangaStatus.textContent = "Loading manga...";
  fetchMangaResults(mangaSearch.value.trim(), sequence);
}

function queueMangaSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(loadManga, 350);
}

document.querySelector("#manga-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  window.clearTimeout(searchTimer);
  loadManga();
});

document.querySelector("#genre-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const firstVisible = [...genreOptions.querySelectorAll(".genre-chip")].find((chip) => !chip.hidden);
  if (firstVisible && genreSearch.value.trim() && !selectedGenres.has(Number(firstVisible.dataset.genreId))) {
    firstVisible.click();
  }
});

mangaSearch.addEventListener("input", queueMangaSearch);
genreSearch.addEventListener("input", filterGenreOptions);
document.querySelector("#shuffle-manga").addEventListener("click", loadManga);

renderGenreOptions();
window.MamAuth.getUser().then(({ data }) => {
  if (!data.user) {
    window.location.replace("index.html");
    return;
  }
  loadManga();
});