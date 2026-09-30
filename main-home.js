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

async function loadRecommendations(carousel, preferredGenres) {
  const posterTrack = carousel.querySelector(".poster-track");
  const status = posterTrack.querySelector(".poster-status");
  const category = carousel.dataset.category;

  try {
    const response = await fetch(`https://api.jikan.moe/v4/top/${category}?limit=25`);
    if (!response.ok) {
      throw new Error("Recommendation request failed");
    }

    const responseData = await response.json();
    const recommendations = (responseData.data || [])
      .map((show) => ({
        show,
        matchingGenres: (show.genres || []).filter((genre) => preferredGenres.has(genre.name.toLowerCase())).length
      }))
      .sort((first, second) => second.matchingGenres - first.matchingGenres || (second.show.score || 0) - (first.show.score || 0))
      .filter(({ show }) => getPosterUrls(show).length > 0)
      .slice(0, 12);

    if (!recommendations.length) {
      throw new Error("No recommendations available");
    }

    const cards = recommendations.map(({ show }) => {
      const title = show.title_english || show.title;
      const posterUrls = getPosterUrls(show);
      const poster = document.createElement("img");
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

      const titleLabel = document.createElement("span");
      titleLabel.className = "poster-card-title";
      titleLabel.textContent = title;

      const description = document.createElement("p");
      description.className = "poster-card-description";
      description.textContent = show.synopsis?.replace(/\s+/g, " ").trim() || "Synopsis unavailable.";

      const card = document.createElement("a");
      card.className = "poster-card";
      card.href = show.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.append(poster, titleLabel, description);
      return card;
    });

    posterTrack.replaceChildren(...cards);
    updateCarouselControls(carousel);
  } catch {
    status.textContent = "Recommendations couldn't load. Check your connection and refresh.";
  }
}

async function loadAllRecommendations() {
  const carousels = [...document.querySelectorAll(".home-panel[data-category]")];
  carousels.forEach(setupCarouselControls);

  const { data: userData } = await window.MamAuth.getUser();
  const preferredGenres = new Set(
    (userData.user?.favoriteGenres || []).map((genre) => genre.toLowerCase())
  );

  await Promise.all(carousels.map((carousel) => loadRecommendations(carousel, preferredGenres)));
}

loadAllRecommendations();
