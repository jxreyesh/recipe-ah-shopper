/**
 * RecipePlanner v2 — app.js
 * Multi-recipe shopping list builder using Forkify API (free, no key, CORS-enabled)
 * Forkify has thousands of recipes from BBC Good Food, Bon Appétit, Epicurious, etc.
 *
 * Flow:
 *   Search → recipe cards → click card → detail modal
 *   → adjust servings + deselect ingredients → "Add to Shopping List"
 *   → cart accumulates multiple recipes → merged ingredient list
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   CONSTANTS & SUPABASE INIT
   ══════════════════════════════════════════════════════════ */

const API = 'https://forkify-api.herokuapp.com/api/v2';
const _SUPABASE_URL = 'https://sridrvmywaeatarzfqmx.supabase.co';
const _SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyaWRydm15d2FlYXRhcnpmcW14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5ODkwMjAsImV4cCI6MjA5MTU2NTAyMH0.0iLlZj9EzGq7rrgXFnr220BlvCBzCTzum2Ohz8Cy7VA';

// Create Supabase client from CDN global
const appDb = window.supabase ? window.supabase.createClient(_SUPABASE_URL, _SUPABASE_KEY) : null;

// Quick-search shortcuts shown as pills (Forkify has no category filter endpoint)
const CATEGORIES = [
  { name: 'Meat' },
  { name: 'Fish' },
  { name: 'Vegetarian' },
  { name: 'Vegan' },
  { name: 'Breakfast' },
  { name: 'Lunch' },
];


/* ══════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════

   Forkify recipe shapes:
   Summary (from search): { id, title, publisher, image_url }
   Full (from lookup):    above + { ingredients[], servings, cooking_time, source_url }

   CartEntry = {
     id          : string,
     recipe      : FullRecipe,
     servings    : number,
     ingredients : CartIngredient[]
   }
   CartIngredient = {
     description   : string,         // ingredient name/description
     baseQuantity  : number|null,    // original quantity
     unit          : string,         // 'g', 'tbsp', '' etc.
     scaledQty     : number|null,    // scaled quantity
     included      : boolean
   }
   ══════════════════════════════════════════════════════════ */

const state = {
  cart: [],    // CartEntry[]
  activeCategory: null,  // currently active quick-search pill
  modalState: null,  // active modal state
  loading: false,
  user: null,  // current logged-in user object
};

let authMode = 'login'; // 'login' or 'signup'

// Global for tracking active modal tab
let activeModalTab = 'ingredients';

/* ══════════════════════════════════════════════════════════
   DOM REFS
   ══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

const screenSearch = $('screen-search');
const screenCart = $('screen-cart');
const searchInput = $('search-input');
const searchBtn = $('search-btn');
const categoryPillsEl = $('category-pills');
const resultsArea = $('results-area');
const heroMsg = $('hero-msg');

const cartFab = $('cart-fab');
const fabBadge = $('fab-badge');
const cartScreenSub = $('cart-screen-sub');
const tabBadgeRecipes = $('tab-badge-recipes');
const tabBadgeItems = $('tab-badge-items');
const addMoreBtn = $('add-more-btn');
const tabBtnOverview = $('tab-btn-overview');
const tabBtnIngredients = $('tab-btn-ingredients');
const tabOverview = $('tab-overview');
const tabIngredients = $('tab-ingredients');
const cartRecipeList = $('cart-recipe-list');
const ingredientList = $('ingredient-list');
const ingredientCountEl = $('ingredient-count');
const copyBtn = $('copy-btn');
const printBtn = $('print-btn');
const clearBtn = $('clear-btn');
const estimateAhBtn = $('estimate-ah-btn');
const ahTotalCostContainer = $('ah-total-cost-container');
const ahTotalCostEl = $('ah-total-cost');

const modalOverlay = $('modal-overlay');
const modalCloseBtn = $('modal-close');
const modalImg = $('modal-img');
const modalTitleEl = $('modal-title');
const modalTagsEl = $('modal-tags');
const modalServingsInput = $('modal-servings');
const modalDecBtn = $('modal-dec');
const modalIncBtn = $('modal-inc');
const modalIngredientList = $('modal-ingredient-list');
const modalSelectedCount = $('modal-selected-count');
const modalInstructionsCard = $('modal-instructions-card');
const modalTabIng = $('modal-tab-ing');
const modalTabIns = $('modal-tab-ins');
const modalIngContent = $('modal-ing-content');
const modalInsContent = $('modal-ins-content');
const addToCartBtn = $('add-to-cart-btn');
const checkAllBtn = $('check-all-btn');
const uncheckAllBtn = $('uncheck-all-btn');

const toastEl = $('toast');

/* Auth UI */
const headerLoginBtn = $('header-login-btn');
const headerProfileMenu = $('header-profile-menu');
const headerUserEmail = $('header-user-email');
const headerLogoutBtn = $('header-logout-btn');

const authModalOverlay = $('auth-modal-overlay');
const authModalClose = $('auth-modal-close');
const authForm = $('auth-form');
const authEmail = $('auth-email');
const authPassword = $('auth-password');
const authSubmitBtn = $('auth-submit-btn');
const authError = $('auth-error');
const authToggleMode = $('auth-toggle-mode');
const authModalTitle = $('auth-modal-title');
const authModalSubtitle = $('auth-modal-subtitle');
const authToggleText = $('auth-toggle-text');

/* ══════════════════════════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════════════════════════ */

const capitalise = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

function uniqueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Parse a fraction string like "1 1/2", "½", "0.5" into a number. */
function parseFraction(str) {
  const UNICODE = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
  let s = str.trim();
  for (const [ch, val] of Object.entries(UNICODE)) s = s.replace(ch, ` ${val} `);
  const parts = s.trim().split(/\s+/);
  let total = 0;
  for (const part of parts) {
    if (part.includes('/')) {
      const [n, d] = part.split('/').map(Number);
      if (!isNaN(n) && !isNaN(d) && d !== 0) total += n / d;
    } else {
      const n = parseFloat(part);
      if (!isNaN(n)) total += n;
    }
  }
  return total > 0 ? total : NaN;
}

