/**
 * MAISON ÉLAN - Premium Lifestyle Shopping Mall
 * Frontend Interactive Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ==========================================
  // 1. DOM Elements Selection
  // ==========================================
  const header = document.getElementById('header');
  const menuBtn = document.getElementById('menuBtn');
  const mobileDrawer = document.getElementById('mobileDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');

  const searchOpenBtn = document.getElementById('searchOpenBtn');
  const searchModal = document.getElementById('searchModal');
  const searchOverlay = document.getElementById('searchOverlay');
  const searchCloseBtn = document.getElementById('searchCloseBtn');
  const searchInput = document.getElementById('searchInput');
  const tagButtons = document.querySelectorAll('.tag-btn');

  const cartOpenBtn = document.getElementById('cartOpenBtn');
  const cartBadge = document.getElementById('cartBadge');
  const productCartButtons = document.querySelectorAll('.product-card__cart-btn');
  const toastContainer = document.getElementById('toastContainer');

  const newsletterForm = document.getElementById('newsletterForm');
  const newsletterEmail = document.getElementById('newsletterEmail');
  const newsletterMessage = document.getElementById('newsletterMessage');
  const newsletterSubmitBtn = document.getElementById('newsletterSubmitBtn');

  const revealElements = document.querySelectorAll('.reveal');

  // State
  let cartCount = 0;

  // ==========================================
  // 2. Sticky Header Scroll Effect
  // ==========================================
  const handleScroll = () => {
    if (window.scrollY > 25) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // Initial check on load

  // ==========================================
  // 3. Mobile Navigation Drawer
  // ==========================================
  const openMobileDrawer = () => {
    mobileDrawer.classList.add('open');
    mobileDrawer.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('drawer-open');
  };

  const closeMobileDrawer = () => {
    mobileDrawer.classList.remove('open');
    mobileDrawer.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('drawer-open');
  };

  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const isOpen = mobileDrawer.classList.contains('open');
      if (isOpen) {
        closeMobileDrawer();
      } else {
        openMobileDrawer();
      }
    });
  }

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', closeMobileDrawer);
  }

  if (drawerOverlay) {
    drawerOverlay.addEventListener('click', closeMobileDrawer);
  }

  // Close mobile drawer when a nav link is clicked
  mobileNavLinks.forEach((link) => {
    link.addEventListener('click', () => {
      closeMobileDrawer();
    });
  });

  // ==========================================
  // 4. Search Modal Toggle
  // ==========================================
  const openSearchModal = () => {
    searchModal.classList.add('open');
    searchModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    setTimeout(() => {
      if (searchInput) searchInput.focus();
    }, 150);
  };

  const closeSearchModal = () => {
    searchModal.classList.remove('open');
    searchModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
  };

  if (searchOpenBtn) {
    searchOpenBtn.addEventListener('click', openSearchModal);
  }

  if (searchCloseBtn) {
    searchCloseBtn.addEventListener('click', closeSearchModal);
  }

  if (searchOverlay) {
    searchOverlay.addEventListener('click', closeSearchModal);
  }

  // Search tag buttons fill input
  tagButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = btn.textContent.trim();
        searchInput.focus();
      }
    });
  });

  // Global keydown: Escape closes open modals / drawers
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (mobileDrawer.classList.contains('open')) {
        closeMobileDrawer();
      }
      if (searchModal.classList.contains('open')) {
        closeSearchModal();
      }
    }
  });

  // ==========================================
  // 5. Toast Notification & Shopping Cart
  // ==========================================
  /**
   * Shows a sleek toast notification
   * @param {string} title
   * @param {string} subtitle
   * @param {string} [imgUrl]
   */
  const showToast = (title, subtitle, imgUrl = null) => {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');

    let imgHtml = '';
    if (imgUrl) {
      imgHtml = `<img src="${imgUrl}" alt="${title}" class="toast__thumb">`;
    }

    toast.innerHTML = `
      ${imgHtml}
      <div class="toast__body">
        <h4 class="toast__title">${title}</h4>
        <p class="toast__desc">${subtitle}</p>
      </div>
      <button class="toast__close" aria-label="알림 닫기">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    // Close button logic
    const closeBtn = toast.querySelector('.toast__close');
    const removeToast = () => {
      toast.classList.add('toast--hide');
      toast.addEventListener('animationend', () => {
        toast.remove();
      }, { once: true });
    };

    closeBtn.addEventListener('click', removeToast);

    toastContainer.appendChild(toast);

    // Auto dismiss after 3.8s
    setTimeout(() => {
      if (toast.isConnected) {
        removeToast();
      }
    }, 3800);
  };

  /**
   * Updates Cart Badge with animation
   */
  const updateCartBadge = (count) => {
    cartBadge.textContent = count;
    cartBadge.classList.remove('pulse');
    // Force reflow
    void cartBadge.offsetWidth;
    cartBadge.classList.add('pulse');
  };

  // Add to Cart Buttons
  productCartButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const productCard = btn.closest('.product-card');
      const productName = productCard ? productCard.dataset.name : '선택하신 상품';
      const productPrice = productCard ? parseInt(productCard.dataset.price, 10) : 0;
      const productImg = productCard ? productCard.dataset.img : null;

      cartCount += 1;
      updateCartBadge(cartCount);

      const formattedPrice = productPrice ? `₩ ${productPrice.toLocaleString('ko-KR')}` : '';
      showToast(
        '장바구니에 담겼습니다',
        `${productName} (${formattedPrice})`,
        productImg
      );
    });
  });

  // Cart Open Button Toast
  if (cartOpenBtn) {
    cartOpenBtn.addEventListener('click', () => {
      if (cartCount === 0) {
        showToast('장바구니가 비어 있습니다', '원하시는 아이템을 담아보세요.');
      } else {
        showToast(
          '장바구니 현황',
          `현재 ${cartCount}개의 아이템이 보관되어 있습니다.`
        );
      }
    });
  }

  // ==========================================
  // 6. Newsletter Form Validation & Handling
  // ==========================================
  const validateEmail = (email) => {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return re.test(String(email).trim().toLowerCase());
  };

  if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const emailVal = newsletterEmail.value.trim();

      // Reset message
      newsletterMessage.className = 'newsletter__message';
      newsletterMessage.textContent = '';

      if (!emailVal) {
        newsletterMessage.classList.add('error');
        newsletterMessage.textContent = '이메일 주소를 입력해 주세요.';
        newsletterEmail.focus();
        return;
      }

      if (!validateEmail(emailVal)) {
        newsletterMessage.classList.add('error');
        newsletterMessage.textContent = '올바른 이메일 형식(예: name@domain.com)으로 입력해 주세요.';
        newsletterEmail.focus();
        return;
      }

      // Success State
      newsletterSubmitBtn.disabled = true;
      newsletterSubmitBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>구독 완료</span>
      `;

      newsletterMessage.classList.add('success');
      newsletterMessage.textContent = '감사합니다. MAISON ÉLAN의 프라이빗 저널 구독이 성공적으로 완료되었습니다.';

      showToast('구독 완료', `${emailVal} 주소로 웰컴 바우처가 발송되었습니다.`);

      // Reset input
      newsletterEmail.value = '';

      setTimeout(() => {
        newsletterSubmitBtn.disabled = false;
        newsletterSubmitBtn.innerHTML = '<span>구독하기</span>';
      }, 5000);
    });
  }

  // ==========================================
  // 7. Scroll Reveal Animation (Intersection Observer)
  // ==========================================
  if ('IntersectionObserver' in window) {
    const observerOptions = {
      root: null,
      rootMargin: '0px 0px -60px 0px',
      threshold: 0.12,
    };

    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    revealElements.forEach((el) => {
      revealObserver.observe(el);
    });
  } else {
    // Fallback for older browsers
    revealElements.forEach((el) => el.classList.add('active'));
  }

  // ==========================================
  // 8. Smooth Scrolling for Internal Links
  // ==========================================
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || targetId === '#login' || targetId === '#privacy' || targetId === '#terms' || targetId === '#business') {
        if (targetId === '#login') {
          e.preventDefault();
          showToast('회원 서비스', '로그인 및 회원가입 페이지는 준비 중입니다.');
        }
        return;
      }

      const targetElem = document.querySelector(targetId);
      if (targetElem) {
        e.preventDefault();
        const headerOffset = 80;
        const elementPosition = targetElem.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth',
        });
      }
    });
  });
});
