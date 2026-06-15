document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================================
    // State Management
    // ==========================================================================
    let releases = [];
    let filteredReleases = [];
    let selectedRelease = null;
    let currentFilter = 'all';
    let searchQuery = '';

    // ==========================================================================
    // DOM Elements
    // ==========================================================================
    const cardsContainer = document.getElementById('release-cards-container');
    const emptyState = document.getElementById('empty-state');
    const refreshBtn = document.getElementById('refresh-button');
    const refreshIcon = document.getElementById('refresh-icon');
    const spinner = document.getElementById('spinner');
    const lastUpdatedText = document.getElementById('last-updated-text');
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const resetFiltersBtn = document.getElementById('reset-filters-btn');
    
    // Filter Pills
    const filterPills = document.querySelectorAll('.pill');

    // Stats
    const statTotal = document.querySelector('#stat-total .stat-value');
    const statFeature = document.querySelector('#stat-feature .stat-value');
    const statChanged = document.querySelector('#stat-changed .stat-value');
    const statDeprecated = document.querySelector('#stat-deprecated .stat-value');

    // Modal Elements
    const tweetModal = document.getElementById('tweet-modal');
    const modalUpdatePreview = document.getElementById('modal-update-text-preview');
    const tweetTextarea = document.getElementById('tweet-textarea');
    const tweetCharCount = document.getElementById('tweet-char-count');
    const tweetWarningMsg = document.getElementById('tweet-warning-msg');
    const sendTweetBtn = document.getElementById('send-tweet-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const cancelTweetBtn = document.getElementById('cancel-tweet-btn');

    // ==========================================================================
    // Initialization
    // ==========================================================================
    init();

    function init() {
        // Fetch releases on load
        fetchReleases(false);

        // Bind events
        refreshBtn.addEventListener('click', () => fetchReleases(true));
        searchInput.addEventListener('input', handleSearchInput);
        clearSearchBtn.addEventListener('click', clearSearch);
        resetFiltersBtn.addEventListener('click', resetFilters);

        // Pill clicks
        filterPills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                filterPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                currentFilter = pill.getAttribute('data-type');
                
                // Update screen reader accessibility attribute
                filterPills.forEach(p => p.setAttribute('aria-selected', 'false'));
                pill.setAttribute('aria-selected', 'true');
                
                applyFilters();
            });
        });

        // Modal Events
        closeModalBtn.addEventListener('click', closeComposerModal);
        cancelTweetBtn.addEventListener('click', closeComposerModal);
        tweetTextarea.addEventListener('input', handleTweetTextChange);
        sendTweetBtn.addEventListener('click', publishTweet);

        // Close modal on escape key or clicking backdrop
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !tweetModal.classList.contains('hidden')) {
                closeComposerModal();
            }
        });
        
        tweetModal.addEventListener('click', (e) => {
            if (e.target === tweetModal) {
                closeComposerModal();
            }
        });
    }

    // ==========================================================================
    // API Fetch & Loader
    // ==========================================================================
    async function fetchReleases(forceRefresh = false) {
        setLoadingState(true);
        
        try {
            const url = `/api/releases${forceRefresh ? '?force_refresh=true' : ''}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            releases = data.updates || [];
            
            // Format Last Updated Text
            if (data.last_updated) {
                const date = new Date(data.last_updated * 1000);
                lastUpdatedText.textContent = `Updated: ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            } else {
                lastUpdatedText.textContent = 'Updated: Just now';
            }

            updateDashboardStats();
            applyFilters();

            if (forceRefresh) {
                showToast('Successfully refreshed latest release notes!', 'success');
            }
        } catch (error) {
            console.error('Failed to load release notes:', error);
            showToast('Failed to fetch release notes. Check your connection or retry.', 'error');
            
            // If we don't have any releases in state, render empty error container
            if (releases.length === 0) {
                cardsContainer.innerHTML = '';
                emptyState.querySelector('h3').textContent = 'Could not load release notes';
                emptyState.querySelector('p').textContent = error.message;
                emptyState.classList.remove('hidden');
            }
        } finally {
            setLoadingState(false);
        }
    }

    function setLoadingState(isLoading) {
        if (isLoading) {
            // Disable refresh button & show spinner
            refreshBtn.disabled = true;
            refreshIcon.classList.add('hidden');
            spinner.classList.remove('hidden');
            
            // Render Skeleton Cards
            renderSkeletons();
            emptyState.classList.add('hidden');
        } else {
            // Enable refresh button & hide spinner
            refreshBtn.disabled = false;
            refreshIcon.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    }

    // ==========================================================================
    // Search, Filtering & Stats
    // ==========================================================================
    let searchDebounceTimeout;
    function handleSearchInput(e) {
        searchQuery = e.target.value.toLowerCase().trim();
        
        // Show/hide clear button
        if (searchQuery.length > 0) {
            clearSearchBtn.classList.remove('hidden');
        } else {
            clearSearchBtn.classList.add('hidden');
        }

        // Debounce filter calculations for smooth input response
        clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
            applyFilters();
        }, 150);
    }

    function clearSearch() {
        searchInput.value = '';
        searchQuery = '';
        clearSearchBtn.classList.add('hidden');
        applyFilters();
        searchInput.focus();
    }

    function resetFilters() {
        searchInput.value = '';
        searchQuery = '';
        clearSearchBtn.classList.add('hidden');
        
        // Reset pills to "All"
        filterPills.forEach(p => p.classList.remove('active'));
        const allPill = document.getElementById('filter-all');
        allPill.classList.add('active');
        allPill.setAttribute('aria-selected', 'true');
        currentFilter = 'all';

        applyFilters();
    }

    function updateDashboardStats() {
        // Calculate statistics based on entire retrieved dataset
        const total = releases.length;
        const features = releases.filter(r => r.type.toLowerCase() === 'feature').length;
        const changed = releases.filter(r => r.type.toLowerCase() === 'changed').length;
        const deprecated = releases.filter(r => r.type.toLowerCase() === 'deprecated').length;

        statTotal.textContent = total;
        statFeature.textContent = features;
        statChanged.textContent = changed;
        statDeprecated.textContent = deprecated;
    }

    function applyFilters() {
        filteredReleases = releases.filter(release => {
            // Type Match
            const matchesType = (currentFilter === 'all') || 
                                (release.type.toLowerCase() === currentFilter);
            
            // Search Query Match (checks title date, type, and plain text content)
            const textMatch = release.text.toLowerCase().includes(searchQuery);
            const dateMatch = release.date.toLowerCase().includes(searchQuery);
            const typeMatch = release.type.toLowerCase().includes(searchQuery);
            
            const matchesSearch = !searchQuery || (textMatch || dateMatch || typeMatch);
            
            return matchesType && matchesSearch;
        });

        renderCards();
    }

    // ==========================================================================
    // Rendering Cards
    // ==========================================================================
    function renderSkeletons() {
        cardsContainer.innerHTML = '';
        for (let i = 0; i < 6; i++) {
            const skeleton = document.createElement('div');
            skeleton.className = 'skeleton-card';
            skeleton.innerHTML = `
                <div class="skeleton-shimmer"></div>
                <div class="skel-meta">
                    <div class="skel-date"></div>
                    <div class="skel-badge"></div>
                </div>
                <div class="skel-text-1"></div>
                <div class="skel-text-2"></div>
                <div class="skel-text-3"></div>
                <div class="skel-actions">
                    <div class="skel-btn"></div>
                    <div class="skel-btn"></div>
                </div>
            `;
            cardsContainer.appendChild(skeleton);
        }
    }

    function renderCards() {
        cardsContainer.innerHTML = '';

        if (filteredReleases.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        filteredReleases.forEach(release => {
            const card = document.createElement('article');
            card.className = 'release-card';
            card.id = `card-${release.id}`;

            const badgeClass = getBadgeClass(release.type);

            card.innerHTML = `
                <div class="card-meta">
                    <span class="card-date">${release.date}</span>
                    <span class="badge ${badgeClass}">${release.type}</span>
                </div>
                <div class="card-content">
                    ${release.html}
                </div>
                <div class="card-actions">
                    <a href="${release.link}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-card-action" aria-label="Read original release note on Google Cloud docs">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                        <span>Source</span>
                    </a>
                    <button class="btn btn-twitter btn-card-action btn-share-tweet" data-id="${release.id}">
                        <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                        <span>Tweet</span>
                    </button>
                </div>
            `;

            // Bind click handler to the Tweet share button
            const shareBtn = card.querySelector('.btn-share-tweet');
            shareBtn.addEventListener('click', () => openComposerModal(release));

            cardsContainer.appendChild(card);
        });
    }

    function getBadgeClass(type) {
        const t = type.toLowerCase();
        if (t === 'feature') return 'badge-feature';
        if (t === 'changed') return 'badge-changed';
        if (t === 'deprecated') return 'badge-deprecated';
        if (t === 'resolved') return 'badge-resolved';
        return 'badge-default';
    }

    // ==========================================================================
    // Twitter Composer Modal
    // ==========================================================================
    function openComposerModal(release) {
        selectedRelease = release;
        
        // Show update preview in modal
        modalUpdatePreview.textContent = `"${release.text}"`;
        
        // Create pre-composed tweet
        const prefix = `[BigQuery Release - ${release.date}] ${release.type}:\n`;
        const suffix = `\n\nRead more: ${release.link}`;
        
        // Math out exact limits for the custom body text
        const maxBodyLength = 280 - prefix.length - suffix.length;
        let bodyText = release.text;
        
        if (bodyText.length > maxBodyLength) {
            bodyText = bodyText.substring(0, maxBodyLength - 3) + '...';
        }
        
        const fullTweet = prefix + bodyText + suffix;
        tweetTextarea.value = fullTweet;
        
        // Perform character counting validation
        validateTweetText(fullTweet);

        // Open modal
        tweetModal.classList.remove('hidden');
        tweetModal.setAttribute('aria-hidden', 'false');
        tweetTextarea.focus();
        
        // Prevent body scrolling
        document.body.style.overflow = 'hidden';
    }

    function closeComposerModal() {
        tweetModal.classList.add('hidden');
        tweetModal.setAttribute('aria-hidden', 'true');
        selectedRelease = null;
        
        // Restore body scrolling
        document.body.style.overflow = '';
    }

    function handleTweetTextChange(e) {
        validateTweetText(e.target.value);
    }

    function validateTweetText(text) {
        const len = text.length;
        tweetCharCount.textContent = len;

        // Class toggling based on proximity to 280 limits
        tweetCharCount.className = 'char-counter';
        if (len >= 260 && len <= 280) {
            tweetCharCount.classList.add('near-limit');
        } else if (len > 280) {
            tweetCharCount.classList.add('limit-exceeded');
        }

        // Disable button & show warning if limit exceeded
        if (len > 280 || len === 0) {
            sendTweetBtn.disabled = true;
            if (len > 280) {
                tweetWarningMsg.classList.remove('hidden');
            } else {
                tweetWarningMsg.classList.add('hidden');
            }
        } else {
            sendTweetBtn.disabled = false;
            tweetWarningMsg.classList.add('hidden');
        }
    }

    function publishTweet() {
        const text = tweetTextarea.value.trim();
        if (!text || text.length > 280) return;

        const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
        
        // Open Web Intent in a new tab
        window.open(shareUrl, '_blank', 'noopener,noreferrer');
        
        closeComposerModal();
        showToast('Redirected to Twitter/X composer!', 'success');
    }

    // ==========================================================================
    // Toast Notification System
    // ==========================================================================
    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
        
        toast.innerHTML = `
            <span>${message}</span>
            <button class="toast-close" aria-label="Dismiss message">&times;</button>
        `;
        
        // Bind close button event
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => {
            toast.style.animation = 'none';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        });

        container.appendChild(toast);

        // Auto remove toast after 4 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.4s ease';
                setTimeout(() => toast.remove(), 400);
            }
        }, 4000);
    }
});