/** Format a number nicely: integers stay whole, decimals are trimmed. */
function fmt(n) {
  if (n === Math.round(n)) return String(Math.round(n));
  return parseFloat(n.toFixed(2)).toString();
}

/** Scale a quantity by servings factor. Returns null if no quantity. */
function scaleQty(baseQty, factor) {
  if (baseQty === null || baseQty === undefined) return null;
  return parseFloat((baseQty * factor).toFixed(3));
}

/** Format a recipe's ingredient measure string for display. */
function fmtIngredient(ing, qty = ing.baseQuantity) {
  const parts = [];
  if (qty !== null && qty !== undefined) parts.push(fmt(qty));
  if (ing.unit) parts.push(ing.unit);
  if (ing.description) parts.push(ing.description);
  return parts.join(' ') || 'to taste';
}

let toastTimer;
function showToast(msg, ms = 2800) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ══════════════════════════════════════════════════════════
   RELEVANCE SCORING
   ══════════════════════════════════════════════════════════
   Forkify's search is broad (matches any word), so we re-rank
   results client-side by how closely the title matches the query.

   Scoring (0–100):
   +60  exact phrase match in title ("mango sticky rice" found as-is)
   +10  per query word found in title (max +30 for 3-word query)
   Ties broken alphabetically.

   Categories:
     score ≥ 60  → "Exact Match"
     score ≥ 10  → regular result (all query words or most)
     score = 0   → weakly related, collapsed by default
   ══════════════════════════════════════════════════════════ */

/**
 * Splits a query into meaningful words (skip stopwords < 3 chars).
 */
const STOPWORDS = new Set(['and', 'the', 'with', 'for', 'from', 'of', 'in', 'a', 'an', 'to']);
function queryWords(q) {
  const words = q.toLowerCase().trim().split(/[\s,.\-/_]+/).filter(w => w.length > 0);
  // Only filter stopwords if we have a multi-word query
  if (words.length > 1) {
    return words.filter(w => !STOPWORDS.has(w) || w.length > 2);
  }
  return words;
}

/**
 * Returns a relevance score 0–100 for a recipe given a query.
 */
function scoreRelevance(recipe, words, rawQuery) {
  const title = (recipe.title || '').toLowerCase();
  const raw = rawQuery.toLowerCase().trim();

  if (!words.length) return 0;

  let score = 0;
  let matches = 0;

  // 1. Exact phrase match: highest bonus
  if (title.includes(raw)) score += 60;

  // 2. Per-word matches
  for (const w of words) {
    if (title.includes(w)) {
      score += 15;
      matches++;
    }
  }

  // 3. ALL words present bonus (Total recall)
  // If a recipe has all the words user looked for, it's a "Best Match"
  if (matches >= words.length) {
    score += 40;
  }

  // 4. Brevity bonus: shorther titles that match are usually more relevant
  // e.g. "Mango Rice" is better than "Salmon with Mango Rice" for query "Mango Rice"
  const titleWords = title.split(/\s+/).length;
  const brevityRatio = Math.max(0, 1 - (titleWords - words.length) / 10);
  score += brevityRatio * 10;

  return Math.min(100, Math.round(score));
}

/**
 * Sorts recipes by relevance descending.
 * Returns array of { recipe, score, label } where label is 'exact' | 'good' | 'weak'.
 */
function rankRecipes(recipes, rawQuery) {
  if (!rawQuery || !rawQuery.trim()) {
    return recipes.map(r => ({ recipe: r, score: 0, label: 'good' }));
  }
  const words = queryWords(rawQuery);
  console.log(`[Relevance] Scoring ${recipes.length} recipes for:`, words);

  return recipes
    .map(r => {
      const score = scoreRelevance(r, words, rawQuery);
      // "Exact" label if score is high (contains all words or exact phrase)
      const label = score >= 75 ? 'exact'
        : score >= 15 ? 'good'
          : 'weak';
      return { recipe: r, score, label };
    })
    .sort((a, b) => b.score - a.score || (a.recipe.title || '').localeCompare(b.recipe.title || ''));
}

/* ══════════════════════════════════════════════════════════
   API CALLS — Forkify
   ══════════════════════════════════════════════════════════ */

async function apiSearch(query) {
  const r = await fetch(`${API}/recipes?search=${encodeURIComponent(query)}`);
  const d = await r.json();
  return d?.data?.recipes || [];
}

async function apiGetRecipe(id) {
  const r = await fetch(`${API}/recipes/${id}`);
  const d = await r.json();
  return d?.data?.recipe || null;
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════════════════ */

function showScreen(name) {
  screenSearch.classList.toggle('active', name === 'search');
  screenCart.classList.toggle('active', name === 'cart');
  if (name === 'cart') renderCart();
}

function setCartTab(tab) {
  tabBtnOverview.classList.toggle('active', tab === 'overview');
  tabBtnIngredients.classList.toggle('active', tab === 'ingredients');
  tabBtnOverview.setAttribute('aria-selected', String(tab === 'overview'));
  tabBtnIngredients.setAttribute('aria-selected', String(tab === 'ingredients'));
  tabOverview.classList.toggle('active', tab === 'overview');
  tabIngredients.classList.toggle('active', tab === 'ingredients');
  if (tab === 'ingredients') renderIngredientList();
}

/* ══════════════════════════════════════════════════════════
   SEARCH & BROWSE
   ══════════════════════════════════════════════════════════ */

function renderCategoryPills() {
  categoryPillsEl.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-pill';
    btn.dataset.name = cat.name;
    btn.setAttribute('aria-label', `Search ${cat.name} recipes`);
    btn.innerHTML = `${cat.name}`;
    btn.addEventListener('click', () => onCategoryClick(cat.name, btn));
    categoryPillsEl.appendChild(btn);
  });
}

async function onCategoryClick(name, btn) {
  if (state.loading) return;

  const alreadyActive = btn.classList.contains('active');
  document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));

  if (alreadyActive) {
    state.activeCategory = null;
    searchInput.value = '';
    resetToHero();
    return;
  }

  state.activeCategory = name;
  btn.classList.add('active');
  searchInput.value = name; // reflect in search box

  await loadResults(() => apiSearch(name), `Results for "${name}"`, name);
}

