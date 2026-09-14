/**
 * DigiCom Interactive Guided Tour Engine
 * Lightweight, zero-dependency, responsive step-by-step onboarding walkthrough
 * Pure SVG Icons - 100% Vector & Emoji-Free
 */

(function (global) {
  'use strict';

  const TOUR_STORAGE_KEY = 'digicom_tour_done_v1';

  const ICONS = {
    filters: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`,
    search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
    chatList: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
    profile: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    notifications: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
    menu: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>`,
    close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
  };

  const TOUR_STEPS = [
    {
      targetId: 'sidebar-tabs-row',
      icon: ICONS.filters,
      title: 'Filtres & Salons',
      description: 'Basculez facilement entre Toutes vos discussions, vos messages Non lus, vos Salons de groupe et vos archives.',
      placement: 'bottom'
    },
    {
      targetId: 'search-contacts-input',
      icon: ICONS.search,
      title: 'Recherche Rapide',
      description: 'Trouvez rapidement un correspondant, un salon ou un extrait de message dans tout votre historique.',
      placement: 'bottom'
    },
    {
      targetId: 'all-list-container',
      icon: ICONS.chatList,
      title: 'Discussions & Salons',
      description: 'Accédez à toutes vos discussions actives avec le dernier message, l\'heure et les accusés de lecture.',
      placement: 'top'
    },
    {
      targetId: 'btn-open-user-profile',
      icon: ICONS.profile,
      title: 'Profil & Identité',
      description: 'Touchez votre avatar ou nom en bas pour modifier votre photo de profil, nom d\'affichage et statut.',
      placement: 'top'
    },
    {
      targetId: 'btn-push-toggle',
      icon: ICONS.notifications,
      title: 'Notifications Instantanées',
      description: 'Activez la cloche en bas pour recevoir vos alertes de messages et appels même lorsque l\'application est fermée.',
      placement: 'top'
    },
    {
      targetId: 'btn-sidebar-more-menu',
      icon: ICONS.menu,
      title: 'Menu & Confidentialité',
      description: 'Accédez aux options générales : Connexions & Contacts, QR Code de partage, code PIN de secours et sécurité.',
      placement: 'top'
    }
  ];

  let currentStepIndex = 0;
  let tourActive = false;

  function createTourElements() {
    if (document.getElementById('digicom-tour-container')) return;

    const container = document.createElement('div');
    container.id = 'digicom-tour-container';
    container.className = 'digicom-tour-container';
    container.style.display = 'none';

    container.innerHTML = `
      <div id="tour-backdrop" class="tour-backdrop"></div>
      <div id="tour-spotlight" class="tour-spotlight"></div>
      <div id="tour-popover" class="tour-popover" role="dialog" aria-modal="true">
        <div class="tour-popover-header">
          <div class="tour-popover-title-row">
            <span id="tour-popover-icon" class="tour-popover-icon"></span>
            <span id="tour-popover-title" class="tour-popover-title"></span>
          </div>
          <button type="button" id="btn-tour-close" class="tour-btn-close" title="Fermer le guide" aria-label="Fermer">${ICONS.close}</button>
        </div>
        <div class="tour-popover-body">
          <p id="tour-popover-desc" class="tour-popover-desc"></p>
        </div>
        <div class="tour-popover-footer">
          <div class="tour-progress-box">
            <span id="tour-step-counter" class="tour-step-counter">1/6</span>
            <div id="tour-step-dots" class="tour-step-dots"></div>
          </div>
          <div class="tour-actions-row">
            <button type="button" id="btn-tour-skip" class="tour-btn-secondary">Passer</button>
            <button type="button" id="btn-tour-prev" class="tour-btn-secondary" style="display: none;">Précédent</button>
            <button type="button" id="btn-tour-next" class="tour-btn-primary">Suivant</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    // Event listeners
    document.getElementById('btn-tour-close').addEventListener('click', endTour);
    document.getElementById('btn-tour-skip').addEventListener('click', endTour);
    document.getElementById('btn-tour-prev').addEventListener('click', prevStep);
    document.getElementById('btn-tour-next').addEventListener('click', nextStep);

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (!tourActive) return;
      if (e.key === 'Escape') endTour();
      else if (e.key === 'ArrowRight') nextStep();
      else if (e.key === 'ArrowLeft') prevStep();
    });

    window.addEventListener('resize', () => {
      if (tourActive) updatePosition();
    });
  }

  function startTour(force = false) {
    if (!force && localStorage.getItem(TOUR_STORAGE_KEY) === 'true') {
      return;
    }

    createTourElements();
    currentStepIndex = 0;
    tourActive = true;

    const container = document.getElementById('digicom-tour-container');
    if (container) container.style.display = 'block';

    renderCurrentStep();
  }

  function renderCurrentStep() {
    if (currentStepIndex < 0) currentStepIndex = 0;
    if (currentStepIndex >= TOUR_STEPS.length) {
      endTour();
      return;
    }

    const step = TOUR_STEPS[currentStepIndex];
    let targetEl = document.getElementById(step.targetId);

    // Fallbacks if target element is hidden (e.g. mobile responsive view or feeds)
    if (!targetEl || targetEl.offsetParent === null) {
      if (step.targetId === 'all-list-container') {
        targetEl = document.querySelector('.contacts-feed:not([style*="display: none"])') || document.querySelector('.contacts-feed');
      } else if (step.targetId === 'btn-open-user-profile') {
        targetEl = document.getElementById('sidebar-bottom-bar');
      } else if (step.targetId === 'btn-push-toggle' || step.targetId === 'btn-sidebar-more-menu') {
        targetEl = document.querySelector('.header-actions') || document.getElementById('sidebar-bottom-bar');
      }
    }

    // Set icons and texts
    const iconEl = document.getElementById('tour-popover-icon');
    const titleEl = document.getElementById('tour-popover-title');
    const descEl = document.getElementById('tour-popover-desc');
    const counterEl = document.getElementById('tour-step-counter');
    const dotsContainer = document.getElementById('tour-step-dots');
    const prevBtn = document.getElementById('btn-tour-prev');
    const nextBtn = document.getElementById('btn-tour-next');

    if (iconEl) iconEl.innerHTML = step.icon || '';
    if (titleEl) titleEl.textContent = step.title;
    if (descEl) descEl.textContent = step.description;
    if (counterEl) counterEl.textContent = `${currentStepIndex + 1} / ${TOUR_STEPS.length}`;

    // Render progress dots
    if (dotsContainer) {
      dotsContainer.innerHTML = TOUR_STEPS.map((_, i) => 
        `<span class="tour-dot ${i === currentStepIndex ? 'active' : (i < currentStepIndex ? 'done' : '')}"></span>`
      ).join('');
    }

    // Buttons in French
    if (prevBtn) {
      prevBtn.style.display = currentStepIndex > 0 ? 'inline-flex' : 'none';
      prevBtn.innerHTML = `<span>Précédent</span>`;
    }
    if (nextBtn) {
      if (currentStepIndex === TOUR_STEPS.length - 1) {
        nextBtn.innerHTML = `<span>Terminer</span>`;
      } else {
        nextBtn.innerHTML = `<span>Suivant</span>`;
      }
    }

    updatePosition(targetEl, step.placement);
  }

  function updatePosition(targetEl, preferredPlacement = 'bottom') {
    const spotlight = document.getElementById('tour-spotlight');
    const popover = document.getElementById('tour-popover');
    if (!spotlight || !popover) return;

    if (!targetEl) {
      const step = TOUR_STEPS[currentStepIndex];
      targetEl = document.getElementById(step.targetId);
    }

    const padding = 8;
    let rect;

    if (targetEl && targetEl.offsetParent !== null) {
      rect = targetEl.getBoundingClientRect();
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      rect = targetEl.getBoundingClientRect();
    } else {
      rect = {
        top: window.innerHeight / 2 - 40,
        left: window.innerWidth / 2 - 40,
        width: 80,
        height: 80,
        bottom: window.innerHeight / 2 + 40,
        right: window.innerWidth / 2 + 40
      };
    }

    // Position spotlight
    spotlight.style.top = `${Math.max(0, rect.top - padding)}px`;
    spotlight.style.left = `${Math.max(0, rect.left - padding)}px`;
    spotlight.style.width = `${rect.width + padding * 2}px`;
    spotlight.style.height = `${rect.height + padding * 2}px`;

    // Position popover
    const popWidth = Math.min(340, window.innerWidth - 24);
    popover.style.width = `${popWidth}px`;

    const popoverHeight = popover.offsetHeight || 200;
    const margin = 14;

    let top = 0;
    let left = 0;

    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      left = Math.max(12, (window.innerWidth - popWidth) / 2);
      if (preferredPlacement === 'top' && rect.top - popoverHeight - margin > 0) {
        top = rect.top - popoverHeight - margin;
      } else if (rect.bottom + popoverHeight + margin < window.innerHeight) {
        top = rect.bottom + margin;
      } else if (rect.top - popoverHeight - margin > 0) {
        top = rect.top - popoverHeight - margin;
      } else {
        top = Math.max(12, window.innerHeight - popoverHeight - 20);
      }
    } else {
      if (preferredPlacement === 'bottom' && rect.bottom + popoverHeight + margin < window.innerHeight) {
        top = rect.bottom + margin;
        left = Math.max(16, Math.min(rect.left, window.innerWidth - popWidth - 16));
      } else if (preferredPlacement === 'top' && rect.top - popoverHeight - margin > 0) {
        top = rect.top - popoverHeight - margin;
        left = Math.max(16, Math.min(rect.left, window.innerWidth - popWidth - 16));
      } else if (preferredPlacement === 'right' && rect.right + popWidth + margin < window.innerWidth) {
        top = Math.max(16, Math.min(rect.top, window.innerHeight - popoverHeight - 16));
        left = rect.right + margin;
      } else {
        if (rect.top - popoverHeight - margin > 0) {
          top = rect.top - popoverHeight - margin;
          left = Math.max(16, Math.min(rect.left, window.innerWidth - popWidth - 16));
        } else {
          top = rect.bottom + margin;
          left = Math.max(16, Math.min(rect.left, window.innerWidth - popWidth - 16));
        }
      }
    }

    popover.style.top = `${Math.max(12, top)}px`;
    popover.style.left = `${Math.max(12, left)}px`;
  }

  function nextStep() {
    currentStepIndex++;
    if (currentStepIndex >= TOUR_STEPS.length) {
      endTour();
    } else {
      renderCurrentStep();
    }
  }

  function prevStep() {
    if (currentStepIndex > 0) {
      currentStepIndex--;
      renderCurrentStep();
    }
  }

  function endTour() {
    tourActive = false;
    localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    const container = document.getElementById('digicom-tour-container');
    if (container) container.style.display = 'none';
  }

  // Expose global methods
  global.DigiComTour = {
    start: (force = true) => startTour(force),
    next: nextStep,
    prev: prevStep,
    end: endTour
  };

  global.startDigiComTour = () => startTour(true);

})(window);
