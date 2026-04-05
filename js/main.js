/* ============================================
   ELIMS College of Pharmacy — Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initScrollAnimations();
  initHeaderScroll();
  if (document.getElementById('lightbox')) {
    initLightbox();
  }
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
        // Only prevent default if this is a dropdown trigger (has arrow)
        const arrow = link.querySelector('.arrow');
        if (arrow) {
          e.preventDefault();
          dropdown.classList.toggle('open');
          // Close other dropdowns
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

/* --- Header Scroll Effect --- */
function initHeaderScroll() {
  const header = document.getElementById('header');
  if (!header) return;

  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 50) {
      header.style.boxShadow = '0 4px 20px rgba(27, 42, 74, 0.1)';
    } else {
      header.style.boxShadow = '0 2px 20px rgba(27, 42, 74, 0.08)';
    }

    lastScroll = currentScroll;
  }, { passive: true });
}

/* --- Scroll Animations (lightweight AOS replacement) --- */
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

/* --- Lightbox --- */
function initLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  const lightboxImg = lightbox.querySelector('.lightbox__img');
  const closeBtn = lightbox.querySelector('.lightbox__close');
  const prevBtn = lightbox.querySelector('.lightbox__nav--prev');
  const nextBtn = lightbox.querySelector('.lightbox__nav--next');

  const galleryItems = document.querySelectorAll('[data-lightbox]');
  let currentIndex = 0;
  const images = [];

  galleryItems.forEach((item, index) => {
    const src = item.getAttribute('data-lightbox') || item.querySelector('img')?.src;
    if (src) images.push(src);

    item.addEventListener('click', () => {
      currentIndex = index;
      openLightbox(images[currentIndex]);
    });
  });

  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
    lightboxImg.src = '';
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeLightbox);
  }

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