async function onSearch() {
  const q = searchInput.value.trim();
  if (!q) return;

  // Clear category selection
  state.activeCategory = null;
  document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));

  await loadResults(() => apiSearch(q), `Results for "${q}"`, q);
}

async function loadResults(fetchFn, subtitle, rawQuery = '') {
  if (state.loading) return;
  state.loading = true;

  resultsArea.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Fetching recipes…</p>
    </div>`;

  try {
    const recipes = await fetchFn();

    if (!recipes.length) {
      resultsArea.innerHTML = `
        <div class="no-results">
          <span>😕</span>
          <p>No recipes found. Try a different search term.</p>
        </div>`;
    } else {
      renderSearchResults(recipes, subtitle, rawQuery);
    }
  } catch (err) {
    resultsArea.innerHTML = `
      <div class="no-results">
        <span>⚠️</span>
        <p>Failed to load recipes. Check your connection and try again.</p>
        <small>${err.message}</small>
      </div>`;
  } finally {
    state.loading = false;
  }
}

function renderSearchResults(recipes, subtitle, rawQuery = '') {
  const ranked = rankRecipes(recipes, rawQuery);
  const exact = ranked.filter(r => r.label === 'exact');
  const strong = ranked.filter(r => r.label === 'good');
  const weak = ranked.filter(r => r.label === 'weak');

  const mainResults = [...exact, ...strong];
  const showCount = mainResults.length || recipes.length;

  resultsArea.innerHTML = `
    <div class="results-header">
      <span class="results-count">${showCount} recipe${showCount !== 1 ? 's' : ''} found</span>
      <span class="results-subtitle">${subtitle || ''}</span>
    </div>

    ${exact.length ? `
      <div class="results-section-label">⭐ Top Matches</div>
      <div class="recipe-grid best-matches-grid" id="exact-grid"></div>
    ` : ''}

    ${strong.length || (!exact.length && !weak.length) ? `
      ${exact.length ? `<div class="results-section-label" style="margin-top:2rem">Other Matches</div>` : ''}
      <div class="recipe-grid" id="main-grid"></div>
    ` : ''}

    ${weak.length ? `
      <div class="weak-results-wrap" id="weak-results-wrap" hidden>
        <div class="recipe-grid" id="weak-grid"></div>
      </div>
      <div class="show-more-row" id="show-more-row">
        <button class="btn btn-ghost" id="show-weak-btn">Show ${weak.length} loosely related result${weak.length !== 1 ? 's' : ''} ▾</button>
      </div>
    ` : ''}`;

  // Populate grids
  if (exact.length) {
    const g = document.getElementById('exact-grid');
    exact.forEach(r => g.appendChild(buildRecipeCard(r.recipe, true)));
  }

  if (strong.length || (!exact.length && !weak.length)) {
    const g = document.getElementById('main-grid');
    const toShow = strong.length ? strong : ranked;
    toShow.forEach(r => g.appendChild(buildRecipeCard(r.recipe, false)));
  }

  if (weak.length) {
    const g = document.getElementById('weak-grid');
    weak.forEach(r => g.appendChild(buildRecipeCard(r.recipe, false)));

    document.getElementById('show-weak-btn')?.addEventListener('click', function () {
      document.getElementById('weak-results-wrap').hidden = false;
      document.getElementById('show-more-row').style.display = 'none';
    });
  }
}

function buildRecipeCard(recipe, isBestMatch = false) {
  const inCart = state.cart.some(e => e.recipe.id === recipe.id);
  const title = recipe.title || 'Untitled';
  const img = recipe.image_url || '';
  const pub = recipe.publisher || '';

  const card = document.createElement('div');
  card.className = `recipe-card${inCart ? ' in-cart' : ''}${isBestMatch ? ' best-match' : ''}`;
  card.dataset.id = recipe.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Open ${title}`);
  card.innerHTML = `
    <div class="card-img-wrap">
      <img src="${img}" alt="${title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'175\'><rect fill=\'%23252830\'/><text x=\'50%\' y=\'50%\' font-size=\'40\' text-anchor=\'middle\' dominant-baseline=\'middle\'>🍽️</text></svg>'" />
      <div class="card-img-overlay"></div>
      ${isBestMatch ? `<span class="best-match-badge">⭐ Best Match</span>` : ''}
      ${pub ? `<span class="card-area-tag">${pub}</span>` : ''}
      ${inCart ? `<span class="in-cart-indicator">✓ In List</span>` : ''}
    </div>
    <div class="card-body">
      <h3 class="card-title">${title} ${/\b(vegan|vegetarian)\b/i.test(title) ? '<span title="Vegan/Vegetarian">🌿</span>' : ''}</h3>
    </div>
    <div class="card-action">
      <span class="card-action-text">${inCart ? '✓ Already in list — tap to edit' : '+ Add to list'}</span>
    </div>`;

  const open = () => openModal(recipe);
  card.addEventListener('click', open);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  return card;
}

async function resetToHero() {
  resultsArea.innerHTML = '';
  heroMsg.classList.remove('hidden');
  resultsArea.appendChild(heroMsg);
  await loadFeaturedRecipes();
}

async function loadFeaturedRecipes() {
  // Fetch a small set of popular recipes to show on the home page
  const FEATURED_QUERIES = ['pasta', 'chicken', 'salad'];
  try {
    const results = await Promise.all(
      FEATURED_QUERIES.map(q => apiSearch(q))
    );
    // Take the top-scored result from each query
    const featured = results.map(list => {
      if (!list.length) return null;
      const ranked = rankRecipes(list, list[0]?.title || '');
      return (ranked.find(r => r.label === 'exact') || ranked[0])?.recipe || null;
    }).filter(Boolean);

    if (!featured.length) return;

    const section = document.createElement('div');
    section.className = 'featured-section';
    section.innerHTML = `
      <div class="results-section-label" style="margin-top: 1.5rem;">✨ Popular right now</div>
      <div class="recipe-grid" id="featured-grid"></div>
    `;
    resultsArea.appendChild(section);

    const grid = section.querySelector('#featured-grid');
    featured.forEach(r => grid.appendChild(buildRecipeCard(r, false)));
  } catch (e) {
    // Silently fail — don't block the home page
  }
}

