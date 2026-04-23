/* ============================================
   ELIMS College of Pharmacy — Main JavaScript v2
   Immersive Redesign
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initHeaderScroll();
  initScrollAnimations();
  initCarousel();
  initCounters();
  initLightbox();
});

/* --- Mobile Navigation --- */
function initNavigation() {
  const navToggle = document.getElementById('navToggle');
  const nav = document.getElementById('nav');
  const navOverlay = document.getElementById('navOverlay');

  if (!navToggle || !nav) return;

  navToggle.addEventListener('click', () => {
    navToggle.classList.toggle('active');
    nav.classList.toggle('active');
    if (navOverlay) navOverlay.classList.toggle('active');
    document.body.style.overflow = nav.classList.contains('active') ? 'hidden' : '';
  });

  if (navOverlay) {
    navOverlay.addEventListener('click', () => {
      navToggle.classList.remove('active');
      nav.classList.remove('active');
      navOverlay.classList.remove('active');
      document.body.style.overflow = '';
    });
  }

  // Mobile dropdown toggles
  const dropdownParents = document.querySelectorAll('.nav__item');
  dropdownParents.forEach(item => {
    const link = item.querySelector('.nav__link');
    const dropdown = item.querySelector('.dropdown');
    if (!dropdown || !link) return;

    link.addEventListener('click', (e) => {
      if (window.innerWidth <= 1024) {
        const arrow = link.querySelector('.arrow');
        if (arrow) {
          e.preventDefault();
          dropdown.classList.toggle('open');
          dropdownParents.forEach(other => {
            if (other !== item) {
              const otherDropdown = other.querySelector('.dropdown');
              if (otherDropdown) otherDropdown.classList.remove('open');
            }
          });
        }
      }
    });
  });
}

/* --- Header Scroll Effect (Transparent → Solid) --- */
function initHeaderScroll() {
  const header = document.getElementById('header');
  if (!header) return;

  // Only toggle transparent/scrolled on homepage (has carousel)
  // Inner pages always keep header--scrolled set in HTML
  const heroCarousel = document.getElementById('heroCarousel');
  if (!heroCarousel) return;

  const SCROLL_THRESHOLD = 80;

  function updateHeader() {
    if (window.pageYOffset > SCROLL_THRESHOLD) {
      header.classList.add('header--scrolled');
      header.classList.remove('header--transparent');
    } else {
      header.classList.remove('header--scrolled');
      header.classList.add('header--transparent');
    }
  }

  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
}

/* --- Scroll Animations (lightweight AOS) --- */
function initScrollAnimations() {
  const elements = document.querySelectorAll('[data-aos]');
  if (!elements.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('aos-animate');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  });

  elements.forEach(el => observer.observe(el));
}

/* --- Full-Screen Hero Carousel --- */
function initCarousel() {
  const carousel = document.getElementById('heroCarousel');
  if (!carousel) return;

  const slides = carousel.querySelectorAll('.carousel__slide');
  const dots = carousel.querySelectorAll('.carousel__dot');
  const prevBtn = carousel.querySelector('.carousel__arrow--prev');
  const nextBtn = carousel.querySelector('.carousel__arrow--next');

  if (slides.length === 0) return;

  let currentIndex = 0;
  let autoPlayInterval;
  const AUTO_PLAY_DELAY = 2500;

  function goToSlide(index) {
    // Wrap around
    if (index < 0) index = slides.length - 1;
    if (index >= slides.length) index = 0;

    // Remove active from current
    slides[currentIndex].classList.remove('carousel__slide--active');
    if (dots[currentIndex]) dots[currentIndex].classList.remove('carousel__dot--active');

    // Set new active
    currentIndex = index;
    slides[currentIndex].classList.add('carousel__slide--active');
    if (dots[currentIndex]) dots[currentIndex].classList.add('carousel__dot--active');
  }

  function nextSlide() {
    goToSlide(currentIndex + 1);
  }

  function prevSlide() {
    goToSlide(currentIndex - 1);
  }

  function startAutoPlay() {
    stopAutoPlay();
    autoPlayInterval = setInterval(nextSlide, AUTO_PLAY_DELAY);
  }

  function stopAutoPlay() {
    if (autoPlayInterval) clearInterval(autoPlayInterval);
  }

  // Arrow controls
  if (nextBtn) nextBtn.addEventListener('click', () => { nextSlide(); startAutoPlay(); });
  if (prevBtn) prevBtn.addEventListener('click', () => { prevSlide(); startAutoPlay(); });

  // Dot controls
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const slideIndex = parseInt(dot.getAttribute('data-slide'), 10);
      goToSlide(slideIndex);
      startAutoPlay();
    });
  });

  // Pause on hover
  carousel.addEventListener('mouseenter', stopAutoPlay);
  carousel.addEventListener('mouseleave', startAutoPlay);

  // Touch/swipe support
  let touchStartX = 0;
  let touchEndX = 0;

  carousel.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    stopAutoPlay();
  }, { passive: true });

  carousel.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) nextSlide();
      else prevSlide();
    }
    startAutoPlay();
  }, { passive: true });

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    // Only respond if carousel is visible
    const rect = carousel.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;

    if (e.key === 'ArrowLeft') { prevSlide(); startAutoPlay(); }
    if (e.key === 'ArrowRight') { nextSlide(); startAutoPlay(); }
  });

  // Start auto-play
  startAutoPlay();
}

/* --- Animated Counters --- */
function initCounters() {
  const counters = document.querySelectorAll('.stat-item__number[data-count]');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(counter => observer.observe(counter));

  function animateCounter(el) {
    const target = parseInt(el.getAttribute('data-count'), 10);
    const duration = 2000;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue = Math.round(eased * target);
      el.textContent = currentValue;

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = target;
      }
    }

    requestAnimationFrame(update);
  }
}

/* --- Lightbox --- */
function initLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  const lightboxImg = lightbox.querySelector('.lightbox__img');
  const closeBtn = lightbox.querySelector('.lightbox__close');
  const prevBtn = lightbox.querySelector('.lightbox__nav--prev');
  const nextBtn = lightbox.querySelector('.lightbox__nav--next');

  const galleryItems = document.querySelectorAll('.gallery-item');
  let currentIndex = 0;
  const images = [];

  galleryItems.forEach((item, index) => {
    const img = item.querySelector('img');
    if (img) images.push(img.src);

    item.addEventListener('click', () => {
      currentIndex = index;
      openLightbox(images[currentIndex]);
    });
  });

  function openLightbox(src) {
    if (!src) return;
    lightboxImg.src = src;
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
    lightboxImg.src = '';
  }

  if (closeBtn) closeBtn.addEventListener('click', closeLightbox);

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentIndex = (currentIndex - 1 + images.length) % images.length;
      lightboxImg.src = images[currentIndex];
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentIndex = (currentIndex + 1) % images.length;
      lightboxImg.src = images[currentIndex];
    });
  }

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft' && prevBtn) prevBtn.click();
    if (e.key === 'ArrowRight' && nextBtn) nextBtn.click();
  });
}
