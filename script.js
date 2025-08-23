/* Extinction Escape: Simple Idle Rescue Game
 * This script implements the core mechanics of a minimal idle game
 * inspired by the Extinction Escape concept.  Players purchase rescue
 * units that automatically save animals over time, earning coins to
 * reinvest in more powerful units.  The economy and scaling follow
 * the values defined in the design document.
 */

// Define the rescue units.  Each unit has a name, base cost, base
// rescue rate (animals per minute) and a cost multiplier for scaling.
const unitDefinitions = [
  { name: 'Pickup Truck', baseCost: 50, baseRate: 1, costMultiplier: 1.15 },
  { name: 'Boat', baseCost: 250, baseRate: 4, costMultiplier: 1.15 },
  { name: 'Helicopter', baseCost: 1000, baseRate: 12, costMultiplier: 1.15 },
  { name: 'Cargo Plane', baseCost: 5000, baseRate: 30, costMultiplier: 1.15 },
  { name: 'Rescue Team', baseCost: 20000, baseRate: 75, costMultiplier: 1.15 },
  { name: 'Supply Drop Drone', baseCost: 100000, baseRate: 200, costMultiplier: 1.15 }
];

// Game state
let coins = 0;
let animalsSaved = 0;
const unitsOwned = unitDefinitions.map(() => 0);
const nextCosts = unitDefinitions.map(unit => unit.baseCost);

// Missions and safe haven definitions
const missions = [
  { name: 'Jungle Fire', duration: 120, baseRisk: 20, difficulty: 1.0, species: 'Koala' },
  { name: 'Coastal Flood', duration: 150, baseRisk: 30, difficulty: 1.1, species: 'Sea Turtle' },
  { name: 'Mountain Avalanche', duration: 90, baseRisk: 15, difficulty: 1.3, species: 'Panda' },
  { name: 'Arctic Ice Break', duration: 180, baseRisk: 25, difficulty: 1.2, species: 'Penguin' }
];

// Species definitions. Each species grants a bonus when rescued.
// effectType can be 'rate', 'time', or 'animals'.
// effectValue is applied as a percentage (e.g., 0.02 = 2%).
const speciesList = [
  { name: 'Koala', saved: false, bonus: '+2% fire rescue speed', effectType: 'time', effectValue: 0.02 },
  { name: 'Panda', saved: false, bonus: '+5% food gathering speed', effectType: 'rate', effectValue: 0.05 },
  { name: 'Sea Turtle', saved: false, bonus: '+5% boat rescue capacity', effectType: 'rate', effectValue: 0.05 },
  { name: 'Tiger', saved: false, bonus: '+10% ground rescue speed', effectType: 'rate', effectValue: 0.10 },
  { name: 'Penguin', saved: false, bonus: '+5% ice terrain speed', effectType: 'time', effectValue: 0.05 },
  { name: 'Elephant', saved: false, bonus: '+15% vehicle capacity', effectType: 'animals', effectValue: 0.15 },
  { name: 'Parrot', saved: false, bonus: '+3% fuel gathering', effectType: 'rate', effectValue: 0.03 },
  { name: 'Dolphin', saved: false, bonus: '+10% boat speed', effectType: 'rate', effectValue: 0.10 }
];

// Map species names to colors for reserve visualization
const speciesColors = {
  'Koala': '#5ec962',
  'Panda': '#4ac0ff',
  'Sea Turtle': '#2fbf71',
  'Tiger': '#ff7f51',
  'Penguin': '#6f85ff',
  'Elephant': '#b07f62',
  'Parrot': '#ffd166',
  'Dolphin': '#00d1d1'
};

// Reserve species center positions.  Each species clusters around one or more
// normalized (0–1) coordinate pairs on the canvas.  These values were chosen
// to loosely evoke different biomes (coast, jungle, savanna, etc.) and can be
// extended when new biomes are unlocked.  If a species is not present in
// this map it will default to the middle of the canvas.
const speciesCenters = {
  'Koala':    [{ x: 0.80, y: 0.65 }],           // bushland
  'Panda':    [{ x: 0.62, y: 0.30 }],           // mountains
  'Sea Turtle':[{ x: 0.25, y: 0.72 }],          // coastline
  'Tiger':    [{ x: 0.72, y: 0.42 }],           // jungle
  'Penguin':  [{ x: 0.18, y: 0.80 }],           // icy coast
  'Elephant': [{ x: 0.58, y: 0.50 }],           // savanna
  'Parrot':   [{ x: 0.70, y: 0.58 }],           // rainforest edge
  'Dolphin':  [{ x: 0.22, y: 0.68 }],           // open water
  // Additional species (e.g., from biomes) will be added in unlockBiome().
};

// Offscreen canvas for painting the landmass background in the reserve view.
let landCanvas = null;
let landCtx = null;

// Frame counter used for gentle drift animation of reserve dots.
let reserveFrame = 0;

// Reserve state: counts per species and runtime dot positions
let reserveCounts = {};
let reserveDots = {};

// ==== Leaderboard / Season Tracking ====
// Count of animals saved in the current season. A "season" spans from one prestige
// reset to the next. Each time the player prestiges, seasonAnimalsSaved is reset
// and bestSeasonTotal is updated if this season's total exceeds it.  bestSeasonTotal
// persists across sessions and is used to display the player’s highest season total.
let seasonAnimalsSaved = 0;
let bestSeasonTotal = 0;

// Unique identifier for this player. Used to generate friend codes.  If
// undefined on load, a random ID is created and stored in localStorage.
let playerId = '';

// PWA deferred install prompt.  When the browser triggers the
// beforeinstallprompt event, we store the event here so it can be used
// later when the user clicks the Install App button.  See initPWA().
let deferredPrompt = null;

// Tip jar link configured by the player.  When a non-empty link is set,
// the Support button will appear in the sanctuary actions and open this
// URL in a new tab.  The link persists in localStorage.
let tipLink = '';

/**
 * Update the season stats UI. Displays the current season total and the
 * best season total in the Sanctuary view's tools row. Called whenever
 * seasonAnimalsSaved or bestSeasonTotal changes.
 */
function updateSeasonStatsUI() {
  const seasonStatsEl = document.getElementById('season-stats');
  if (seasonStatsEl) {
    const current = Math.floor(seasonAnimalsSaved);
    const best = Math.floor(bestSeasonTotal);
    seasonStatsEl.textContent = `Season saved: ${current} (Best: ${best})`;
  }
}

// ==== Biome System ====
// Definitions for unlockable biomes. Each biome costs a certain number of permits
// and introduces new species, their bonuses, colors, optional species center positions,
// new rescue units, missions and land shapes. Additional fields can be extended in the future.
const biomeDefinitions = [
  {
    id: 'savannah',
    name: 'Savannah',
    cost: 3,
    species: [
      { name: 'Giraffe', bonus: '+8% ground rescue speed', effectType: 'rate', effectValue: 0.08 },
      { name: 'Zebra', bonus: '+5% animals per mission', effectType: 'animals', effectValue: 0.05 },
      { name: 'Rhinoceros', bonus: '-5% mission time', effectType: 'time', effectValue: 0.05 }
    ],
    speciesColors: {
      'Giraffe': '#fdd835',
      'Zebra': '#d1c4e9',
      'Rhinoceros': '#8d6e63'
    },
    // Reserve positions for species centers (currently unused in this version)
    speciesCenters: {
      'Giraffe': [ { x: 0.45, y: 0.25 } ],
      'Zebra': [ { x: 0.60, y: 0.20 } ],
      'Rhinoceros': [ { x: 0.52, y: 0.15 } ]
    },
    units: [
      { name: 'Safari Jeep', baseCost: 2000, baseRate: 15, costMultiplier: 1.15 },
      { name: 'Off-Road Truck', baseCost: 10000, baseRate: 40, costMultiplier: 1.15 }
    ]
  }
];

// Track which biomes have been unlocked
const biomesUnlocked = {};

// ==== Permits and World Events ====
// Prestige system variables. Players earn permits based on lifetime animals saved
// (1 permit per 1000 animals saved). Permits can be spent on permanent upgrades.
let permitsTotal = 0;       // total permits ever earned across all runs
let permitsAvailable = 0;   // permits not yet spent
let lifetimeAnimalsSaved = 0; // animals saved across all reserves (including current run)
// Track purchased permit upgrades by type (rate, animals, time, map)
const permitUpgrades = { rate: 0, animals: 0, time: 0, map: 0 };
// Bonuses granted by permits (computed from permitUpgrades)
let permitRateBonus = 0;
let permitAnimalBonus = 0;
let permitTimeReduction = 0;
// Permit upgrade definitions (effect values are additive percentages)
const permitUpgradeDefinitions = [
  { name: 'Rate Boost', effectType: 'rate', effectValue: 0.05, baseCost: 1, costMultiplier: 2 },
  { name: 'Animal Boost', effectType: 'animals', effectValue: 0.10, baseCost: 1, costMultiplier: 2 },
  { name: 'Time Reduction', effectType: 'time', effectValue: 0.05, baseCost: 1, costMultiplier: 2 },
  { name: 'Map Upgrade', effectType: 'map', effectValue: 0, baseCost: 1, costMultiplier: 2 }
];
// Track next cost for each permit upgrade
const permitUpgradeCosts = permitUpgradeDefinitions.map(def => def.baseCost);

// World events definitions. Each event lasts for several hours and grants temporary modifiers.
const eventsList = [
  { id: 'flood', name: 'Coastal Flood', duration: 7200, rateBonus: 0.20, animalBonus: 0.10, timeReduction: 0 },
  { id: 'wildfire', name: 'Wildfire', duration: 7200, rateBonus: 0.15, animalBonus: 0, timeReduction: 0.10 },
  { id: 'ice', name: 'Ice Melt', duration: 7200, rateBonus: 0, animalBonus: 0, timeReduction: 0.20 },
  { id: 'storm', name: 'Storm Season', duration: 7200, rateBonus: 0.10, animalBonus: 0.05, timeReduction: 0.05 }
];
// Current active event and its modifiers (set in initEvent/startNewEvent)
let activeEvent = null;
let eventRateBonus = 0;
let eventAnimalBonus = 0;
let eventTimeReduction = 0;
// Canvas references for reserve view
let reserveCanvas = null;
let reserveCtx = null;

// ==== Sanctuary (Diorama and Cards) ====
// Canvas and context for the diorama view
let dioramaCanvas = null;
let dioramaCtx = null;
// Frame counter for diorama animation
let dioramaFrame = 0;
// Positions where each species' herd will cluster in the diorama.  Each entry
// maps a species name to a normalized coordinate pair { x, y } relative to
// the canvas size.  Anchors are recomputed whenever species are added or
// unlocked so that herds are spaced evenly across the view.
let dioramaAnchors = {};
// Icon positions and drift parameters for each species in the diorama.  The
// structure is { speciesName: [ { baseX, baseY, phaseX, phaseY, ampX, ampY } ] }
// and is rebuilt whenever counts change or the canvas is resized.
let dioramaClusters = {};

// Upgrade definitions
// Each upgrade has a name, effect type (rate, animals, time) and effect value,
// as well as a base cost and cost multiplier for exponential scaling.
const upgradeDefinitions = [
  { name: 'Faster Engines', effectType: 'rate', effectValue: 0.10, baseCost: 500, costMultiplier: 1.25 },
  { name: 'Rescue Crates', effectType: 'animals', effectValue: 0.05, baseCost: 1500, costMultiplier: 1.25 },
  { name: 'GPS Tracking', effectType: 'time', effectValue: 0.05, baseCost: 5000, costMultiplier: 1.30 },
  { name: 'Animal Care Kit', effectType: 'animals', effectValue: 0.05, baseCost: 10000, costMultiplier: 1.30 },
  { name: 'Emergency Sirens', effectType: 'rate', effectValue: 0.10, baseCost: 25000, costMultiplier: 1.40 }
];

// Track how many of each upgrade has been purchased and the next cost
const upgradesOwned = upgradeDefinitions.map(() => 0);
const upgradeCosts = upgradeDefinitions.map(upg => upg.baseCost);

// Global modifiers applied by upgrades
let globalRateBonus = 0;      // sum of rate bonuses
let globalTimeReduction = 0;  // sum of time reductions (percentage)
let globalAnimalBonus = 0;    // sum of animal bonuses (percentage)

// Daily bonus tracking
let lastDailyBonusDate = null;