/** Refresh the "In List" badges on currently visible recipe cards. */
function refreshCardIndicators() {
  document.querySelectorAll('.recipe-card').forEach(card => {
    const inCart = state.cart.some(e => e.recipe.id === card.dataset.id);
    const imgWrap = card.querySelector('.card-img-wrap');
    const badge = card.querySelector('.in-cart-indicator');
    const actionTx = card.querySelector('.card-action-text');

    card.classList.toggle('in-cart', inCart);
    if (inCart && !badge) {
      const s = document.createElement('span');
      s.className = 'in-cart-indicator';
      s.textContent = '✓ In List';
      imgWrap.appendChild(s);
    } else if (!inCart && badge) {
      badge.remove();
    }
    if (actionTx) {
      actionTx.textContent = inCart ? '✓ Already in list — tap to edit' : '+ Add to list';
    }
  });
}

/* ══════════════════════════════════════════════════════════
   MODAL — Recipe Detail
   ══════════════════════════════════════════════════════════ */

async function openModal(recipe) {
  // Open overlay immediately with placeholder
  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Reset modal tab to ingredients when opening new
  setModalTab('ingredients');

  const loadingTitle = recipe.title || 'Loading…';
  modalTitleEl.innerHTML = loadingTitle + (/\b(vegan|vegetarian)\b/i.test(loadingTitle) ? ' <span title="Vegan/Vegetarian">🌿</span>' : '');
  modalImg.src = recipe.image_url || '';
  modalImg.alt = recipe.title || '';
  modalTagsEl.innerHTML = '';
  modalIngredientList.innerHTML =
    '<li style="padding:2.5rem;color:var(--text-muted);text-align:center"><div class="spinner" style="margin:0 auto 1rem"></div>Loading ingredients…</li>';
  modalInstructionsCard.innerHTML = '';

  // Always fetch full recipe details (search results are summaries)
  let fullRecipe = recipe;
  if (!recipe.ingredients) {
    try {
      fullRecipe = await apiGetRecipe(recipe.id);
      if (!fullRecipe) throw new Error('Recipe not found');
    } catch (err) {
      showToast(`⚠️ Could not load recipe: ${err.message}`);
      closeModal();
      return;
    }
  }

  // Check if already in cart (for editing)
  const existingEntry = state.cart.find(e => e.recipe.id === fullRecipe.id);
  const baseServings = fullRecipe.servings || 4;
  const initServings = existingEntry ? existingEntry.servings : baseServings;
  const factor = initServings / baseServings;

  state.modalState = {
    recipe: fullRecipe,
    baseServings: baseServings,
    servings: initServings,
    cartEntryId: existingEntry ? existingEntry.id : null,
    ingredients: (fullRecipe.ingredients || []).map((ing, idx) => ({
      description: ing.description || '',
      unit: ing.unit || '',
      baseQuantity: ing.quantity ?? null,
      scaledQty: ing.quantity != null ? scaleQty(ing.quantity, factor) : null,
      included: existingEntry ? (existingEntry.ingredients[idx]?.included ?? true) : true,
    })),
  };

  renderModalFull();
}

function renderModalFull() {
  const { recipe, servings, cartEntryId, ingredients } = state.modalState;
  const isEditing = Boolean(cartEntryId);

  // Image & title
  modalImg.src = recipe.image_url || '';
  modalImg.alt = recipe.title || '';
  const recipeTitle = recipe.title || '';
  modalTitleEl.innerHTML = recipeTitle + (/\b(vegan|vegetarian)\b/i.test(recipeTitle) ? ' <span title="Vegan/Vegetarian">🌿</span>' : '');

  // Tags
  modalTagsEl.innerHTML = [
    recipe.publisher ? `<span class="modal-tag">${recipe.publisher}</span>` : '',
    recipe.cooking_time ? `<span class="modal-tag">⏱ ${recipe.cooking_time} min</span>` : '',
  ].join('');

  // Servings
  modalServingsInput.value = servings;

  // Render active tab content
  if (activeModalTab === 'ingredients') {
    renderModalIngredients();
  } else {
    renderModalInstructions();
  }

  // Button label
  addToCartBtn.innerHTML = isEditing
    ? '<span>🔄</span> Update Shopping List'
    : '<span>🛒</span> Add to Shopping List';
}

function renderModalInstructions() {
  const { recipe } = state.modalState;

  modalInstructionsCard.innerHTML = `
    <div class="ins-card-content">
      <span class="ins-card-publisher">${recipe.publisher || 'Recipe Source'}</span>
      <h3 class="ins-card-title">${recipe.title} ${/\b(vegan|vegetarian)\b/i.test(recipe.title || '') ? '<span title="Vegan/Vegetarian">🌿</span>' : ''}</h3>
      <p class="ins-card-text">
        This recipe was published by <strong>${recipe.publisher}</strong>. 
        The full step-by-step instructions and cooking tips are available on their website.
      </p>
      <a href="${recipe.source_url}" target="_blank" rel="noopener" class="btn btn-primary btn-lg">
        🍳 View Full Instructions ↗
      </a>
    </div>
  `;
}

function setModalTab(tab) {
  activeModalTab = tab;

  modalTabIng.classList.toggle('active', tab === 'ingredients');
  modalTabIns.classList.toggle('active', tab === 'instructions');
  modalTabIng.setAttribute('aria-selected', String(tab === 'ingredients'));
  modalTabIns.setAttribute('aria-selected', String(tab === 'instructions'));

  modalIngContent.classList.toggle('active', tab === 'ingredients');
  modalInsContent.classList.toggle('active', tab === 'instructions');

  if (state.modalState) {
    if (tab === 'ingredients') renderModalIngredients();
    else renderModalInstructions();
  }
}

