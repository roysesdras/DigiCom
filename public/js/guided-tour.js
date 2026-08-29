/**
 * DigiCom Interactive Guided Tour Engine
 * Lightweight, zero-dependency, responsive step-by-step onboarding walkthrough
 * Pure SVG Icons - 100% Vector & Emoji-Free
 */

(function (global) {
  'use strict';

  const TOUR_STORAGE_KEY = 'digicom_tour_done_v1';

  const ICONS = {
    connections: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>`,
    filters: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`,
    search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
    chatList: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
    calls: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
    media: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`,
    close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    arrowRight: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
    arrowLeft: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
  };

  const TOUR_STEPS = [
    {
      targetId: 'btn-add-contact',
      icon: ICONS.connections,
      title: 'Connexions & Partage QR',
      description: 'Partagez votre QR Code personnel, votre lien direct ou ajoutez un ami par son @pseudo souverain.',
      placement: 'bottom'
    },
    {
      targetId: 'sidebar-tabs-row',
      icon: ICONS.filters,
      title: 'Filtres & Organisation',
      description: 'Basculez facilement entre Toutes vos discussions, vos messages Privés et vos Salons de groupe.',
      placement: 'bottom'
    },
    {
      targetId: 'search-contacts-input',
      icon: ICONS.search,
      title: 'Recherche Instantanée',
      description: 'Trouvez rapidement un contact, un salon ou un extrait de message dans tout votre historique.',
      placement: 'bottom'
    },
    {
      targetId: 'all-list-container',
      icon: ICONS.chatList,
      title: 'Répertoire des Discussions',
      description: 'Visualisez vos conversations avec l\'aperçu du dernier message, l\'heure et l\'œil d\'accusé de lecture.',
      placement: 'right'
    },
    {
      targetId: 'chat-header-bar',
      icon: ICONS.calls,
      title: 'Statut & Appels Chiffrés',
      description: 'Voyez si votre interlocuteur est en ligne et lancez des appels audio ou vidéo chiffrés de bout en bout.',
      placement: 'bottom'
    },
    {
      targetId: 'chat-input-area',
      icon: ICONS.media,
      title: 'Messages & Médias',
      description: 'Envoyez des messages instantanés, des notes vocales HD, des photos, vidéos et pièces jointes chiffrées.',
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
            <button type="button" id="btn-tour-skip" class="tour-btn-secondary">Pass</button>
            <button type="button" id="btn-tour-prev" class="tour-btn-secondary" style="display: none;">Previous</button>
            <button type="button" id="btn-tour-next" class="tour-btn-primary">Next</button>
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
        targetEl = document.getElementById('contacts-list-container') || document.querySelector('.contacts-feed');
      } else if (step.targetId === 'chat-header-bar') {
        targetEl = document.getElementById('chat-panel');
      } else if (step.targetId === 'chat-input-area') {
        targetEl = document.getElementById('chat-input-area') || document.getElementById('message-input');
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

    // Buttons
    if (prevBtn) {
      prevBtn.style.display = currentStepIndex > 0 ? 'inline-flex' : 'none';
      prevBtn.innerHTML = `<span>Previous</span>`;
    }
    if (nextBtn) {
      if (currentStepIndex === TOUR_STEPS.length - 1) {
        nextBtn.innerHTML = `<span>Finish</span>`;
      } else {
        nextBtn.innerHTML = `<span>Next</span>`;
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
      if (rect.bottom + popoverHeight + margin < window.innerHeight) {
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
        if (rect.bottom + popoverHeight + margin < window.innerHeight) {
          top = rect.bottom + margin;
          left = Math.max(16, Math.min(rect.left, window.innerWidth - popWidth - 16));
        } else {
          top = Math.max(16, rect.top - popoverHeight - margin);
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