// ==== Achievements and Questline System ====
// Define a set of achievements. Each achievement has an id, a description,
// a check function to determine if it's complete, a reward type and reward value.
// Reward types can be 'coins', 'rate', 'time', 'animals'.
const achievements = [
  { id: 'save100', description: 'Save 100 animals', check: () => lifetimeAnimalsSaved >= 100, rewardType: 'coins', rewardValue: 100 },
  { id: 'own10Units', description: 'Own 10 rescue units', check: () => unitsOwned.reduce((a, b) => a + b, 0) >= 10, rewardType: 'rate', rewardValue: 0.02 },
  { id: 'complete5Missions', description: 'Complete 5 missions', check: () => missionsCompleted >= 5, rewardType: 'animals', rewardValue: 0.05 },
  { id: 'saveAllSpecies', description: 'Save all species', check: () => speciesList.every(sp => sp.saved), rewardType: 'time', rewardValue: 0.05 },
  { id: 'earn1Permit', description: 'Earn 1 permit', check: () => permitsTotal >= 1, rewardType: 'coins', rewardValue: 200 }
];
// Track which achievements have been completed
const achievementsCompleted = {};
// Bonus accumulators from achievements
let achievementRateBonus = 0;
let achievementTimeReduction = 0;
let achievementAnimalBonus = 0;

// Questline: "Rebuild the Reef" with ordered steps. Each step has a description,
// a check function to determine completion, a reward type and value.
const questSteps = [
  { description: 'Save 50 animals', check: () => lifetimeAnimalsSaved >= 50, rewardType: 'coins', rewardValue: 100 },
  { description: 'Own 2 Boats', check: () => unitsOwned[1] >= 2, rewardType: 'coins', rewardValue: 200 },
  { description: 'Save 5 Sea Turtles', check: () => (reserveCounts['Sea Turtle'] || 0) >= 5, rewardType: 'rate', rewardValue: 0.02 },
  { description: 'Own 1 Helicopter', check: () => unitsOwned[2] >= 1, rewardType: 'permit', rewardValue: 1 },
  { description: 'Save 100 animals', check: () => lifetimeAnimalsSaved >= 100, rewardType: 'animals', rewardValue: 0.05 }
];
// Current quest step index (0-based). If equals questSteps.length, quest is complete.
let currentQuestStep = 0;
// Track whether each quest step has been claimed
const questStepsClaimed = {};

// Onboarding tasks with simple completion checks
const tasks = [
  { id: 'save10', description: 'Save 10 animals', check: () => animalsSaved >= 10 },
  { id: 'buyPickup', description: 'Buy a Pickup Truck', check: () => unitsOwned[0] >= 1 },
  { id: 'completeMission1', description: 'Complete your first mission', check: () => missionsCompleted >= 1 }
];
const tasksCompleted = {};

// Mission runtime state
let currentMissionIndex = 0;
let missionActive = false;
let missionTimeLeft = 0;
let animalsAtRisk = 0;
let totalAnimalsForMission = 0;
let missionsCompleted = 0;

// Species bonus accumulators
let speciesRateBonus = 0;
let speciesTimeReduction = 0;
let speciesAnimalBonus = 0;

// Compute species bonuses based on saved species
function updateSpeciesBonuses() {
  speciesRateBonus = 0;
  speciesTimeReduction = 0;
  speciesAnimalBonus = 0;
  speciesList.forEach(sp => {
    if (sp.saved) {
      if (sp.effectType === 'rate') {
        speciesRateBonus += sp.effectValue;
      } else if (sp.effectType === 'time') {
        speciesTimeReduction += sp.effectValue;
      } else if (sp.effectType === 'animals') {
        speciesAnimalBonus += sp.effectValue;
      }
    }
  });
  // Cap time reduction at 0.9 to prevent negative durations
  if (speciesTimeReduction + globalTimeReduction > 0.9) {
    const excess = speciesTimeReduction + globalTimeReduction - 0.9;
    // Reduce speciesTimeReduction proportionally to fit
    speciesTimeReduction -= excess;
    if (speciesTimeReduction < 0) speciesTimeReduction = 0;
  }
}

// ----- Sanctuary (Diorama and Cards) functions -----

/**
 * Compute anchor positions for each species in the diorama.  The anchors
 * determine where herds cluster in the side-on sanctuary scene.  We space
 * herds evenly along the width of the canvas.  This function should be
 * called whenever species are added (e.g., when a biome is unlocked) or
 * when the number of species changes.  The y coordinate is fixed to
 * approximately 60% of the canvas height to place animals on the ground.
 */
function computeDioramaAnchors() {
  dioramaAnchors = {};
  // Determine the set of all species present.  Use speciesList to get the
  // canonical ordering of species (including those unlocked via biomes).
  const allSpecies = speciesList.map(sp => sp.name);
  // In case additional species exist in reserveCounts that are not in
  // speciesList (e.g., from older saves), include them as well.
  Object.keys(reserveCounts).forEach(spName => {
    if (!allSpecies.includes(spName)) {
      allSpecies.push(spName);
    }
  });
  // Compute evenly spaced x positions.  Avoid dividing by zero for
  // collections with zero species.
  const n = allSpecies.length;
  if (n === 0) return;
  const spacing = 1 / (n + 1);
  allSpecies.forEach((sp, index) => {
    const x = spacing * (index + 1);
    // Place herds near the ground (60% down the canvas)
    const y = 0.6;
    dioramaAnchors[sp] = { x: x, y: y };
  });
}

/**
 * Rebuild the diorama clusters based on current reserveCounts.  This applies
 * auto-density so that the total number of rendered icons remains within
 * performance limits.  Each species gets a number of icons proportional to
 * its animal count; if the total number of animals is large, multiple animals
 * may be represented by a single icon.  Drift parameters are assigned
 * randomly for gentle motion.
 */
function rebuildDioramaClusters() {
  dioramaClusters = {};
  if (!dioramaCanvas) return;
  // Total number of animals across species
  let total = 0;
  Object.keys(reserveCounts).forEach(sp => {
    total += reserveCounts[sp] || 0;
  });
  // Determine the density divisor to cap icons to ~500.  If total > 500,
  // compute divisor so that total/divisor <= 500; otherwise divisor = 1.
  const maxIcons = 500;
  const densityDivisor = total > maxIcons ? Math.ceil(total / maxIcons) : 1;
  // Build clusters for each species
  Object.keys(reserveCounts).forEach(species => {
    const count = reserveCounts[species] || 0;
    const nIcons = count > 0 ? Math.max(1, Math.floor(count / densityDivisor)) : 0;
    dioramaClusters[species] = [];
    if (nIcons === 0) return;
    const anchor = dioramaAnchors[species] || { x: 0.5, y: 0.6 };
    const w = dioramaCanvas.width;
    const h = dioramaCanvas.height;
    // Spread radius grows with the square root of the count to give larger
    // herds more area.  Scale relative to canvas dimensions.
    const baseR = Math.max(w, h) * 0.03;
    const growthR = Math.sqrt(count) * 0.5;
    const sigma = baseR + growthR;
    for (let i = 0; i < nIcons; i++) {
      // Base positions centered at the anchor with Gaussian jitter
      let bx = anchor.x * w + randomGaussian() * sigma;
      let by = anchor.y * h + randomGaussian() * (sigma * 0.5);
      // Clamp to the canvas area, leaving a small padding
      const pad = 6;
      bx = Math.min(w - pad, Math.max(pad, bx));
      by = Math.min(h - pad, Math.max(pad, by));
      // Drift parameters: random amplitudes and phases for x and y
      const ampX = 2 + Math.random() * 4;
      const ampY = 2 + Math.random() * 4;
      const phaseX = Math.random() * Math.PI * 2;
      const phaseY = Math.random() * Math.PI * 2;
      dioramaClusters[species].push({
        baseX: bx,
        baseY: by,
        ampX: ampX,
        ampY: ampY,
        phaseX: phaseX,
        phaseY: phaseY
      });
    }
  });
}

/**
 * Draw the scenic background for the diorama.  This includes a sky gradient,
 * simple hills and a ground plane.  Called each frame before drawing
 * animal clusters.
 */
function drawDioramaBackground() {
  if (!dioramaCtx || !dioramaCanvas) return;
  const ctx = dioramaCtx;
  const w = dioramaCanvas.width;
  const h = dioramaCanvas.height;
  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#b4e7f8');
  sky.addColorStop(1, '#9dd4ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // Draw distant hills (mountain silhouettes)
  ctx.fillStyle = '#cfe8b8';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.65);
  ctx.quadraticCurveTo(w * 0.2, h * 0.45, w * 0.4, h * 0.65);
  ctx.quadraticCurveTo(w * 0.6, h * 0.45, w, h * 0.65);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  // Midground hill
  ctx.fillStyle = '#bfe0a4';
  ctx.beginPath();
  ctx.moveTo(-w * 0.1, h * 0.7);
  ctx.quadraticCurveTo(w * 0.3, h * 0.55, w * 0.65, h * 0.68);
  ctx.quadraticCurveTo(w * 1.1, h * 0.55, w * 1.1, h * 0.7);
  ctx.lineTo(w * 1.1, h);
  ctx.lineTo(-w * 0.1, h);
  ctx.closePath();
  ctx.fill();
  // Ground plane
  ctx.fillStyle = '#f3f7fa';
  ctx.fillRect(0, h * 0.8, w, h * 0.2);
}

/**
 * Draw the diorama.  Renders the background and then animates the species
 * clusters with gentle drift.  Also draws species names and counts near
 * their anchors.  Uses requestAnimationFrame for smooth animation.
 */