function renderModalIngredients() {
  const { ingredients } = state.modalState;
  const includedCount = ingredients.filter(i => i.included).length;

  modalSelectedCount.textContent = `${includedCount} / ${ingredients.length} selected`;
  modalIngredientList.innerHTML = '';

  ingredients.forEach((ing, idx) => {
    const display = fmtIngredient(ing, ing.scaledQty);
    const li = document.createElement('li');
    li.className = `modal-ingredient-item${ing.included ? '' : ' excluded'}`;
    li.setAttribute('role', 'checkbox');
    li.setAttribute('aria-checked', String(ing.included));
    li.setAttribute('aria-label', `${ing.description}: ${display}`);
    li.innerHTML = `
      <div class="modal-ingredient-check ${ing.included ? 'checked' : ''}">
        <span class="check-icon">${ing.included ? '✓' : ''}</span>
      </div>
      <span class="modal-ingredient-name">${capitalise(ing.description)}</span>
      <span class="modal-ingredient-measure">${display}</span>`;
    li.addEventListener('click', () => toggleModalIngredient(idx));
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggleModalIngredient(idx); });
    modalIngredientList.appendChild(li);
  });
}

function toggleModalIngredient(idx) {
  state.modalState.ingredients[idx].included ^= 1;
  renderModalIngredients();
}

function setModalServings(val) {
  const v = Math.max(1, Math.min(50, val));
  state.modalState.servings = v;
  modalServingsInput.value = v;
  const factor = v / state.modalState.baseServings;
  state.modalState.ingredients.forEach(ing => {
    ing.scaledQty = ing.baseQuantity != null ? scaleQty(ing.baseQuantity, factor) : null;
  });
  renderModalIngredients();
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
  state.modalState = null;
}

/* ══════════════════════════════════════════════════════════
   CART — Add / Remove / Update
   ══════════════════════════════════════════════════════════ */

function addToCart() {
  if (!state.modalState) return;
  const { recipe, servings, cartEntryId, ingredients } = state.modalState;

  const snapshot = ingredients.map(i => ({ ...i }));

  if (cartEntryId) {
    const entry = state.cart.find(e => e.id === cartEntryId);
    if (entry) { entry.servings = servings; entry.ingredients = snapshot; }
    showToast(`✅ Updated "${recipe.title}"`);
  } else {
    const dup = state.cart.find(e => e.recipe.id === recipe.id);
    if (dup) {
      dup.servings = servings; dup.ingredients = snapshot;
      showToast(`🔄 Updated "${recipe.title}" in your list`);
    } else {
      state.cart.push({ id: uniqueId(), recipe, servings, ingredients: snapshot });
      showToast(`✅ "${recipe.title}" added to your list!`);
      cartFab.classList.add('pulse');
      setTimeout(() => cartFab.classList.remove('pulse'), 600);
    }
  }

  closeModal();
  updateFab();
  refreshCardIndicators();
  syncCartToCloud();
}

function removeFromCart(id) {
  const entry = state.cart.find(e => e.id === id);
  state.cart = state.cart.filter(e => e.id !== id);
  updateFab();
  refreshCardIndicators();
  if (entry) showToast(`🗑️ Removed "${entry.recipe.title}"`);
  if (state.cart.length === 0) { showScreen('search'); } else { renderCart(); }
  syncCartToCloud();
}

function updateFab() {
  const n = state.cart.length;
  fabBadge.textContent = n;
  cartFab.classList.toggle('hidden', n === 0);
}

/* ══════════════════════════════════════════════════════════
   CART — Rendering
   ══════════════════════════════════════════════════════════ */

function renderCart() {
  const merged = getMergedIngredients();
  const nR = state.cart.length;
  const nI = merged.length;

  cartScreenSub.textContent = `${nR} recipe${nR !== 1 ? 's' : ''} · ${nI} ingredient${nI !== 1 ? 's' : ''}`;
  tabBadgeRecipes.textContent = nR;
  tabBadgeItems.textContent = nI;

  renderCartRecipeList();
  // Refresh ingredients tab only if it's visible
  if (tabIngredients.classList.contains('active')) renderIngredientList();
}

function renderCartRecipeList() {
  if (!state.cart.length) {
    cartRecipeList.innerHTML = `
      <div class="empty-cart">
        <span>🛒</span>
        <p>Your shopping list is empty.</p>
        <button class="btn btn-primary" id="empty-browse-btn">Browse Recipes</button>
      </div>`;
    document.getElementById('empty-browse-btn')
      ?.addEventListener('click', () => showScreen('search'));
    return;
  }

  cartRecipeList.innerHTML = '';
  state.cart.forEach(entry => {
    const includedCount = entry.ingredients.filter(i => i.included).length;
    const card = document.createElement('div');
    card.className = 'cart-recipe-card';
    card.innerHTML = `
      <img src="${entry.recipe.image_url || ''}" alt="${entry.recipe.title}" class="cart-recipe-img"
           onerror="this.src='data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'80\'><rect fill=\'%23252830\'/><text x=\'50%\' y=\'50%\' font-size=\'28\' text-anchor=\'middle\' dominant-baseline=\'middle\'>🍽️</text></svg>'" />
      <div class="cart-recipe-info">
        <h4 class="cart-recipe-name">${entry.recipe.title} ${/\b(vegan|vegetarian)\b/i.test(entry.recipe.title || '') ? '<span title="Vegan/Vegetarian">🌿</span>' : ''}</h4>
        <div class="cart-recipe-meta">
          ${entry.recipe.publisher ? `<span class="card-tag">${entry.recipe.publisher}</span>` : ''}
          ${entry.recipe.cooking_time ? `<span class="card-tag">⏱ ${entry.recipe.cooking_time} min</span>` : ''}
        </div>
        <div class="cart-recipe-pills">
          <span class="cart-pill">👥 ${entry.servings} ${entry.servings === 1 ? 'person' : 'people'}</span>
          <span class="cart-pill">🧂 ${includedCount} ingredient${includedCount !== 1 ? 's' : ''}</span>
          ${entry.recipe.source_url ? `<a href="${entry.recipe.source_url}" target="_blank" rel="noopener" class="cart-pill cart-instruction-link">🍳 How to Cook ↗</a>` : ''}
        </div>
      </div>
      <div class="cart-recipe-actions">
        <button class="btn btn-sm btn-edit"   data-id="${entry.id}" aria-label="Edit ${entry.recipe.title}">✏️ Edit</button>
        <button class="btn btn-sm btn-remove" data-id="${entry.id}" aria-label="Remove ${entry.recipe.title}">🗑️</button>
      </div>`;

    card.querySelector('.btn-edit').addEventListener('click', () => openModal(entry.recipe));
    card.querySelector('.btn-remove').addEventListener('click', () => removeFromCart(entry.id));
    cartRecipeList.appendChild(card);
  });

  // "Add another" prompt at the bottom
  const addMore = document.createElement('div');
  addMore.className = 'cart-add-another';
  addMore.innerHTML = `<button class="btn btn-ghost" id="cart-add-btn">🔍 Search for another recipe</button>`;
  addMore.querySelector('#cart-add-btn').addEventListener('click', () => showScreen('search'));
  cartRecipeList.appendChild(addMore);
}

/* ══════════════════════════════════════════════════════════
   INGREDIENT MERGE — all selected ingredients across recipes
   ══════════════════════════════════════════════════════════ */

const PREP_WORDS = new Set([
  'chopped', 'minced', 'diced', 'sliced', 'crushed', 'finely', 'fresh', 'freshly', 'peeled',
  'grated', 'halved', 'beaten', 'optional', 'divided', 'melted', 'softened', 'cooked',
  'raw', 'unsalted', 'salted', 'extra', 'virgin', 'light', 'dark', 'large', 'medium', 'small',
  'whole', 'ground', 'thinly', 'thickly', 'roughly', 'cut', 'into', 'pieces', 'chunks',
  'to', 'taste', 'garnish', 'warm', 'cold', 'hot', 'room', 'temperature',
  'can', 'cans', 'boneless', 'skinless', 'preferably', 'more', 'as', 'needed', 'plus',
  'drained', 'cubes', 'cubed', 'roasted', 'toasted', 'crumbled', 'good', 'quality'
]);

function normalizeIngredient(desc) {
  let str = (desc || '').toLowerCase().trim();
  // Strip anything after comma (e.g. "onions, chopped")
  if (str.includes(',')) str = str.substring(0, str.indexOf(','));
  // Strip anything after hyphen
  if (str.includes('-')) str = str.substring(0, str.indexOf('-'));
  // Remove parentheses
  str = str.replace(/\(.*?\)/g, '');

  // Remove prep words
  const words = str.split(/\s+/).filter(w => {
    const cleanWord = w.replace(/[^a-z]/g, '');
    return cleanWord.length > 0 && !PREP_WORDS.has(cleanWord);
  });

  return words.join(' ').trim();
}

/**
 * Returns a sorted array of merged ingredient entries:
 * [{ displayName, sources: [{ recipeName, measure }] }]
 * Ingredients with the same name (case-insensitive) are grouped.
 */
function getMergedIngredients() {
  const map = new Map();

  for (const entry of state.cart) {
    for (const ing of entry.ingredients) {
      if (!ing.included) continue;

      const key = normalizeIngredient(ing.description);
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, { displayName: capitalise(key), sources: [] });
      }

      // Keep the original description in the source measure so no information is lost
      const displayMeasure = fmtIngredient(ing, ing.scaledQty);

      map.get(key).sources.push({
        recipeName: entry.recipe.title,
        measure: displayMeasure
      });
    }
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}

function renderIngredientList() {
  const merged = getMergedIngredients();
  ingredientCountEl.textContent = `${merged.length} ingredient${merged.length !== 1 ? 's' : ''}`;

  if (!merged.length) {
    ingredientList.innerHTML = `<li class="empty-list-msg">Add recipes to see ingredients here.</li>`;
    return;
  }

  ingredientList.innerHTML = '';
  merged.forEach(({ displayName, sources }) => {
    const li = document.createElement('li');
    li.className = 'ingredient-item';
    li.setAttribute('role', 'checkbox');
    li.setAttribute('aria-checked', 'false');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', displayName);

    // Build source pills
    const sourcePills = sources.map(s =>
      `<span class="ingredient-source">${s.recipeName}: <strong>${s.measure}</strong></span>`
    ).join('');

    li.innerHTML = `
      <div class="item-check" aria-hidden="true">
        <span class="item-check-icon">✓</span>
      </div>
      <div class="ingredient-item-content">
        <span class="ingredient-name">${displayName}</span>
        <div class="ingredient-sources">${sourcePills}</div>
      </div>`;

    const toggle = () => {
      const checked = li.classList.toggle('checked');
      li.setAttribute('aria-checked', String(checked));
    };
    li.addEventListener('click', toggle);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggle(); });
    ingredientList.appendChild(li);
  });
}

/* ══════════════════════════════════════════════════════════
   AH PRICING ESTIMATION
   ══════════════════════════════════════════════════════════ */