function drawDiorama() {
  if (!dioramaCtx || !dioramaCanvas) return;
  const ctx = dioramaCtx;
  const w = dioramaCanvas.width;
  const h = dioramaCanvas.height;
  // Clear and draw background
  ctx.clearRect(0, 0, w, h);
  drawDioramaBackground();
  // Advance frame for drift
  dioramaFrame++;
  const t = dioramaFrame * 0.015;
  // Draw clusters for each species
  Object.keys(dioramaClusters).forEach(species => {
    const icons = dioramaClusters[species] || [];
    if (icons.length === 0) return;
    ctx.fillStyle = speciesColors[species] || '#333';
    icons.forEach(icon => {
      const x = icon.baseX + icon.ampX * Math.sin(t + icon.phaseX);
      const y = icon.baseY + icon.ampY * Math.cos(t + icon.phaseY);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    // Draw species name and count near the anchor
    const anchor = dioramaAnchors[species] || { x: 0.5, y: 0.6 };
    const ax = anchor.x * w;
    const ay = anchor.y * h;
    const count = reserveCounts[species] || 0;
    ctx.font = '12px Arial';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${species}: ${count}`, ax, ay + 10);
  });
  // Loop animation
  requestAnimationFrame(drawDiorama);
}

/**
 * Resize handler for the diorama canvas.  Adjusts the canvas size to match
 * the displayed element and rebuilds anchors and clusters accordingly.  Also
 * redraws the background immediately.
 */
function onDioramaResize() {
  if (!dioramaCanvas) return;
  const rect = dioramaCanvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  dioramaCanvas.width = w;
  dioramaCanvas.height = h;
  // Recompute anchors for new size
  computeDioramaAnchors();
  // Rebuild clusters using updated canvas size
  rebuildDioramaClusters();
}

/**
 * Initialize the diorama and cards views.  Sets up the canvas, clusters,
 * cards and event handlers for mode toggles and image saving.  Should be
 * called once after the DOM is ready and game state has been loaded.
 */
function initSanctuary() {
  // Setup canvas and context
  dioramaCanvas = document.getElementById('diorama-canvas');
  if (dioramaCanvas) {
    dioramaCtx = dioramaCanvas.getContext('2d');
    // Compute initial anchors and clusters
    computeDioramaAnchors();
    onDioramaResize();
    // Listen to window resize to keep canvas fitting its container
    window.addEventListener('resize', onDioramaResize);
    // Start animation loop
    requestAnimationFrame(drawDiorama);
  }
  // Initialize species cards grid
  initCards();
  // Mode toggle buttons
  const dioramaBtn = document.getElementById('diorama-mode-btn');
  const cardsBtn = document.getElementById('cards-mode-btn');
  const dioramaSection = document.getElementById('diorama-section');
  const cardsSection = document.getElementById('cards-section');
  if (dioramaBtn && cardsBtn && dioramaSection && cardsSection) {
    dioramaBtn.addEventListener('click', () => {
      if (!dioramaBtn.classList.contains('active')) {
        dioramaBtn.classList.add('active');
        cardsBtn.classList.remove('active');
        dioramaSection.classList.remove('hidden');
        cardsSection.classList.add('hidden');
      }
    });
    cardsBtn.addEventListener('click', () => {
      if (!cardsBtn.classList.contains('active')) {
        cardsBtn.classList.add('active');
        dioramaBtn.classList.remove('active');
        cardsSection.classList.remove('hidden');
        dioramaSection.classList.add('hidden');
      }
    });
  }
  // Save image button for diorama
  const saveBtn = document.getElementById('save-diorama-image');
  if (saveBtn && dioramaCanvas) {
    saveBtn.addEventListener('click', saveDioramaImage);
  }
}

/**
 * Initialize the species cards grid.  Creates DOM elements for each species
 * and stores references for efficient updates.  Called once during setup.
 */
function initCards() {
  const container = document.getElementById('cards-container');
  if (!container) return;
  // Clear existing cards
  container.innerHTML = '';
  // Build a combined list of species from speciesList and reserveCounts
  const allSpecies = speciesList.map(sp => sp.name);
  Object.keys(reserveCounts).forEach(spName => {
    if (!allSpecies.includes(spName)) {
      allSpecies.push(spName);
    }
  });
  // Store card references by species name
  cardElements = {};
  allSpecies.forEach(spName => {
    const card = document.createElement('div');
    card.className = 'card';
    const icon = document.createElement('div');
    icon.className = 'card-icon';
    icon.style.backgroundColor = speciesColors[spName] || '#ccc';
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = spName;
    const countEl = document.createElement('div');
    countEl.className = 'card-count';
    countEl.textContent = 'Saved: 0';
    const bonusEl = document.createElement('div');
    bonusEl.className = 'card-bonus';
    // Find bonus from speciesList
    const spDef = speciesList.find(sp => sp.name === spName);
    if (spDef) {
      bonusEl.textContent = spDef.bonus;
    } else {
      bonusEl.textContent = '';
    }
    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(countEl);
    card.appendChild(bonusEl);
    container.appendChild(card);
    cardElements[spName] = { card: card, countEl: countEl, icon: icon, title: title };
  });
  // Update counts and locked status after building cards
  updateCards();
}

// Holds references to card elements keyed by species name
let cardElements = {};

/**
 * Update the species cards with the latest saved counts and locked status.  A
 * species card is considered unlocked when at least one animal of that
 * species has been saved; otherwise it is dimmed.  The count and bonus
 * information are refreshed from reserveCounts and speciesList.
 */
function updateCards() {
  Object.keys(cardElements).forEach(spName => {
    const elem = cardElements[spName];
    if (!elem) return;
    const count = reserveCounts[spName] || 0;
    // Update count text
    elem.countEl.textContent = `Saved: ${count}`;
    // Determine if species is unlocked (count > 0)
    if (count > 0) {
      elem.card.classList.remove('locked');
    } else {
      elem.card.classList.add('locked');
    }
    // Ensure the icon color matches species color (for new species)
    elem.icon.style.backgroundColor = speciesColors[spName] || '#ccc';
    // Update bonus text if species exists in speciesList
    const spDef = speciesList.find(sp => sp.name === spName);
    if (spDef) {
      elem.card.querySelector('.card-bonus').textContent = spDef.bonus || '';
    }
  });
}

/**
 * Save the diorama as a PNG image.  Uses the canvas toBlob API and triggers
 * a download.  The filename includes a timestamp for convenience.
 */
function saveDioramaImage() {
  if (!dioramaCanvas) return;
  try {
    dioramaCanvas.toBlob(function(blob) {
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      a.download = `Sanctuary-${date}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  } catch (e) {
    alert('Could not save image.');
  }
}

// ==== Changelog Management ====

// Entries for the changelog.  Each entry lists a version, an optional release
// date string and an array of change descriptions.  Add new entries at the
// beginning of the array so the most recent version appears first.
const changelogEntries = [
  {
    version: 'v0.7.0',
    date: '2025-08-23',
    changes: [
      'Introduced Sanctuary cards view with season stats and share codes.',
      'Added local leaderboard and friend code compare to see who saved the most animals.',
      'Added world events, permit upgrades, achievements, questline and biomes.',
      'Added PWA install prompt and changelog screen for public release.',
      'Added tip link support in the Sanctuary tools row so players can set their own donation link.'
    ]
  },
  {
    version: 'v0.6.0',
    date: '2025-08-20',
    changes: [
      'Enabled Prestige system with permits and permanent upgrades.',
      'Added world events that rotate and grant temporary bonuses.',
      'Added achievements and a multi-step questline with rewards.',
      'Added biome unlocks with new species and units.'
    ]
  },
  {
    version: 'v0.5.0',
    date: '2025-08-15',
    changes: [
      'Initial playable build with missions, units, upgrades and safe haven.'
    ]
  }
];

/**
 * Initialize the changelog view.  Populates the changelog list in the DOM
 * with the entries defined in changelogEntries.  Called when the user
 * navigates to the Changelog tab.
 */
function initChangelog() {
  const list = document.getElementById('changelog-list');
  if (!list) return;
  // Only populate if the list is empty to avoid duplication on re-entry
  if (list.childElementCount > 0) return;
  changelogEntries.forEach(entry => {
    const li = document.createElement('li');
    // Version heading
    const versionEl = document.createElement('div');
    versionEl.className = 'version';
    versionEl.textContent = `${entry.version} (${entry.date})`;
    li.appendChild(versionEl);
    // Changes list
    const changesEl = document.createElement('ul');
    changesEl.className = 'changes';
    entry.changes.forEach(change => {
      const ci = document.createElement('li');
      ci.textContent = change;
      changesEl.appendChild(ci);
    });
    li.appendChild(changesEl);
    list.appendChild(li);
  });
}

// ==== Tip Link Management ====

/**
 * Load the stored tip link from localStorage and update the UI accordingly.
 * If a tip link exists, the Support button is shown and the input fields
 * are hidden; otherwise the input remains visible for configuration.
 */
function loadTipLink() {
  try {
    const saved = localStorage.getItem('ee_tip_link');
    if (saved) {
      tipLink = saved;
    }
  } catch (e) {
    console.error('Failed to read tip link from storage:', e);
  }
  // Update UI: show support button if link exists, hide input; else show input
  if (tipLink && supportBtn && setTipLinkBtn && tipLinkInput) {
    supportBtn.classList.remove('hidden');
    tipLinkInput.classList.add('hidden');
    setTipLinkBtn.classList.add('hidden');
  } else if (tipLinkInput && setTipLinkBtn && supportBtn) {
    supportBtn.classList.add('hidden');
    tipLinkInput.classList.remove('hidden');
    setTipLinkBtn.classList.remove('hidden');
  }
}

/**
 * Save the provided tip link into localStorage and update the UI to reflect
 * that the link is configured.  A non-empty link shows the Support button
 * and hides the input field.
 * @param {string} link The tip link to store
 */
function saveTipLink(link) {
  try {
    localStorage.setItem('ee_tip_link', link);
  } catch (e) {
    console.error('Failed to save tip link:', e);
  }
  tipLink = link;
  // Show support button and hide input fields
  if (supportBtn && tipLinkInput && setTipLinkBtn) {
    supportBtn.classList.remove('hidden');
    tipLinkInput.classList.add('hidden');
    setTipLinkBtn.classList.add('hidden');
  }
}

// ----- Reserve (visual animal tracker) functions -----

// Return a normally-distributed random value with mean 0 and variance 1 using the
// Box–Muller transform.  This is used to scatter dots around species centers.
function randomGaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Generate a dot position for a given species.  Dots are clustered around
// species center(s) defined in speciesCenters.  The spread grows with the
// square root of the species count to represent expanding herds.
function randomDotForSpecies(species) {
  if (!reserveCanvas) return { x: 0, y: 0, baseX: 0, baseY: 0, phaseX: 0, phaseY: 0, ampX: 0, ampY: 0 };
  const centers = speciesCenters[species] || [{ x: 0.5, y: 0.5 }];
  const center = centers[Math.floor(Math.random() * centers.length)];
  const w = reserveCanvas.width;
  const h = reserveCanvas.height;
  // Base cluster radius relative to canvas size
  const count = reserveCounts[species] || 0;
  const baseR = Math.max(w, h) * 0.04;
  const growthR = Math.sqrt(Math.max(0, count)) * 0.5;
  const sigma = baseR + growthR;
  const cx = center.x * w;
  const cy = center.y * h;
  // Generate Gaussian offsets
  let x = cx + randomGaussian() * sigma;
  let y = cy + randomGaussian() * sigma;
  // Clamp to canvas with a small padding
  const pad = 4;
  x = Math.min(w - pad, Math.max(pad, x));
  y = Math.min(h - pad, Math.max(pad, y));
  // Set up drift properties: store base position and random phases/amplitudes
  return {
    x: x,
    y: y,
    baseX: x,
    baseY: y,
    phaseX: Math.random() * Math.PI * 2,
    phaseY: Math.random() * Math.PI * 2,
    ampX: 2 + Math.random() * 4,
    ampY: 2 + Math.random() * 4
  };
}

// Rebuild all dot positions based on reserveCounts.  Applies auto density so
// that the total number of rendered dots stays around 5000 or fewer.  For
// each species, we create nDots = ceil(count / densityDivisor) dot objects.
function rebuildReserveDots() {
  reserveDots = {};
  // Compute total animals saved across all species
  let total = 0;
  Object.keys(reserveCounts).forEach(sp => {
    total += reserveCounts[sp] || 0;
  });
  // Determine density divisor: if total > 5000, aggregate animals into groups
  const maxDots = 5000;
  const densityDivisor = total > maxDots ? Math.ceil(total / maxDots) : 1;
  Object.keys(reserveCounts).forEach(species => {
    const count = reserveCounts[species] || 0;
    const nDots = count > 0 ? Math.max(1, Math.round(count / densityDivisor)) : 0;
    reserveDots[species] = [];
    for (let i = 0; i < nDots; i++) {
      reserveDots[species].push(randomDotForSpecies(species));
    }
  });
}

// Resize handler for reserve canvas.  Adjusts both the visible canvas and the
// offscreen landCanvas to match the display size, redraws the landmass and
// rebuilds dot positions.  This keeps the visuals crisp and responsive.
function onReserveResize() {
  if (!reserveCanvas) return;
  const rect = reserveCanvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  reserveCanvas.width = w;
  reserveCanvas.height = h;
  if (!landCanvas) {
    landCanvas = document.createElement('canvas');
    landCtx = landCanvas.getContext('2d');
  }
  landCanvas.width = w;
  landCanvas.height = h;
  // Redraw the landmass on the offscreen canvas
  drawLand();
  // Rebuild dot positions to fit new canvas size and density settings
  rebuildReserveDots();
}

// Paint a stylized landmass on the offscreen landCanvas.  Draws layered
// translucent shapes over a water background to suggest continents and
// islands.  Called whenever the canvas is resized.
function drawLand() {
  if (!landCtx || !landCanvas) return;
  const ctx = landCtx;
  const w = landCanvas.width;
  const h = landCanvas.height;
  // Clear with water background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#dcefff';
  ctx.fillRect(0, 0, w, h);
  // Define several irregular island polygons (normalized coordinates)
  const islands = [
    // Main continent: an irregular shape wrapping across much of the canvas
    [
      { x: 0.05, y: 0.60 }, { x: 0.10, y: 0.45 }, { x: 0.18, y: 0.28 }, { x: 0.30, y: 0.20 },
      { x: 0.47, y: 0.23 }, { x: 0.60, y: 0.18 }, { x: 0.75, y: 0.10 }, { x: 0.88, y: 0.25 },
      { x: 0.95, y: 0.45 }, { x: 0.85, y: 0.65 }, { x: 0.70, y: 0.75 }, { x: 0.52, y: 0.83 },
      { x: 0.32, y: 0.85 }, { x: 0.15, y: 0.78 }
    ],
    // Secondary island
    [
      { x: 0.18, y: 0.80 }, { x: 0.25, y: 0.74 }, { x: 0.35, y: 0.77 }, { x: 0.32, y: 0.88 }
    ],
    // Tertiary island
    [
      { x: 0.78, y: 0.70 }, { x: 0.82, y: 0.66 }, { x: 0.90, y: 0.70 }, { x: 0.87, y: 0.78 }
    ]
  ];
  // Draw each island: beach stroke, land fill, and coastline stroke
  islands.forEach(poly => {
    ctx.beginPath();
    poly.forEach((pt, idx) => {
      const x = pt.x * w;
      const y = pt.y * h;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    // Beach: a wider stroke behind the land (sand color)
    ctx.save();
    ctx.lineWidth = Math.max(w, h) * 0.02;
    ctx.strokeStyle = '#eadfb2';
    ctx.stroke();
    ctx.restore();
    // Land fill
    ctx.fillStyle = '#cfe8b8';
    ctx.fill();
    // Slightly darker interior patches to suggest varied terrain
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#bfe0a4';
    ctx.fill();
    ctx.restore();
    // Coastline stroke
    ctx.lineWidth = Math.max(w, h) * 0.004;
    ctx.strokeStyle = '#91b08a';
    ctx.stroke();
  });
  // Optionally draw subtle noise overlay for texture
}

// Draw a small legend showing the color and count of each species in the
// top-right corner of the reserve view.  Only species with non-zero counts
// are displayed, sorted by descending count.
function drawLegend(ctx) {
  const entries = Object.keys(reserveCounts)
    .filter(s => (reserveCounts[s] || 0) > 0)
    .sort((a, b) => (reserveCounts[b] || 0) - (reserveCounts[a] || 0))
    .slice(0, 8);
  if (entries.length === 0) return;
  const pad = 8;
  const sw = 10;
  const lh = 18;
  const boxW = 160;
  const boxH = pad * 2 + lh * entries.length;
  const x = ctx.canvas.width - boxW - 10;
  const y = 10;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, boxW, boxH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#e2e2e2';
  ctx.strokeRect(x, y, boxW, boxH);
  ctx.font = '12px Arial';
  ctx.textBaseline = 'middle';
  entries.forEach((sp, i) => {
    const rowY = y + pad + i * lh + lh / 2;
    ctx.fillStyle = speciesColors[sp] || '#333';
    ctx.fillRect(x + pad, rowY - 5, sw, sw);
    ctx.fillStyle = '#333';
    ctx.fillText(`${sp}: ${reserveCounts[sp]}`, x + pad + sw + 6, rowY);
  });
  ctx.restore();
}

// Draw loop for reserve view.  Renders the landmass, then animates dots with
// gentle drift.  Updates the frame counter and schedules the next frame.
function drawReserve() {
  if (!reserveCtx || !reserveCanvas) return;
  const ctx = reserveCtx;
  const w = reserveCanvas.width;
  const h = reserveCanvas.height;
  // Clear and draw the landmass from the offscreen canvas
  ctx.clearRect(0, 0, w, h);
  if (landCanvas) {
    ctx.drawImage(landCanvas, 0, 0);
  }
  // Draw each species' dots with drift
  const dotRadius = 2;
  reserveFrame++;
  const t = reserveFrame * 0.01;
  Object.keys(reserveDots).forEach(species => {
    const dots = reserveDots[species] || [];
    ctx.fillStyle = speciesColors[species] || '#333';
    dots.forEach(d => {
      // Apply gentle sinusoidal drift around the base position
      const dx = d.ampX * Math.sin(t + d.phaseX);
      const dy = d.ampY * Math.cos(t + d.phaseY);
      const x = d.baseX + dx;
      const y = d.baseY + dy;
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  // Draw legend on top
  drawLegend(ctx);
  requestAnimationFrame(drawReserve);
}

// Initialize reserve canvas, offscreen land canvas and listeners.  Sets up
// event handlers for resizing, builds the initial landmass and dot positions
// and starts the animation loop.
function initReserve() {
  reserveCanvas = document.getElementById('reserve-canvas');
  if (!reserveCanvas) return;
  reserveCtx = reserveCanvas.getContext('2d');
  // Create offscreen land canvas
  landCanvas = document.createElement('canvas');
  landCtx = landCanvas.getContext('2d');
  onReserveResize();
  window.addEventListener('resize', onReserveResize);
  // Start the draw loop
  requestAnimationFrame(drawReserve);
}

// Upgrades UI container
const upgradesContainer = document.getElementById('upgrades-container');

// Cached DOM elements
const coinsEl = document.getElementById('coins');
const animalsSavedEl = document.getElementById('animals-saved');
const rateEl = document.getElementById('rate');
const unitsContainer = document.getElementById('units-container');

// Manual rescue button
const manualBtn = document.getElementById('manual-rescue');

// Navigation and view elements
const tabGameBtn = document.getElementById('tab-game');
const tabHavenBtn = document.getElementById('tab-haven');
const gameView = document.getElementById('game-view');
const havenView = document.getElementById('haven-view');

// Changelog navigation and view elements.  This replaces the old reserve map.
const tabChangelogBtn = document.getElementById('tab-changelog');
const changelogView = document.getElementById('changelog-view');
// Install App button (PWA prompt)
const installAppBtn = document.getElementById('install-app');

// Sanctuary tip link elements
const tipLinkInput = document.getElementById('tip-link-input');
const setTipLinkBtn = document.getElementById('set-tip-link');
const supportBtn = document.getElementById('support-button');

// Mission panel elements
const missionNameEl = document.getElementById('mission-name');
const missionTimeEl = document.getElementById('mission-time');
const animalsAtRiskEl = document.getElementById('animals-at-risk');
const missionProgressEl = document.getElementById('mission-progress');

// Tasks panel
const tasksListEl = document.getElementById('tasks-list');

// Safe haven element
const safeHavenEl = document.getElementById('safe-haven');

// Event panel elements
const eventPanel = document.getElementById('event-panel');
const eventNameEl = document.getElementById('event-name');
const eventTimeLeftEl = document.getElementById('event-time-left');
// Permits and prestige elements
const permitsCountEl = document.getElementById('permits-count');
const lifetimeSavedEl = document.getElementById('lifetime-saved');
const permitsContainerEl = document.getElementById('permits-container');
const prestigeButton = document.getElementById('prestige-button');
const prestigeInfoEl = document.getElementById('prestige-info');

// Create UI for each unit
function initUnits() {
  unitDefinitions.forEach((unit, index) => {
    const card = document.createElement('div');
    card.className = 'unit-card';

    const info = document.createElement('div');
    info.className = 'unit-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'unit-name';
    nameEl.textContent = unit.name;
    info.appendChild(nameEl);

    const statsEl = document.createElement('div');
    statsEl.className = 'unit-stats';
    statsEl.id = `unit-stats-${index}`;
    info.appendChild(statsEl);

    const button = document.createElement('button');
    button.className = 'buy-button';
    button.id = `unit-buy-${index}`;
    button.textContent = `Buy (${unit.baseCost} coins)`;
    button.addEventListener('click', () => purchaseUnit(index));

    card.appendChild(info);
    card.appendChild(button);
    unitsContainer.appendChild(card);
  });
}

// Create UI for upgrades
function initUpgrades() {
  upgradeDefinitions.forEach((upgrade, index) => {
    const card = document.createElement('div');
    card.className = 'unit-card';

    const info = document.createElement('div');
    info.className = 'unit-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'unit-name';
    nameEl.textContent = upgrade.name;
    info.appendChild(nameEl);

    const statsEl = document.createElement('div');
    statsEl.className = 'unit-stats';
    statsEl.id = `upgrade-stats-${index}`;
    info.appendChild(statsEl);

    const button = document.createElement('button');
    button.className = 'buy-button';
    button.id = `upgrade-buy-${index}`;
    button.textContent = `Buy (${upgrade.baseCost} coins)`;
    button.addEventListener('click', () => purchaseUpgrade(index));

    card.appendChild(info);
    card.appendChild(button);
    upgradesContainer.appendChild(card);
  });
}

// Purchase an upgrade if the player has enough coins
function purchaseUpgrade(index) {
  const cost = upgradeCosts[index];
  if (coins >= cost) {
    coins -= cost;
    upgradesOwned[index] += 1;
    // Apply the upgrade effect
    const upg = upgradeDefinitions[index];
    if (upg.effectType === 'rate') {
      globalRateBonus += upg.effectValue;
    } else if (upg.effectType === 'time') {
      globalTimeReduction += upg.effectValue;
      // Cap reduction at 0.9 (cannot reduce more than 90%) to avoid negative durations
      if (globalTimeReduction > 0.9) globalTimeReduction = 0.9;
    } else if (upg.effectType === 'animals') {
      globalAnimalBonus += upg.effectValue;
    }
    // Calculate next cost using exponential scaling
    upgradeCosts[index] = Math.floor(upg.baseCost * Math.pow(upg.costMultiplier, upgradesOwned[index]));
    updateUI();
    updateUpgradesUI();
  }
}

// Update the UI for upgrades
function updateUpgradesUI() {
  upgradeDefinitions.forEach((upgrade, index) => {
    const owned = upgradesOwned[index];
    const statsEl = document.getElementById(`upgrade-stats-${index}`);
    if (statsEl) {
      let effectDescription = '';
      if (upgrade.effectType === 'rate') {
        effectDescription = `+${Math.round(upgrade.effectValue * 100)}% rescue rate`;
      } else if (upgrade.effectType === 'time') {
        effectDescription = `-${Math.round(upgrade.effectValue * 100)}% mission time`;
      } else if (upgrade.effectType === 'animals') {
        effectDescription = `+${Math.round(upgrade.effectValue * 100)}% animals per mission`;
      }
      statsEl.textContent = `Owned: ${owned} • ${effectDescription} • Next: ${upgradeCosts[index]} coins`;
    }
    const btn = document.getElementById(`upgrade-buy-${index}`);
    if (btn) {
      btn.textContent = `Buy (${upgradeCosts[index]} coins)`;
      btn.disabled = coins < upgradeCosts[index];
    }
  });
}

// Purchase a unit if the player has enough coins
function purchaseUnit(index) {
  const cost = nextCosts[index];
  if (coins >= cost) {
    coins -= cost;
    unitsOwned[index] += 1;
    // Calculate next cost using exponential scaling
    nextCosts[index] = Math.floor(unitDefinitions[index].baseCost * Math.pow(unitDefinitions[index].costMultiplier, unitsOwned[index]));
    updateUI();
  }
}

// Compute the current rescue rate (animals per second)
function computeRescueRate() {
  let ratePerSec = 0;
  unitsOwned.forEach((count, index) => {
    ratePerSec += (count * unitDefinitions[index].baseRate) / 60;
  });
  // Apply global, species, permit and event rate bonuses (additive percentages)
  ratePerSec *= (1 + globalRateBonus + speciesRateBonus + permitRateBonus + eventRateBonus + achievementRateBonus);
  return ratePerSec;
}

// Update all visible elements
function updateUI() {
  coinsEl.textContent = coins.toFixed(1);
  animalsSavedEl.textContent = Math.floor(animalsSaved);
  const rate = computeRescueRate();
  rateEl.textContent = rate.toFixed(2);
  // Update each unit's stats and button label
  unitDefinitions.forEach((unit, index) => {
    const statsEl = document.getElementById(`unit-stats-${index}`);
    const owned = unitsOwned[index];
    statsEl.textContent = `Owned: ${owned} • Rate: ${(unit.baseRate * owned).toFixed(1)} animals/min • Next: ${nextCosts[index]} coins`;
    const button = document.getElementById(`unit-buy-${index}`);
    button.textContent = `Buy (${nextCosts[index]} coins)`;
    button.disabled = coins < nextCosts[index];
  });
  // Also update upgrade buttons availability whenever UI refreshes
  updateUpgradesUI();
  // Update permits display whenever general UI updates (coins/animals/lifetime)
  updatePermitsUI();
  // Update achievements and questline UI to reflect progress and claimability
  updateAchievementsUI();
  updateQuestUI();
  // Update biomes UI to reflect permit availability and unlock status
  updateBiomesUI();
}

// Start a new mission based on the currentMissionIndex
function startMission() {
  const mission = missions[currentMissionIndex];
  missionActive = true;
  // Apply time reduction (percentage) from upgrades, species, permits and events to mission duration
  let totalReduction = globalTimeReduction + speciesTimeReduction + permitTimeReduction + eventTimeReduction + achievementTimeReduction;
  // Cap total reduction at 90% to avoid negative durations
  if (totalReduction > 0.9) totalReduction = 0.9;
  const adjustedDuration = mission.duration * (1 - totalReduction);
  missionTimeLeft = adjustedDuration;
  totalAnimalsForMission = Math.round(mission.baseRisk * mission.difficulty);
  animalsAtRisk = totalAnimalsForMission;
  updateMissionUI();
}

// Finish the current mission, award coins, update safe haven and tasks
function finishMission() {
  missionActive = false;
  const mission = missions[currentMissionIndex];
  // Apply animal bonus (from upgrades and species) when calculating saved animals
  const baseSaved = totalAnimalsForMission - animalsAtRisk;
  if (baseSaved > 0) {
    const bonusMultiplier = 1 + globalAnimalBonus + speciesAnimalBonus + permitAnimalBonus + eventAnimalBonus + achievementAnimalBonus;
    const savedNow = Math.floor(baseSaved * bonusMultiplier);
    coins += savedNow;
    animalsSaved += savedNow;
    // Increment lifetime animals saved for prestige calculations
    lifetimeAnimalsSaved += savedNow;

    // Update season total and best record.  Missions contribute their
    // saved animals toward the season tally.  If this season’s total exceeds
    // the previous record, update bestSeasonTotal.  Afterwards refresh
    // the season stats UI.
    seasonAnimalsSaved += savedNow;
    if (seasonAnimalsSaved > bestSeasonTotal) {
      bestSeasonTotal = seasonAnimalsSaved;
    }
    updateSeasonStatsUI();
    missionsCompleted += 1;
    // Mark species as saved if present in speciesList
    const species = mission.species;
    speciesList.forEach(sp => {
      if (sp.name === species) {
        sp.saved = true;
      }
    });
      // Track rescued animals in reserve. Each saved animal becomes a dot.
      const spName = mission.species;
      if (!reserveCounts[spName]) reserveCounts[spName] = 0;
      // Increase count for species
      reserveCounts[spName] += savedNow;
      // After updating the count for this species, refresh species bonuses and
      // update the Sanctuary cards view. We no longer rebuild diorama clusters
      // because the diorama/map view has been removed.
      updateSpeciesBonuses();
      // Rebuild reserve dots (kept for potential future use) and update cards
      rebuildReserveDots();
      updateCards();
  }
  updateUI();
  updateTasksUI();
  // Update Sanctuary cards instead of Safe Haven
  updateCards();
  // Update achievements and questline progress
  updateAchievementsUI();
  updateQuestUI();
  // Advance to next mission
  currentMissionIndex = (currentMissionIndex + 1) % missions.length;
  startMission();
}

// Update mission panel UI
function updateMissionUI() {
  if (!missionActive) return;
  const mission = missions[currentMissionIndex];
  missionNameEl.textContent = `Mission: ${mission.name}`;
  missionTimeEl.textContent = Math.max(0, Math.floor(missionTimeLeft));
  animalsAtRiskEl.textContent = Math.max(0, Math.ceil(animalsAtRisk));
  // Update progress bar
  const progress = totalAnimalsForMission > 0 ? ((totalAnimalsForMission - animalsAtRisk) / totalAnimalsForMission) * 100 : 0;
  missionProgressEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

// Update tasks UI
function updateTasksUI() {
  tasksListEl.innerHTML = '';
  tasks.forEach(task => {
    const completed = !!tasksCompleted[task.id] || task.check();
    if (completed) tasksCompleted[task.id] = true;
    const li = document.createElement('li');
    li.textContent = task.description;
    if (tasksCompleted[task.id]) {
      li.classList.add('completed');
    }
    tasksListEl.appendChild(li);
  });
}

// Update safe haven UI
function updateHavenUI() {
  safeHavenEl.innerHTML = '';
  speciesList.forEach(sp => {
    const card = document.createElement('div');
    card.className = 'species-card';
    if (!sp.saved) {
      card.classList.add('locked');
    }
    const nameEl = document.createElement('div');
    nameEl.className = 'species-name';
    nameEl.textContent = sp.name;
    card.appendChild(nameEl);
    const bonusEl = document.createElement('div');
    bonusEl.className = 'species-bonus';
    bonusEl.textContent = sp.saved ? sp.bonus : '???';
    bonusEl.style.fontSize = '0.8rem';
    bonusEl.style.color = '#555';
    card.appendChild(bonusEl);
    safeHavenEl.appendChild(card);
  });
}

// ---- Achievements and Questline Functions ----

// Initialize the achievements UI
function initAchievements() {
  // Populate achievements list container if needed
  updateAchievementsUI();
}

// Update the achievements list UI. Displays each achievement and its status.
function updateAchievementsUI() {
  const achievementsListEl = document.getElementById('achievements-list');
  if (!achievementsListEl) return;
  // Clear existing content
  achievementsListEl.innerHTML = '';
  achievements.forEach(ach => {
    const li = document.createElement('li');
    li.className = 'achievement-item';
    // Determine if achievement is completed or ready to claim
    const completed = !!achievementsCompleted[ach.id];
    const metRequirement = ach.check();
    // Set text
    li.textContent = ach.description;
    if (completed) {
      li.classList.add('completed');
    }
    // If requirement met but not yet claimed, provide claim button
    if (metRequirement && !completed) {
      const btn = document.createElement('button');
      btn.className = 'claim-button';
      btn.textContent = 'Claim';
      btn.addEventListener('click', () => {
        claimAchievement(ach.id);
      });
      li.appendChild(btn);
    }
    achievementsListEl.appendChild(li);
  });
}

// Claim an achievement reward and mark it complete
function claimAchievement(id) {
  const ach = achievements.find(a => a.id === id);
  if (!ach) return;
  // If already completed or requirement not met, do nothing
  if (achievementsCompleted[id] || !ach.check()) return;
  achievementsCompleted[id] = true;
  // Apply reward based on type
  if (ach.rewardType === 'coins') {
    coins += ach.rewardValue;
  } else if (ach.rewardType === 'rate') {
    achievementRateBonus += ach.rewardValue;
  } else if (ach.rewardType === 'time') {
    achievementTimeReduction += ach.rewardValue;
    // Cap time reduction at 0.9 to avoid negative mission duration
    if (achievementTimeReduction + globalTimeReduction + speciesTimeReduction + permitTimeReduction + eventTimeReduction > 0.9) {
      achievementTimeReduction = 0.9 - (globalTimeReduction + speciesTimeReduction + permitTimeReduction + eventTimeReduction);
      if (achievementTimeReduction < 0) achievementTimeReduction = 0;
    }
  } else if (ach.rewardType === 'animals') {
    achievementAnimalBonus += ach.rewardValue;
  }
  // Refresh UI and bonuses
  updateUI();
  updateAchievementsUI();
}

// Initialize questline UI
function initQuest() {
  updateQuestUI();
}

// Update questline UI. Shows current step and claim button if completed.
function updateQuestUI() {
  const questContainer = document.getElementById('quest-content');
  if (!questContainer) return;
  questContainer.innerHTML = '';
  // If quest completed
  if (currentQuestStep >= questSteps.length) {
    const finished = document.createElement('p');
    finished.textContent = 'Congratulations! The reef has been rebuilt!';
    questContainer.appendChild(finished);
    return;
  }
  const step = questSteps[currentQuestStep];
  const p = document.createElement('p');
  p.textContent = step.description;
  questContainer.appendChild(p);
  // Determine if requirement met and not yet claimed
  const completed = questStepsClaimed[currentQuestStep];
  const readyToClaim = step.check() && !completed;
  if (readyToClaim) {
    const btn = document.createElement('button');
    btn.className = 'quest-button';
    btn.textContent = 'Claim Reward';
    btn.addEventListener('click', () => {
      claimQuestReward();
    });
    questContainer.appendChild(btn);
  } else {
    // Show progress indicator
    const progress = document.createElement('p');
    progress.style.fontSize = '0.85rem';
    // Basic progress reporting: show "In progress" or "Completed"
    if (completed) {
      progress.textContent = 'Completed';
      progress.style.color = '#28a745';
    } else {
      progress.textContent = 'In progress…';
      progress.style.color = '#555';
    }
    questContainer.appendChild(progress);
  }
}

// Claim the current quest step reward and advance to next step
function claimQuestReward() {
  if (currentQuestStep >= questSteps.length) return;
  const step = questSteps[currentQuestStep];
  // Ensure requirement met and not yet claimed
  if (!step.check() || questStepsClaimed[currentQuestStep]) return;
  questStepsClaimed[currentQuestStep] = true;
  // Apply reward
  if (step.rewardType === 'coins') {
    coins += step.rewardValue;
  } else if (step.rewardType === 'rate') {
    achievementRateBonus += step.rewardValue;
  } else if (step.rewardType === 'time') {
    achievementTimeReduction += step.rewardValue;
    if (achievementTimeReduction + globalTimeReduction + speciesTimeReduction + permitTimeReduction + eventTimeReduction > 0.9) {
      achievementTimeReduction = 0.9 - (globalTimeReduction + speciesTimeReduction + permitTimeReduction + eventTimeReduction);
      if (achievementTimeReduction < 0) achievementTimeReduction = 0;
    }
  } else if (step.rewardType === 'animals') {
    achievementAnimalBonus += step.rewardValue;
  } else if (step.rewardType === 'permit') {
    // Grant permits directly (adds to available permits and total)
    permitsAvailable += step.rewardValue;
    permitsTotal += step.rewardValue;
  }
  // Advance to next step
  currentQuestStep += 1;
  updateQuestUI();
  // Refresh UI to show updated counts and bonuses
  updateUI();
  updatePermitsUI();
}

// ---- Permits and Prestige System ----

// Compute permit bonuses based on purchased upgrades
function applyPermitBonuses() {
  permitRateBonus = permitUpgrades.rate * permitUpgradeDefinitions[0].effectValue;
  permitAnimalBonus = permitUpgrades.animals * permitUpgradeDefinitions[1].effectValue;
  permitTimeReduction = permitUpgrades.time * permitUpgradeDefinitions[2].effectValue;
  // Map upgrade effect currently has no gameplay impact
}

// Initialize the permits shop UI and hook up events
function initPermits() {
  // Clear any existing content
  if (permitsContainerEl) permitsContainerEl.innerHTML = '';
  permitUpgradeDefinitions.forEach((def, index) => {
    const card = document.createElement('div');
    card.className = 'permits-card';
    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = def.name;
    info.appendChild(title);
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.id = `permit-desc-${index}`;
    desc.textContent = '';
    info.appendChild(desc);
    card.appendChild(info);
    const btn = document.createElement('button');
    btn.className = 'permit-buy-button';
    btn.id = `permit-buy-${index}`;
    btn.textContent = `Buy (${permitUpgradeCosts[index]} permits)`;
    btn.addEventListener('click', () => purchasePermitUpgrade(index));
    card.appendChild(btn);
    permitsContainerEl.appendChild(card);
  });
  // Prestige button
  if (prestigeButton) {
    prestigeButton.addEventListener('click', () => {
      prestige();
    });
  }
}

// Update the permits UI elements: counts, shop and prestige information
function updatePermitsUI() {
  if (permitsCountEl) permitsCountEl.textContent = permitsAvailable.toString();
  if (lifetimeSavedEl) lifetimeSavedEl.textContent = Math.floor(lifetimeAnimalsSaved).toString();
  // Update each permit upgrade card
  permitUpgradeDefinitions.forEach((def, index) => {
    const owned = permitUpgrades[def.effectType] || 0;
    const cost = permitUpgradeCosts[index];
    const descEl = document.getElementById(`permit-desc-${index}`);
    if (descEl) {
      let effectDesc = '';
      if (def.effectType === 'rate') {
        effectDesc = `+${Math.round(def.effectValue * 100)}% rescue rate`;
      } else if (def.effectType === 'animals') {
        effectDesc = `+${Math.round(def.effectValue * 100)}% mission animals`;
      } else if (def.effectType === 'time') {
        effectDesc = `-${Math.round(def.effectValue * 100)}% mission time`;
      } else {
        effectDesc = 'Special bonus';
      }
      descEl.textContent = `Owned: ${owned} • ${effectDesc} • Next: ${cost} permits`;
    }
    const btn = document.getElementById(`permit-buy-${index}`);
    if (btn) {
      btn.textContent = `Buy (${cost} permits)`;
      btn.disabled = permitsAvailable < cost;
    }
  });
  // Update prestige info
  if (prestigeInfoEl && prestigeButton) {
    const expectedTotal = Math.floor(lifetimeAnimalsSaved / 1000);
    const newPermits = expectedTotal - permitsTotal;
    if (newPermits > 0) {
      prestigeInfoEl.textContent = `Earn ${newPermits} new permit${newPermits === 1 ? '' : 's'} by founding a new reserve.`;
      prestigeButton.disabled = false;
    } else {
      prestigeInfoEl.textContent = 'No new permits available yet. Save more animals to earn more.';
      // Disable prestige button if no new permits
      prestigeButton.disabled = true;
    }
  }
}

// ---- Biome System ----

// Initialize biome UI cards
function initBiomes() {
  const biomesContainer = document.getElementById('biomes-container');
  if (!biomesContainer) return;
  biomesContainer.innerHTML = '';
  biomeDefinitions.forEach(biome => {
    const card = document.createElement('div');
    card.className = 'biome-card';
    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = biome.name;
    info.appendChild(title);
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.id = `biome-desc-${biome.id}`;
    desc.textContent = '';
    info.appendChild(desc);
    card.appendChild(info);
    const btn = document.createElement('button');
    btn.className = 'biome-buy-button';
    btn.id = `biome-buy-${biome.id}`;
    btn.textContent = `Unlock (${biome.cost} permits)`;
    btn.addEventListener('click', () => unlockBiome(biome.id));
    card.appendChild(btn);
    biomesContainer.appendChild(card);
  });
  updateBiomesUI();
}

// Update biome cards based on unlock status and available permits
function updateBiomesUI() {
  biomeDefinitions.forEach(biome => {
    const descEl = document.getElementById(`biome-desc-${biome.id}`);
    const btn = document.getElementById(`biome-buy-${biome.id}`);
    const unlocked = !!biomesUnlocked[biome.id];
    if (unlocked) {
      if (descEl) descEl.textContent = 'Unlocked';
      if (btn) {
        btn.textContent = 'Unlocked';
        btn.disabled = true;
      }
    } else {
      if (descEl) descEl.textContent = `Cost: ${biome.cost} permits`;
      if (btn) {
        btn.textContent = `Unlock (${biome.cost} permits)`;
        btn.disabled = permitsAvailable < biome.cost;
      }
    }
  });
}

// Unlock a biome if the player has enough permits
function unlockBiome(id) {
  const biome = biomeDefinitions.find(b => b.id === id);
  if (!biome) return;
  if (biomesUnlocked[id]) return; // Already unlocked
  if (permitsAvailable < biome.cost) return; // Not enough permits
  // Deduct permits and mark as unlocked
  permitsAvailable -= biome.cost;
  biomesUnlocked[id] = true;
  // Add new species definitions to speciesList
  biome.species.forEach(spec => {
    // Avoid duplicate species
    const exists = speciesList.some(sp => sp.name === spec.name);
    if (!exists) {
      speciesList.push({ name: spec.name, saved: false, bonus: spec.bonus, effectType: spec.effectType, effectValue: spec.effectValue });
    }
  });
  // Extend speciesColors
  if (biome.speciesColors) {
    Object.keys(biome.speciesColors).forEach(name => {
      speciesColors[name] = biome.speciesColors[name];
    });
  }
  // Note: speciesCenters will be used in future reserve polish step
  // Extend speciesCenters with biome-specific center positions if provided
  if (biome.speciesCenters) {
    Object.keys(biome.speciesCenters).forEach(name => {
      speciesCenters[name] = biome.speciesCenters[name];
    });
  }
  // Add new rescue units
  biome.units.forEach(unit => {
    unitDefinitions.push({ name: unit.name, baseCost: unit.baseCost, baseRate: unit.baseRate, costMultiplier: unit.costMultiplier });
    unitsOwned.push(0);
    nextCosts.push(unit.baseCost);
    // Create card UI for new unit
    const idx = unitDefinitions.length - 1;
    const card = document.createElement('div');
    card.className = 'unit-card';
    const info = document.createElement('div');
    info.className = 'unit-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'unit-name';
    nameEl.textContent = unit.name;
    info.appendChild(nameEl);
    const statsEl = document.createElement('div');
    statsEl.className = 'unit-stats';
    statsEl.id = `unit-stats-${idx}`;
    info.appendChild(statsEl);
    const btn = document.createElement('button');
    btn.className = 'buy-button';
    btn.id = `unit-buy-${idx}`;
    btn.textContent = `Buy (${unit.baseCost} coins)`;
    btn.addEventListener('click', () => purchaseUnit(idx));
    card.appendChild(info);
    card.appendChild(btn);
    const unitsContainer = document.getElementById('units-container');
    if (unitsContainer) unitsContainer.appendChild(card);
  });
  // Add missions for new species
  biome.species.forEach(spec => {
    missions.push({ name: `${spec.name} Rescue`, duration: 120, baseRisk: 20, difficulty: 1.0, species: spec.name });
  });
  // Refresh permit bonuses and species bonuses
  updateSpeciesBonuses();
  applyPermitBonuses();
  // Rebuild reserve dots to include new species counts (initially 0)
  rebuildReserveDots();
  // Update UI
  updateBiomesUI();
  updatePermitsUI();
  updateUI();
  // Refresh sanctuary cards instead of safe haven list
  updateCards();
  updateAchievementsUI();
  updateQuestUI();
}

// Apply unlocked biomes on load to reconstruct species, units and missions
function applyUnlockedBiomes() {
  biomeDefinitions.forEach(biome => {
    if (biomesUnlocked[biome.id]) {
      // Add species definitions if not already added
      biome.species.forEach(spec => {
        const exists = speciesList.some(sp => sp.name === spec.name);
        if (!exists) {
          speciesList.push({ name: spec.name, saved: false, bonus: spec.bonus, effectType: spec.effectType, effectValue: spec.effectValue });
        }
        // If species saved state exists from saved speciesState, it will be restored separately
      });
      // Extend speciesColors
      if (biome.speciesColors) {
        Object.keys(biome.speciesColors).forEach(name => {
          speciesColors[name] = biome.speciesColors[name];
        });
      }
      // Extend speciesCenters with biome-defined centers if provided
      if (biome.speciesCenters) {
        Object.keys(biome.speciesCenters).forEach(name => {
          speciesCenters[name] = biome.speciesCenters[name];
        });
      }
      // Add rescue units if not present
      biome.units.forEach(unit => {
        const exists = unitDefinitions.some(u => u.name === unit.name);
        if (!exists) {
          unitDefinitions.push({ name: unit.name, baseCost: unit.baseCost, baseRate: unit.baseRate, costMultiplier: unit.costMultiplier });
          unitsOwned.push(0);
          nextCosts.push(unit.baseCost);
        }
      });
      // Add missions if not present
      biome.species.forEach(spec => {
        const exists = missions.some(m => m.species === spec.name);
        if (!exists) {
          missions.push({ name: `${spec.name} Rescue`, duration: 120, baseRisk: 20, difficulty: 1.0, species: spec.name });
        }
      });
    }
  });
  // After applying unlocked biomes, rebuild the species cards to reflect
  // new species definitions. We no longer update diorama clusters because
  // the diorama view has been removed.
  try {
    initCards();
    updateCards();
  } catch (e) {
    // ignore errors if cards not yet initialized
  }
}

// Purchase a permit upgrade if enough permits are available
function purchasePermitUpgrade(index) {
  const cost = permitUpgradeCosts[index];
  if (permitsAvailable >= cost) {
    permitsAvailable -= cost;
    const def = permitUpgradeDefinitions[index];
    // Increment upgrade based on its effect type
    if (def.effectType === 'rate') {
      permitUpgrades.rate += 1;
    } else if (def.effectType === 'animals') {
      permitUpgrades.animals += 1;
    } else if (def.effectType === 'time') {
      permitUpgrades.time += 1;
    } else if (def.effectType === 'map') {
      permitUpgrades.map += 1;
    }
    // Update next cost using exponential scaling
    permitUpgradeCosts[index] = Math.floor(def.baseCost * Math.pow(def.costMultiplier, permitUpgrades[def.effectType]));
    // Recompute permit bonuses
    applyPermitBonuses();
    // Refresh UI
    updatePermitsUI();
    updateUI();
  }
}

// Perform a prestige reset: award new permits and reset game progress
function prestige() {
  // Calculate newly earned permits based on lifetime animals saved
  const targetTotal = Math.floor(lifetimeAnimalsSaved / 1000);
  let newPermits = targetTotal - permitsTotal;
  if (newPermits < 0) newPermits = 0;
  permitsTotal = targetTotal;
  permitsAvailable += newPermits;
  // Reset current run progress
  coins = 0;
  animalsSaved = 0;
  // Reset units and their costs
  unitDefinitions.forEach((unit, i) => {
    unitsOwned[i] = 0;
    nextCosts[i] = unit.baseCost;
  });
  // Reset upgrades and their costs
  upgradeDefinitions.forEach((upg, i) => {
    upgradesOwned[i] = 0;
    upgradeCosts[i] = upg.baseCost;
  });
  globalRateBonus = 0;
  globalTimeReduction = 0;
  globalAnimalBonus = 0;
  // Reset species saved flags
  speciesList.forEach(sp => {
    sp.saved = false;
  });
  updateSpeciesBonuses();
  // Reset tasks completed
  Object.keys(tasksCompleted).forEach(key => {
    tasksCompleted[key] = false;
  });
  missionsCompleted = 0;
  // Reset mission state
  missionActive = false;
  missionTimeLeft = 0;
  animalsAtRisk = 0;
  totalAnimalsForMission = 0;
  currentMissionIndex = 0;
  // Reset reserve counts and dots
  reserveCounts = {};
  reserveDots = {};
  // Reset last daily bonus date to allow immediate bonus next day
  lastDailyBonusDate = null;
  // Finalize the season: update the best total if needed and reset
  // the season tally.  Refresh the season stats display.
  if (seasonAnimalsSaved > bestSeasonTotal) {
    bestSeasonTotal = seasonAnimalsSaved;
  }
  seasonAnimalsSaved = 0;
  updateSeasonStatsUI();
  // Recompute permit bonuses (they persist)
  applyPermitBonuses();
  // Refresh UI and start a new mission
  // Sanctuary cards replace the old safe haven UI
  updateCards();
  updateTasksUI();
  updateUI();
  updateUpgradesUI();
  updatePermitsUI();
  // Start first mission again
  startMission();
}

// ---- World Events System ----

// Initialize the world events by validating any saved event or starting a new one
function initEvent() {
  // If there is a saved active event and it has not expired, apply it
  const now = Date.now();
  if (activeEvent && activeEvent.endTime && activeEvent.endTime > now) {
    updateEventBonuses();
  } else {
    // Otherwise start a new event
    startNewEvent();
  }
  // Update the event UI immediately
  updateEventUI();
}

// Start a new world event randomly selected from eventsList
function startNewEvent() {
  const idx = Math.floor(Math.random() * eventsList.length);
  const evDef = eventsList[idx];
  activeEvent = {
    id: evDef.id,
    name: evDef.name,
    rateBonus: evDef.rateBonus,
    animalBonus: evDef.animalBonus,
    timeReduction: evDef.timeReduction,
    endTime: Date.now() + evDef.duration * 1000
  };
  updateEventBonuses();
  updateEventUI();
}

// Apply the modifiers from the active event to global event bonus variables
function updateEventBonuses() {
  if (activeEvent) {
    eventRateBonus = activeEvent.rateBonus || 0;
    eventAnimalBonus = activeEvent.animalBonus || 0;
    eventTimeReduction = activeEvent.timeReduction || 0;
  } else {
    eventRateBonus = 0;
    eventAnimalBonus = 0;
    eventTimeReduction = 0;
  }
}

// Update the event panel UI and handle expiration
function updateEventUI() {
  if (!eventPanel) return;
  // No active event: hide panel
  if (!activeEvent || !activeEvent.endTime) {
    eventPanel.classList.add('hidden');
    return;
  }
  const now = Date.now();
  const diff = activeEvent.endTime - now;
  if (diff <= 0) {
    // Event has expired; start a new one
    startNewEvent();
    return;
  }
  // Show panel and update content
  eventPanel.classList.remove('hidden');
  if (eventNameEl) {
    eventNameEl.textContent = `Event: ${activeEvent.name}`;
  }
  if (eventTimeLeftEl) {
    const totalSecs = Math.floor(diff / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    eventTimeLeftEl.textContent = `${hh}:${mm}:${ss}`;
  }
}

// Save game state to localStorage
function saveGame() {
  try {
    const state = {
      coins,
      animalsSaved,
      unitsOwned: Array.from(unitsOwned),
      nextCosts: Array.from(nextCosts),
      upgradesOwned: Array.from(upgradesOwned),
      upgradeCosts: Array.from(upgradeCosts),
      globalRateBonus,
      globalTimeReduction,
      globalAnimalBonus,
      tasksCompleted,
      speciesState: speciesList.map(sp => ({ name: sp.name, saved: sp.saved })),
      currentMissionIndex,
      missionActive,
      missionTimeLeft,
      animalsAtRisk,
      totalAnimalsForMission,
      missionsCompleted,
      lastSave: Date.now(),
      lastDailyBonusDate,
      reserveCounts: reserveCounts,
      // Permits and prestige
      permitsTotal: permitsTotal,
      permitsAvailable: permitsAvailable,
      lifetimeAnimalsSaved: lifetimeAnimalsSaved,
      permitUpgrades: permitUpgrades,
      permitUpgradeCosts: permitUpgradeCosts,
      activeEvent: activeEvent
      ,
      // Biomes
      biomesUnlocked: biomesUnlocked
      ,
      // Achievements and questline state
      achievementsCompleted: achievementsCompleted,
      achievementRateBonus: achievementRateBonus,
      achievementTimeReduction: achievementTimeReduction,
      achievementAnimalBonus: achievementAnimalBonus,
      currentQuestStep: currentQuestStep,
      questStepsClaimed: questStepsClaimed,
      // Season totals for leaderboard export
      seasonAnimalsSaved: seasonAnimalsSaved,
      bestSeasonTotal: bestSeasonTotal
      ,
      // Persist player ID for friend codes
      playerId: playerId
    };
    localStorage.setItem('extinctionEscapeState', JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save game state', e);
  }
}

// Load game state from localStorage and apply offline earnings
function loadGame() {
  try {
    const saved = localStorage.getItem('extinctionEscapeState');
    if (!saved) return;
    const state = JSON.parse(saved);
    if (!state) return;
    // Restore or generate a player ID for friend code functionality.  Try to
    // use the ID from the saved state; if absent, fall back to localStorage or
    // create a new one.  Store it back to localStorage for persistence.
    try {
      if (state.playerId) {
        playerId = state.playerId;
      } else {
        const storedId = localStorage.getItem('extinctionEscapePlayerId');
        playerId = storedId || generatePlayerId();
      }
      // Persist the player ID in both the save and a separate key
      localStorage.setItem('extinctionEscapePlayerId', playerId);
    } catch (e) {
      // If localStorage fails, still generate an ID for the session
      if (!playerId) {
        playerId = generatePlayerId();
      }
    }
    // Restore units
    state.unitsOwned.forEach((count, i) => {
      unitsOwned[i] = count;
    });
    state.nextCosts.forEach((cost, i) => {
      nextCosts[i] = cost;
    });
    // Restore upgrades and apply their effects
    state.upgradesOwned.forEach((count, i) => {
      upgradesOwned[i] = count;
    });
    state.upgradeCosts.forEach((cost, i) => {
      upgradeCosts[i] = cost;
    });
    globalRateBonus = state.globalRateBonus || 0;
    globalTimeReduction = state.globalTimeReduction || 0;
    globalAnimalBonus = state.globalAnimalBonus || 0;
    // Restore coins and animalsSaved after applying offline earnings
    coins = state.coins;
    animalsSaved = state.animalsSaved;
    // Compute offline time
    const now = Date.now();
    const lastSave = state.lastSave || now;
    let elapsed = (now - lastSave) / 1000; // seconds
    const capSeconds = 4 * 3600; // 4 hours cap
    if (elapsed < 0) elapsed = 0;
    const offlineTime = Math.min(elapsed, capSeconds);
    // Compute offline rate using restored units and upgrades
    let offlineRate = 0;
    unitsOwned.forEach((count, index) => {
      offlineRate += (count * unitDefinitions[index].baseRate) / 60;
    });
    offlineRate *= (1 + globalRateBonus + speciesRateBonus + permitRateBonus + eventRateBonus + achievementRateBonus);
    const offlineEarnings = offlineRate * offlineTime;
    coins += offlineEarnings;
    animalsSaved += offlineEarnings;
    // Offline earnings also contribute to the current season.  Update the
    // season tally accordingly and track any new high score.
    seasonAnimalsSaved += offlineEarnings;
    if (seasonAnimalsSaved > bestSeasonTotal) {
      bestSeasonTotal = seasonAnimalsSaved;
    }
    // Restore mission state
    currentMissionIndex = state.currentMissionIndex || 0;
    missionActive = state.missionActive || false;
    missionTimeLeft = state.missionTimeLeft || 0;
    animalsAtRisk = state.animalsAtRisk || 0;
    totalAnimalsForMission = state.totalAnimalsForMission || 0;
    missionsCompleted = state.missionsCompleted || 0;
    // Restore species saved
    if (state.speciesState) {
      state.speciesState.forEach(savedSp => {
        speciesList.forEach(sp => {
          if (sp.name === savedSp.name) {
            sp.saved = savedSp.saved;
          }
        });
      });
    }
    // After restoring species saved flags, recompute species bonuses
    updateSpeciesBonuses();
    // Restore tasksCompleted object
    if (state.tasksCompleted) {
      Object.keys(state.tasksCompleted).forEach(key => {
        tasksCompleted[key] = state.tasksCompleted[key];
      });
    }
    // Restore lastDailyBonusDate
    lastDailyBonusDate = state.lastDailyBonusDate || null;

    // Restore reserve counts if present
    if (state.reserveCounts) {
      reserveCounts = state.reserveCounts;
    }

    // Restore biomes unlocked
    if (state.biomesUnlocked) {
      Object.keys(state.biomesUnlocked).forEach(id => {
        biomesUnlocked[id] = state.biomesUnlocked[id];
      });
    }

    // ---- Restore Achievements and Questline ----
    if (state.achievementsCompleted) {
      Object.keys(state.achievementsCompleted).forEach(id => {
        achievementsCompleted[id] = state.achievementsCompleted[id];
      });
    }
    achievementRateBonus = state.achievementRateBonus || 0;
    achievementTimeReduction = state.achievementTimeReduction || 0;
    achievementAnimalBonus = state.achievementAnimalBonus || 0;
    currentQuestStep = state.currentQuestStep || 0;
    if (state.questStepsClaimed) {
      Object.keys(state.questStepsClaimed).forEach(idx => {
        questStepsClaimed[idx] = state.questStepsClaimed[idx];
      });
    }

    // Restore permit and prestige state
    permitsTotal = state.permitsTotal || 0;
    permitsAvailable = state.permitsAvailable || 0;
    // Restore lifetime animals saved (fallback to animalsSaved if not present)
    lifetimeAnimalsSaved = state.lifetimeAnimalsSaved !== undefined ? state.lifetimeAnimalsSaved : (state.animalsSaved || 0);
    if (state.permitUpgrades) {
      permitUpgrades.rate = state.permitUpgrades.rate || 0;
      permitUpgrades.animals = state.permitUpgrades.animals || 0;
      permitUpgrades.time = state.permitUpgrades.time || 0;
      permitUpgrades.map = state.permitUpgrades.map || 0;
    }
    if (state.permitUpgradeCosts) {
      // Restore next permit upgrade costs
      for (let i = 0; i < permitUpgradeCosts.length && i < state.permitUpgradeCosts.length; i++) {
        permitUpgradeCosts[i] = state.permitUpgradeCosts[i];
      }
    }
    // Restore active event if any
    if (state.activeEvent) {
      activeEvent = state.activeEvent;
    }

    // After restoring permit upgrades, compute permit bonuses for offline earnings
    applyPermitBonuses();

    // Restore season totals and best record.  If not present, default to zero.
    seasonAnimalsSaved = state.seasonAnimalsSaved !== undefined ? state.seasonAnimalsSaved : 0;
    bestSeasonTotal = state.bestSeasonTotal !== undefined ? state.bestSeasonTotal : 0;
    // After restoring season totals, update the display.  We update early
    // to ensure that the UI shows the correct values immediately on load.
    updateSeasonStatsUI();

    // After loading reserve counts and species, refresh the sanctuary cards view.
    // Guard against calling before the DOM elements exist by checking for updateCards
    try {
      if (typeof updateCards === 'function') {
        updateCards();
      }
    } catch (e) {
      // Silently ignore errors during early load when elements may not be ready
    }
  } catch (e) {
    console.error('Failed to load game state', e);
  }
}

// Get current date string in America/Chicago timezone (YYYY-MM-DD)
function getLocalDateString() {
  const options = { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Date().toLocaleDateString('en-CA', options); // returns YYYY-MM-DD
  return parts;
}

// Grant daily bonus if the user hasn't claimed it today
function grantDailyBonusIfNeeded() {
  const today = getLocalDateString();
  if (lastDailyBonusDate !== today) {
    // Grant daily bonus (e.g., 50 coins)
    const bonus = 50;
    coins += bonus;
    lastDailyBonusDate = today;
    // Show a simple notification to the user
    setTimeout(() => {
      alert(`Daily bonus: +${bonus} coins for returning!`);
    }, 500);
  }
}

// Tick function runs every second to accumulate animals and coins
function tick() {
  const rate = computeRescueRate();
  animalsSaved += rate;
  coins += rate; // 1 coin per animal saved
  // Track lifetime animals saved for prestige calculations
  lifetimeAnimalsSaved += rate;
  // Mission logic
  if (missionActive) {
    animalsAtRisk -= rate;
    if (animalsAtRisk < 0) animalsAtRisk = 0;
    missionTimeLeft -= 1;
    if (missionTimeLeft <= 0 || animalsAtRisk <= 0) {
      finishMission();
    } else {
      updateMissionUI();
    }
  }
  updateUI();
  updateTasksUI();
  updateUpgradesUI();
  // Update permits and prestige info
  updatePermitsUI();
  // Update world event countdown and handle expiration
  updateEventUI();
}

// Initialize the game
function init() {
  // Load saved state (including offline earnings and daily bonus tracking)
  loadGame();
  // Apply unlocked biomes to reconstruct species, units and missions before initializing UI
  applyUnlockedBiomes();
  // Initialize units, upgrades and permits shop
  initUnits();
  initUpgrades();
  initPermits();
  initBiomes();
  // Initialize achievements and questline
  initAchievements();
  initQuest();
  // Apply daily bonus if applicable
  grantDailyBonusIfNeeded();
  // Update UI to reflect loaded state
  updateUI();
  updateUpgradesUI();
  updateTasksUI();
  // Initialize and update sanctuary cards view instead of Safe Haven
  initCards();
  updateCards();
  updateAchievementsUI();
  updateQuestUI();
  // Apply permit bonuses after loading the game state
  applyPermitBonuses();
  // Initialize world events (load saved or start new)
  initEvent();
  // Update permits UI after computing bonuses and counts
  updatePermitsUI();
  // If there was an active mission, ensure mission UI displays correctly
  if (!missionActive) {
    // Start a mission if none was active
    startMission();
  } else {
    updateMissionUI();
  }
  // Set up the tick to run every second
  setInterval(() => {
    tick();
    // Periodically save the game state
    saveGame();
  }, 1000);
  // Manual rescue increments coins and animals directly
  manualBtn.addEventListener('click', () => {
    coins += 1;
    animalsSaved += 1;
    lifetimeAnimalsSaved += 1;
    // Manual rescues also reduce the current animals at risk if any mission is active
    if (animalsAtRisk > 0) {
      animalsAtRisk -= 1;
      if (animalsAtRisk < 0) animalsAtRisk = 0;
      updateMissionUI();
      if (missionTimeLeft <= 0 || animalsAtRisk <= 0) {
        finishMission();
      }
    }
    // Update season totals on each manual rescue.  Manual saves count toward
    // the current season.  If this pushes the current season above the
    // previous best, update the record.  Finally refresh the season UI.
    seasonAnimalsSaved += 1;
    if (seasonAnimalsSaved > bestSeasonTotal) {
      bestSeasonTotal = seasonAnimalsSaved;
    }
    updateSeasonStatsUI();
    updateUI();
    updateTasksUI();
    updateUpgradesUI();
    updatePermitsUI();
  });
  // Navigation buttons
  // Navigation events
  tabGameBtn.addEventListener('click', () => {
    // Show the game view
    gameView.classList.remove('hidden');
    havenView.classList.add('hidden');
    changelogView.classList.add('hidden');
    // Set active button
    tabGameBtn.classList.add('active');
    tabHavenBtn.classList.remove('active');
    if (tabChangelogBtn) tabChangelogBtn.classList.remove('active');
  });
  tabHavenBtn.addEventListener('click', () => {
    // Show the sanctuary cards view
    havenView.classList.remove('hidden');
    gameView.classList.add('hidden');
    changelogView.classList.add('hidden');
    // Update the cards and season stats on entering
    updateCards();
    updateSeasonStatsUI();
    // Set active button
    tabHavenBtn.classList.add('active');
    tabGameBtn.classList.remove('active');
    if (tabChangelogBtn) tabChangelogBtn.classList.remove('active');
  });
  if (tabChangelogBtn) {
    tabChangelogBtn.addEventListener('click', () => {
      // Show changelog
      changelogView.classList.remove('hidden');
      gameView.classList.add('hidden');
      havenView.classList.add('hidden');
      // Populate changelog entries
      initChangelog();
      // Set active button
      tabChangelogBtn.classList.add('active');
      tabGameBtn.classList.remove('active');
      tabHavenBtn.classList.remove('active');
    });
  }
  // Attach event listener for exporting the sanctuary cards as an image
  const saveSanctuaryBtn = document.getElementById('save-sanctuary-image');
  if (saveSanctuaryBtn) {
    saveSanctuaryBtn.addEventListener('click', saveSanctuaryImage);
  }
  // Friend code buttons
  const exportBtn = document.getElementById('export-friend-code');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportFriendCode);
  }
  const importBtn = document.getElementById('import-friend-code');
  if (importBtn) {
    importBtn.addEventListener('click', importFriendCode);
  }
  // Tip link buttons
  if (setTipLinkBtn) {
    setTipLinkBtn.addEventListener('click', () => {
      const link = tipLinkInput ? tipLinkInput.value.trim() : '';
      if (link) {
        saveTipLink(link);
        tipLinkInput.value = '';
      }
    });
  }
  if (supportBtn) {
    supportBtn.addEventListener('click', () => {
      if (tipLink) {
        window.open(tipLink, '_blank');
      }
    });
  }
  // Load any saved tip link and update UI
  loadTipLink();

  // Install app button click handler
  if (installAppBtn) {
    installAppBtn.addEventListener('click', () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
          deferredPrompt = null;
          installAppBtn.classList.add('hidden');
        });
      }
    });
  }
  // Sanctuary tab navigation (formerly reserve) is removed.  If the element
  // exists, do not attach any event listener to avoid errors.
  // Save game on unload
  window.addEventListener('beforeunload', () => {
    saveGame();
  });

  // The sanctuary diorama has been removed; cards are initialized above.
}

// ==== PWA install prompt handling ====
// Listen for the beforeinstallprompt event and store the event until the user
// clicks the Install App button.  Showing the button allows users to add
// the web app to their home screen on supported browsers.  When the app
// is installed, hide the button.
window.addEventListener('beforeinstallprompt', (event) => {
  // Prevent the mini-infobar from appearing on mobile
  event.preventDefault();
  deferredPrompt = event;
  // Show the install button
  if (installAppBtn) {
    installAppBtn.classList.remove('hidden');
  }
});

window.addEventListener('appinstalled', () => {
  // Clear the saved prompt and hide the install button
  deferredPrompt = null;
  if (installAppBtn) {
    installAppBtn.classList.add('hidden');
  }
});

// ----- Sanctuary cards export helper functions -----

/**
 * Draw a rounded rectangle on a canvas context.  Used by saveSanctuaryImage
 * to render card backgrounds.  Adapted from MDN examples.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number|Object} radius
 * @param {boolean} fill
 * @param {boolean} stroke
 */
function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  let r = radius;
  if (typeof r === 'number') {
    r = { tl: r, tr: r, br: r, bl: r };
  } else {
    const defaultRadius = { tl: 0, tr: 0, br: 0, bl: 0 };
    for (let side in defaultRadius) {
      r[side] = r[side] || defaultRadius[side];
    }
  }
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + width - r.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r.tr);
  ctx.lineTo(x + width, y + height - r.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r.br, y + height);
  ctx.lineTo(x + r.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

/**
 * Wrap a given text into multiple lines to fit within a maximum width.
 * Returns an array of lines.  Each line will not exceed the maxWidth when
 * rendered with the current context font.  If maxLines is provided and
 * exceeded, the remaining text is concatenated into the last line.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} maxLines
 * @returns {string[]}
 */
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = (text || '').split(' ');
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const testLine = line + (line ? ' ' : '') + words[i];
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && line) {
      lines.push(line);
      line = words[i];
      if (maxLines && lines.length >= maxLines - 1) {
        // Put remaining words on one line
        line = words.slice(i).join(' ');
        break;
      }
    } else {
      line = testLine;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Save the current Sanctuary cards view as a PNG image.  This function
 * synthesizes a new canvas replicating the cards layout, species counts,
 * bonuses and season statistics.  It does not capture the DOM; instead it
 * redraws the cards from game data.  The exported image includes a header
 * and a summary line showing the current and best season totals.
 */
function saveSanctuaryImage() {
  try {
    // Determine the list of species to render. Include species from the
    // main speciesList and any reserveCounts keys not already present.
    const speciesSet = new Set();
    speciesList.forEach(sp => speciesSet.add(sp.name));
    Object.keys(reserveCounts).forEach(name => {
      if (!speciesSet.has(name)) {
        speciesSet.add(name);
      }
    });
    // Convert to array for consistent ordering. Sort alphabetically.
    const allSpecies = Array.from(speciesSet).sort();
    const count = allSpecies.length;
    // Determine layout
    const container = document.getElementById('cards-container');
    const containerWidth = container ? container.clientWidth : 800;
    const cardW = 160;
    const cardH = 130;
    const gap = 15;
    const padding = 20;
    // Estimate number of columns based on container width. At minimum 1 column.
    const columns = Math.max(1, Math.floor((containerWidth + gap) / (cardW + gap)));
    const rows = Math.ceil(count / columns);
    const headerHeight = 80;
    const statsHeight = 40;
    const canvasW = columns * (cardW + gap) - gap + padding * 2;
    const canvasH = headerHeight + statsHeight + rows * (cardH + gap) - gap + padding * 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    // Background
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvasW, canvasH);
    // Header text
    ctx.fillStyle = '#333';
    ctx.font = 'bold 28px Arial';
    const headerText = 'Sanctuary';
    const headerWidth = ctx.measureText(headerText).width;
    ctx.fillText(headerText, (canvasW - headerWidth) / 2, padding + 30);
    // Tagline
    ctx.font = '16px Arial';
    ctx.fillStyle = '#666';
    const tagline = 'Rescued species and progress';
    const taglineWidth = ctx.measureText(tagline).width;
    ctx.fillText(tagline, (canvasW - taglineWidth) / 2, padding + 58);
    // Season stats (top-right)
    ctx.font = '14px Arial';
    ctx.fillStyle = '#333';
    const seasonStr = `Season saved: ${Math.floor(seasonAnimalsSaved)}  (Best: ${Math.floor(bestSeasonTotal)})`;
    const seasonWidth = ctx.measureText(seasonStr).width;
    const seasonX = canvasW - padding - seasonWidth;
    const seasonY = padding + 26;
    ctx.fillText(seasonStr, seasonX, seasonY);
    // If the current season is the best (and non-zero), draw a "Best Reserve" badge near the season stats
    if (seasonAnimalsSaved > 0 && seasonAnimalsSaved >= bestSeasonTotal) {
      const label = 'Best Reserve';
      ctx.font = 'bold 12px Arial';
      const labelWidth = ctx.measureText(label).width;
      const badgePaddingX = 8;
      const badgePaddingY = 4;
      const badgeW = labelWidth + badgePaddingX * 2;
      const badgeH = 22;
      // Position badge to the left of the season stats line, or above if not enough space
      let badgeX = seasonX - badgeW - 10;
      let badgeY = seasonY - badgeH + 6;
      if (badgeX < padding) {
        // Move to next line below season stats if space is tight
        badgeX = canvasW - padding - badgeW;
        badgeY = seasonY + 6;
      }
      // Draw badge background
      ctx.fillStyle = '#ffc107';
      ctx.strokeStyle = '#d39e00';
      ctx.lineWidth = 1;
      roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 6, true, true);
      // Badge text
      ctx.fillStyle = '#333';
      ctx.fillText(label, badgeX + badgePaddingX, badgeY + badgeH - badgePaddingY);
    }
    // Draw cards
    for (let i = 0; i < count; i++) {
      const spName = allSpecies[i];
      const row = Math.floor(i / columns);
      const col = i % columns;
      const x = padding + col * (cardW + gap);
      const y = headerHeight + statsHeight + padding + row * (cardH + gap);
      // Card background
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, cardW, cardH, 8, true, true);
      // Determine saved count
      const countSaved = reserveCounts[spName] || 0;
      const saved = countSaved > 0;
      // Colored circle
      const circleR = 12;
      ctx.fillStyle = speciesColors[spName] || '#888';
      ctx.beginPath();
      ctx.arc(x + 15, y + 25, circleR, 0, Math.PI * 2);
      ctx.fill();
      // Species name
      ctx.fillStyle = '#333';
      ctx.font = 'bold 14px Arial';
      ctx.fillText(spName, x + 35, y + 25 + 5);
      // Saved count
      ctx.font = '12px Arial';
      ctx.fillStyle = saved ? '#333' : '#999';
      ctx.fillText(`Saved: ${countSaved}`, x + 35, y + 25 + 25);
      // Bonus text: find in speciesList or biomes
      let bonusText = '';
      for (let sp of speciesList) {
        if (sp.name === spName) {
          bonusText = sp.bonus;
          break;
        }
      }
      if (!bonusText) {
        // search in unlocked biomes
        for (const biomeId in biomesUnlocked) {
          if (biomesUnlocked[biomeId]) {
            const biomeDef = biomeDefinitions.find(b => b.id === biomeId);
            if (biomeDef) {
              const found = biomeDef.species.find(s => s.name === spName);
              if (found) {
                bonusText = found.bonus;
                break;
              }
            }
          }
        }
      }
      ctx.font = '12px Arial';
      ctx.fillStyle = '#666';
      const lines = wrapText(ctx, bonusText, cardW - 35, 3);
      let lineY = y + 25 + 40;
      for (let line of lines) {
        ctx.fillText(line, x + 35, lineY);
        lineY += 15;
      }
      // If locked, draw a semi-transparent overlay
      if (!saved) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(x, y, cardW, cardH);
      }
    }
    // Footer
    ctx.font = '12px Arial';
    ctx.fillStyle = '#999';
    const footer = 'Extinction Escape • Sanctuary Snapshot';
    const footerWidth = ctx.measureText(footer).width;
    ctx.fillText(footer, (canvasW - footerWidth) / 2, canvasH - 10);
    // Trigger download
    canvas.toBlob(function(blob) {
      if (!blob) {
        alert('Could not generate image.');
        return;
      }
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      a.download = `Sanctuary-${date}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  } catch (e) {
    console.error(e);
    alert('An error occurred while saving the sanctuary image.');
  }
}

/* === Friend Code Helpers === */

/**
 * Generate a random player ID.  The ID is a simple base36 string and is
 * stored in localStorage so that the same ID persists across sessions.  If
 * an ID already exists in localStorage, it is reused.
 */
function generatePlayerId() {
  // Try to get an existing ID from localStorage
  try {
    const stored = localStorage.getItem('extinctionEscapePlayerId');
    if (stored) {
      return stored;
    }
  } catch (_) {
    // ignore errors reading localStorage
  }
  // Create a new random ID: 10-character base36 string
  let id = '';
  // Use crypto API if available for better randomness
  if (window.crypto && window.crypto.getRandomValues) {
    const array = new Uint32Array(2);
    window.crypto.getRandomValues(array);
    id = (array[0].toString(36) + array[1].toString(36)).substr(0, 10);
  } else {
    id = Math.random().toString(36).substr(2, 10);
  }
  try {
    localStorage.setItem('extinctionEscapePlayerId', id);
  } catch (_) {
    // ignore errors writing to localStorage
  }
  return id;
}

/**
 * Construct a friend code representing this player's best season total.  The
 * code is a base64-encoded JSON string containing the player ID and best
 * season total.  This keeps the format human-readable but not obvious.
 */
function getFriendCode() {
  const data = { id: playerId, best: bestSeasonTotal || 0 };
  const json = JSON.stringify(data);
  // btoa may throw if string contains non-ASCII characters; all keys are ASCII
  try {
    return btoa(json);
  } catch (e) {
    // Fallback: encode URI components
    return btoa(unescape(encodeURIComponent(json)));
  }
}

/**
 * Export this player's friend code.  The code is copied to the clipboard if
 * possible and also displayed in an alert for manual copying.
 */
function exportFriendCode() {
  const code = getFriendCode();
  // Try to write to clipboard; if not available, fallback to prompt
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(() => {
      alert('Your friend code has been copied to the clipboard.\n\nShare it with a friend so they can compare their best season total!');
    }).catch(() => {
      // Fallback to prompt if clipboard write fails
      prompt('Copy this friend code and share it with a friend:', code);
    });
  } else {
    prompt('Copy this friend code and share it with a friend:', code);
  }
}

/**
 * Import a friend code from the input field and compare the friend’s best
 * season total against the player’s own.  Displays a friendly message
 * indicating who has rescued more animals in a single season.
 */
function importFriendCode() {
  const input = document.getElementById('friend-code-input');
  if (!input) {
    alert('Friend code input not found.');
    return;
  }
  const code = (input.value || '').trim();
  if (!code) {
    alert('Please enter a friend code to compare.');
    return;
  }
  let friendBest = 0;
  try {
    let decoded = '';
    try {
      decoded = atob(code);
    } catch (e) {
      // If direct decoding fails, try decodeURIComponent as fallback
      decoded = decodeURIComponent(escape(atob(code)));
    }
    const data = JSON.parse(decoded);
    if (data && typeof data.best === 'number' && data.best >= 0) {
      friendBest = Math.floor(data.best);
    } else {
      throw new Error('Invalid data');
    }
  } catch (e) {
    alert('Invalid friend code.\nPlease make sure you entered it correctly.');
    return;
  }
  const ourBest = Math.floor(bestSeasonTotal) || 0;
  let message;
  if (friendBest > ourBest) {
    message = `Your friend\u2019s best season saved ${friendBest} animals. That’s more than your record of ${ourBest}! Time to rescue more!`;
  } else if (friendBest < ourBest) {
    message = `You’re ahead! Your best season saved ${ourBest} animals, while your friend saved ${friendBest}.`;
  } else {
    message = `It’s a tie! Both you and your friend have saved ${ourBest} animals in your best seasons.`;
  }
  alert(message);
}

// Start the game after DOM is ready
document.addEventListener('DOMContentLoaded', init);