async function onEstimateAh() {
  const merged = getMergedIngredients();
  if (!merged.length) return;

  const ingredientNames = merged.map(m => m.displayName);

  estimateAhBtn.disabled = true;
  estimateAhBtn.textContent = '⏳ Estimating...';
  showToast('Fetching prices from Albert Heijn...');

  try {
    const res = await fetch('/api/prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients: ingredientNames })
    });

    if (!res.ok) throw new Error('Failed to fetch prices');

    const data = await res.json();
    const prices = data.results || [];

    let totalCost = 0;

    // Helper to estimate how many AH packages are needed
    function calculatePacksNeeded(recipeSources, ahUnitSize) {
      if (!ahUnitSize) return 1;

      let totalRecipeQty = 0;
      let recipeUnit = '';

      for (const src of recipeSources) {
        const str = src.measure || "";
        const numMatch = str.match(/^([\d\.]+)/);
        if (numMatch) {
          totalRecipeQty += parseFloat(numMatch[1]);
          const rest = str.substring(numMatch[1].length).trim();
          const uMatch = rest.match(/^([a-zA-Z]+)/);
          if (uMatch && !recipeUnit) recipeUnit = uMatch[1].toLowerCase();
        } else {
          totalRecipeQty += 1;
        }
      }

      if (totalRecipeQty <= 0) return 1;
      if (!recipeUnit) recipeUnit = "item";

      const ahStr = ahUnitSize.replace(',', '.');
      const ahMatch = ahStr.match(/^([\d\.]+)\s*(.*)/);
      if (!ahMatch) return 1;

      const ahQty = parseFloat(ahMatch[1]);
      let ahUnit = ahMatch[2].toLowerCase().trim();
      if (ahQty <= 0) return 1;

      const normalize = u => {
        if (u.match(/^(g|gram|grams)$/)) return { t: 'w', m: 1 };
        if (u.match(/^(kg|kilo|kilogram)$/)) return { t: 'w', m: 1000 };
        if (u.match(/^(ml|milliliter)$/)) return { t: 'v', m: 1 };
        if (u.match(/^(l|liter)$/)) return { t: 'v', m: 1000 };
        if (u.match(/^(stuks|stuk|piece|pieces|whole|item|bos|plantje)$/)) return { t: 'c', m: 1 };
        return null;
      };

      const ru = normalize(recipeUnit);
      const au = normalize(ahUnit);

      if (ru && au && ru.t === au.t) {
        return Math.max(1, Math.ceil((totalRecipeQty * ru.m) / (ahQty * au.m)));
      }

      if (!ru && au && au.t === 'c') {
        return Math.max(1, Math.ceil(totalRecipeQty / ahQty));
      }

      return 1;
    }

    // Update the DOM for each ingredient to show its price
    const listItems = ingredientList.querySelectorAll('.ingredient-item');
    listItems.forEach((li, idx) => {
      const priceData = prices[idx];
      if (priceData && priceData.price > 0) {
        const itemQuantity = calculatePacksNeeded(merged[idx].sources, priceData.unit);
        const itemTotal = priceData.price * itemQuantity;
        totalCost += itemTotal;

        let resultWrap = li.querySelector('.ah-result-wrap');
        if (!resultWrap) {
          resultWrap = document.createElement('div');
          resultWrap.className = 'ah-result-wrap';
          resultWrap.style.marginLeft = 'auto';
          resultWrap.style.display = 'flex';
          resultWrap.style.alignItems = 'center';
          resultWrap.style.gap = '0.75rem';
          resultWrap.style.flexShrink = '0';

          li.querySelector('.ingredient-item-content').style.display = 'flex';
          li.querySelector('.ingredient-item-content').style.alignItems = 'center';
          li.querySelector('.ingredient-item-content').style.width = '100%';
          li.querySelector('.ingredient-item-content').appendChild(resultWrap);
        }

        resultWrap.innerHTML = '';

        if (priceData.link) {
          const btn = document.createElement('a');
          btn.href = priceData.link;
          btn.target = '_blank';
          btn.rel = 'noopener noreferrer';
          btn.style.textDecoration = 'none';
          btn.style.fontSize = '0.85rem';
          btn.style.padding = '0.3rem 0.6rem';
          btn.style.borderRadius = '6px';
          btn.style.backgroundColor = 'var(--accent-light)';
          btn.style.color = 'var(--accent)';
          btn.style.border = '1px solid rgba(6,122,70,0.25)';
          btn.style.transition = 'all 0.2s ease';
          btn.textContent = priceData.title.length > 30 ? priceData.title.substring(0, 30) + '...' : priceData.title;

          btn.onmouseover = () => { btn.style.backgroundColor = 'rgba(6,122,70,0.18)'; btn.style.color = 'var(--accent-hover)'; };
          btn.onmouseout = () => { btn.style.backgroundColor = 'var(--accent-light)'; btn.style.color = 'var(--accent)'; };

          btn.addEventListener('click', e => e.stopPropagation());

          resultWrap.appendChild(btn);
        }

        const badge = document.createElement('span');
        badge.className = 'ah-price-badge';
        badge.style.padding = '0.3rem 0.6rem';
        badge.style.borderRadius = '6px';
        badge.style.backgroundColor = 'rgba(0, 200, 100, 0.1)';
        badge.style.color = 'var(--primary)';
        badge.style.fontWeight = 'bold';
        badge.style.fontSize = '0.9rem';
        badge.style.display = 'flex';
        badge.style.alignItems = 'center';
        badge.style.gap = '0.4rem';

        badge.innerHTML = `<span style="opacity:0.6; font-size: 0.8rem; border-right: 1px solid rgba(0,200,100,0.3); padding-right: 0.4rem;">${itemQuantity}x</span> €${itemTotal.toFixed(2)}`;


        resultWrap.appendChild(badge);
      }
    });

    ahTotalCostEl.textContent = `€${totalCost.toFixed(2)}`;
    ahTotalCostContainer.classList.remove('hidden');
    ahTotalCostContainer.classList.add('pulse');
    setTimeout(() => ahTotalCostContainer.classList.remove('pulse'), 600);

    showToast('✅ Prices estimated!');
  } catch (err) {
    showToast('❌ Error estimating prices.');
    console.error(err);
  } finally {
    estimateAhBtn.disabled = false;
    estimateAhBtn.textContent = '🏷️ Estimate Costs with AH';
  }
}


/* ══════════════════════════════════════════════════════════
   COPY & PRINT
   ══════════════════════════════════════════════════════════ */

function buildClipboardText() {
  const merged = getMergedIngredients();
  const header = state.cart
    .map(e => `  • ${e.recipe.title} (${e.servings} ${e.servings === 1 ? 'person' : 'people'})`)
    .join('\n');

  let text = `🍽️  MEAL PLAN\n${'─'.repeat(42)}\n${header}\n\n`;
  text += `🛒  SHOPPING LIST  (${merged.length} items)\n${'─'.repeat(42)}\n`;
  merged.forEach(({ displayName, sources }) => {
    const amounts = sources.map(s => `${s.measure} (${s.recipeName})`).join(' + ');
    text += `• ${displayName} — ${amounts}\n`;
  });
  return text;
}

/* ══════════════════════════════════════════════════════════
   EVENT LISTENERS
   ══════════════════════════════════════════════════════════ */

// Search
searchBtn.addEventListener('click', onSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') onSearch(); });

// Cart FAB
cartFab.addEventListener('click', () => showScreen('cart'));

// Cart nav
addMoreBtn.addEventListener('click', () => showScreen('search'));
tabBtnOverview.addEventListener('click', () => setCartTab('overview'));
tabBtnIngredients.addEventListener('click', () => setCartTab('ingredients'));

// Copy / Print / Clear
estimateAhBtn.addEventListener('click', onEstimateAh);
copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(buildClipboardText())
    .then(() => showToast('✅ Copied to clipboard!'))
    .catch(() => showToast('❌ Copy failed. Try selecting all and copying manually.'));
});
printBtn.addEventListener('click', () => window.print());
clearBtn.addEventListener('click', () => {
  if (!confirm('Clear all recipes from your shopping list?')) return;
  state.cart = [];
  updateFab();
  refreshCardIndicators();
  showScreen('search');
  showToast('🗑️ Shopping list cleared');
  ahTotalCostContainer.classList.add('hidden');
  syncCartToCloud();
});

// Modal — tabs
modalTabIng.addEventListener('click', () => setModalTab('ingredients'));
modalTabIns.addEventListener('click', () => setModalTab('instructions'));

// Modal — close
modalCloseBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) closeModal();
});

// Modal — servings
modalDecBtn.addEventListener('click', () => setModalServings(state.modalState.servings - 1));
modalIncBtn.addEventListener('click', () => setModalServings(state.modalState.servings + 1));
modalServingsInput.addEventListener('change', () => {
  const v = parseInt(modalServingsInput.value, 10);
  if (!isNaN(v)) setModalServings(v);
});

// Modal — check all / none
checkAllBtn.addEventListener('click', () => {
  state.modalState.ingredients.forEach(i => i.included = true);
  renderModalIngredients();
});
uncheckAllBtn.addEventListener('click', () => {
  state.modalState.ingredients.forEach(i => i.included = false);
  renderModalIngredients();
});

// Modal — add to cart
addToCartBtn.addEventListener('click', addToCart);

/* ══════════════════════════════════════════════════════════
   SUPABASE AUTH LOGIC
   ══════════════════════════════════════════════════════════ */

if (appDb) {
  // 1. Initial Session Check
  appDb.auth.getSession().then(({ data: { session } }) => {
    handleAuthStateChange(session ? session.user : null);
  });

  // 2. Listen for Auth Changes
  appDb.auth.onAuthStateChange((_event, session) => {
    handleAuthStateChange(session ? session.user : null);
  });
}

async function handleAuthStateChange(user) {
  state.user = user;
  if (user) {
    headerLoginBtn.classList.add('hidden');
    headerProfileMenu.classList.remove('hidden');
    headerUserEmail.textContent = user.email;
    authModalOverlay.classList.add('hidden');

    // Fetch cart from cloud on login
    await fetchCartFromCloud();
  } else {
    headerProfileMenu.classList.add('hidden');
    headerLoginBtn.classList.remove('hidden');
    headerUserEmail.textContent = '';

    // Clear cart on logout
    state.cart = [];
    updateFab();
    if (!screenCart.classList.contains('hidden')) showScreen('search');
  }
}

async function fetchCartFromCloud() {
  if (!appDb || !state.user) return;
  try {
    const { data, error } = await appDb
      .from('user_carts')
      .select('cart_data')
      .eq('user_id', state.user.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 is "no rows found"

    if (data && data.cart_data) {
      state.cart = data.cart_data;
      updateFab();
      // If currently on cart screen, re-render
      if (!screenCart.classList.contains('hidden')) renderCart();
    }
  } catch (err) {
    console.error('Error fetching cart:', err);
  }
}

async function syncCartToCloud() {
  if (!appDb || !state.user) return; // Keep it local if not logged in
  try {
    const { error } = await appDb
      .from('user_carts')
      .upsert({
        user_id: state.user.id,
        cart_data: state.cart
      }, { onConflict: 'user_id' });

    if (error) throw error;
  } catch (err) {
    console.error('Error syncing cart:', err);
  }
}

function updateAuthModalUI() {
  authError.classList.add('hidden');
  if (authMode === 'login') {
    authModalTitle.textContent = 'Welcome Back';
    authModalSubtitle.textContent = 'Sign in to sync your recipes and grocery lists';
    authSubmitBtn.textContent = 'Sign In';
    authToggleText.textContent = "Don't have an account?";
    authToggleMode.textContent = 'Create one';
  } else {
    authModalTitle.textContent = 'Join RecipePlanner';
    authModalSubtitle.textContent = 'Create an account to save your favorites everywhere';
    authSubmitBtn.textContent = 'Sign Up';
    authToggleText.textContent = 'Already have an account?';
    authToggleMode.textContent = 'Sign in';
  }
}

// UI Toggle
headerLoginBtn.addEventListener('click', () => {
  authMode = 'login';
  updateAuthModalUI();
  authModalOverlay.classList.remove('hidden');
});

authModalClose.addEventListener('click', () => {
  authModalOverlay.classList.add('hidden');
});

authToggleMode.addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  updateAuthModalUI();
});

// Form Submission
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authPassword.value;

  authError.classList.add('hidden');
  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = 'Please wait...';

  try {
    if (authMode === 'signup') {
      const { error } = await appDb.auth.signUp({ email, password });
      if (error) throw error;
      showToast('✅ Account created! Check your email to verify (or sign in if disabled).');
    } else {
      const { error } = await appDb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      showToast('✅ Welcome back!');
    }
    authForm.reset();
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === 'login' ? 'Sign In' : 'Sign Up';
  }
});

// Logout
headerLogoutBtn.addEventListener('click', async () => {
  if (appDb) {
    await appDb.auth.signOut();
    showToast('👋 Signed out successfully');
  }
});

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */

(async function init() {
  renderCategoryPills();
  resultsArea.innerHTML = '';
  resultsArea.appendChild(heroMsg);
  heroMsg.classList.remove('hidden');
  await loadFeaturedRecipes();
})();
