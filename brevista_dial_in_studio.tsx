import React, { useState, useEffect } from 'react';

export default function App() {
  // Coffee Profile State
  const [roasterName, setRoasterName] = useState('');
  const [coffeeName, setCoffeeName] = useState('');
  const [roastLevel, setRoastLevel] = useState('medium');

  // Shot Mechanics State
  const [doseIn, setDoseIn] = useState(18);
  const [yieldOut, setYieldOut] = useState(36);
  const [grindSetting, setGrindSetting] = useState('15');
  const [shotTime, setShotTime] = useState(28);
  const [brewTemp, setBrewTemp] = useState('medium');
  const [burrType, setBurrType] = useState('conical');
  const [puckPrep, setPuckPrep] = useState('wdt_tamp');
  const [puckScreen, setPuckScreen] = useState(false);

  // Taste Feedback State (Set of selected tasting notes)
  const [selectedNotes, setSelectedNotes] = useState(new Set());

  // Results State
  const [diagnosis, setDiagnosis] = useState(null);

  // Taste Dictionary
  const TasteDictionary = {
    extraction: {
      under: ['sour', 'sharp', 'lemon', 'vegetal', 'salty', 'vinegar'],
      over: ['bitter', 'ashy', 'dry', 'burnt', 'astringent', 'medicinal']
    },
    balanced: {
      light: ['berry', 'citrus', 'floral', 'jasmine', 'tropical', 'tea-like'],
      medium: ['chocolate', 'caramel', 'honey', 'vanilla', 'nuts', 'malty'],
      dark: ['chocolate', 'caramel', 'vanilla', 'nuts', 'malty', 'buttery']
    },
    body: {
      weak: ['watery', 'thin'],
      optimal: ['medium', 'syrupy'], // Syrupy is ideal, registers neutral body score
      heavy: ['heavy', 'overpowering']
    },
    isNoteInCategory: function(note, categoryArray) {
      return categoryArray.includes(note.toLowerCase());
    }
  };

  const getNotesForRoast = (roast) => {
    return TasteDictionary.balanced[roast] || TasteDictionary.balanced.medium;
  };

  const toggleNote = (note) => {
    const updated = new Set(selectedNotes);
    if (updated.has(note)) {
      updated.delete(note);
    } else {
      updated.add(note);
    }
    setSelectedNotes(updated);
  };

  const analyzeShot = () => {
    if (selectedNotes.size === 0) {
      alert("Please select at least one taste note to diagnose the shot.");
      return;
    }

    const notesArray = Array.from(selectedNotes);

    // 1. Scoring Engine
    let underScore = 0;
    let overScore = 0;
    let balancedScore = 0;
    let bodyScore = 0;

    const balancedNotes = getNotesForRoast(roastLevel);

    notesArray.forEach(note => {
      const lower = note.toLowerCase();
      if (TasteDictionary.isNoteInCategory(lower, TasteDictionary.extraction.under)) underScore++;
      if (TasteDictionary.isNoteInCategory(lower, TasteDictionary.extraction.over)) overScore++;
      if (TasteDictionary.isNoteInCategory(lower, balancedNotes)) balancedScore++;

      if (TasteDictionary.isNoteInCategory(lower, TasteDictionary.body.weak)) bodyScore--;
      if (TasteDictionary.isNoteInCategory(lower, TasteDictionary.body.heavy)) bodyScore++;
    });

    const extractionIndex = balancedScore - (underScore + overScore);

    // 2. Channeling Engine
    let channelingScore = 0;
    let specificContradictions = [];

    if (underScore > 0 && overScore > 0) {
      channelingScore += (underScore + overScore);
    }

    const hasSour = notesArray.some(n => ['sour', 'sharp', 'vinegar', 'lemon'].includes(n));
    const hasBitter = notesArray.some(n => ['bitter', 'dry', 'ashy', 'burnt'].includes(n));
    const hasVegetal = notesArray.includes('vegetal');
    const hasAshy = notesArray.includes('ashy');

    if (hasSour && hasBitter) {
      specificContradictions.push('Sour + Bitter');
      channelingScore += 2;
    }
    if (hasVegetal && hasAshy) {
      specificContradictions.push('Vegetal + Ashy');
      channelingScore += 2;
    }

    const isChanneling = channelingScore >= 2;

    // 3. Recommendation Engine (Priority Ladder)
    let recs = [];

    // Priority 1: Channeling
    if (isChanneling) {
      if (puckPrep === 'shaker_wdt_tamp') {
        recs.push({
          priority: 1,
          category: 'Grinder / Prep',
          action: 'Slow Feed Grinder',
          details: `Contradictory flavors detected (${specificContradictions.join(', ') || 'Mixed extraction signals'}). Your puck prep is already maxed out. Slow-feed beans into your hopper to reduce micro-fines and prevent channeling.`
        });
      } else {
        recs.push({
          priority: 1,
          category: 'Puck Prep',
          action: 'Improve Density & Distribution',
          details: `Channeling detected (${specificContradictions.join(', ') || 'Mixed extraction signals'}). Water is finding the path of least resistance. Use WDT or a Blind Shaker and ensure a level tamp before changing grind size.`
        });
      }
    } else {
      // Dark Roast / Commodity Exception Logic
      if (roastLevel === 'dark' && overScore > 0) {
        recs.push({
          priority: 2,
          category: 'Yield',
          action: 'Shorten Ratio (Ristretto)',
          details: 'Dark roasts extract fast and bitter plant fibers dissolve easily. Stop the shot earlier (e.g., 1:1.25 ratio) to amputate the bitter tail-end.'
        });
        recs.push({
          priority: 3,
          category: 'Grind',
          action: 'Grind Coarser',
          details: 'Coarsening the grind speeds up flow and prevents harsh, drying over-extraction.'
        });
        if (brewTemp !== 'low') {
          recs.push({
            priority: 4,
            category: 'Temperature',
            action: 'Lower Temperature',
            details: 'High heat pulls ashy flavors from dark roasts. Drop your machine temperature to 91°C or lower.'
          });
        }
      } else {
        // Standard Extraction Index Logic
        if (extractionIndex < 0) {
          if (underScore > overScore) {
            recs.push({
              priority: 2,
              category: 'Grind',
              action: 'Grind Finer',
              details: 'Increases surface area and contact time to pull out more sweetness and balance the sour acidity.'
            });
            if (bodyScore > 0) {
              recs.push({
                priority: 3,
                category: 'Yield',
                action: 'Increase Yield (Ratio)',
                details: 'Your shot is thick but under-extracted. Pull a slightly longer shot (more water) to extract sweetness.'
              });
            }
          } else if (overScore > underScore) {
            recs.push({
              priority: 2,
              category: 'Grind',
              action: 'Grind Coarser',
              details: 'Speeds up the flow to prevent the water from extracting bitter plant fibers.'
            });
            if (bodyScore < 0) {
              recs.push({
                priority: 3,
                category: 'Yield',
                action: 'Decrease Yield (Ratio)',
                details: 'Pull a shorter shot to cut it off before the bitter tail-end dilutes the body.'
              });
            }
          }
        }

        // Body / Concentration Fixes
        if (extractionIndex >= 0 && bodyScore !== 0) {
          if (bodyScore < 0) {
            recs.push({
              priority: 3,
              category: 'Yield / Dose',
              action: 'Decrease Yield or Up Dose',
              details: 'Taste is balanced but the body is watery. Pull slightly less liquid, or increase your dose by 0.5g for more concentration.'
            });
          } else if (bodyScore > 0) {
            recs.push({
              priority: 3,
              category: 'Yield',
              action: 'Increase Yield',
              details: 'The shot is overpowering and muddy. Push a little more water through to open up the flavors and lighten the texture.'
            });
          }
        }

        // Temperature Tweaks
        if (roastLevel === 'light' && underScore > 0 && brewTemp !== 'high') {
          recs.push({
            priority: 4,
            category: 'Temperature',
            action: 'Increase Temperature',
            details: 'Light roasts are dense. High heat (93°C+) is required to extract stubborn fruity/floral notes.'
          });
        }
      }

      // Burr Type Hardware Adaptations
      if (burrType === 'flat' && bodyScore < 0) {
        recs.push({
          priority: 5,
          category: 'Hardware Profile',
          action: 'Expect Less Texture',
          details: 'Flat burrs excel at sharp flavor clarity but inherently produce less velvety body than conical burrs. A slightly thinner mouthfeel is normal if flavor is balanced.'
        });
      } else if (burrType === 'conical' && roastLevel === 'light' && underScore > 0) {
        recs.push({
          priority: 5,
          category: 'Hardware Profile',
          action: 'Clarity Limits',
          details: 'Conical burrs create great texture but tend to blend flavors together. If you are struggling to get sharp fruit clarity from this light roast, you may be hitting your burr limits.'
        });
      }
    }

    // Success Fallback
    if (recs.length === 0) {
      recs.push({
        priority: 1,
        category: 'Success',
        action: 'Lock it in!',
        details: 'Your Extraction Index is perfectly balanced. Save this recipe in your logbook.'
      });
    }

    recs.sort((a, b) => a.priority - b.priority);

    setDiagnosis({
      extractionIndex,
      bodyScore,
      isChanneling,
      ratio: doseIn && yieldOut ? `1:${(yieldOut / doseIn).toFixed(1)}` : 'N/A',
      grindSetting: grindSetting || '-',
      recommendations: recs
    });
  };

  const resetForm = () => {
    setSelectedNotes(new Set());
    setDiagnosis(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#333333] flex flex-col font-sans selection:bg-[#3E1F47] selection:text-white pb-20">
      {/* Header */}
      <header className="w-full bg-white border-b border-gray-200 sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <svg className="w-8 h-8 text-[#3E1F47]" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 14H32C32 14 30 26 20 26C10 26 8 14 8 14Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="14" y1="26" x2="14" y2="31" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="26" y1="26" x2="26" y2="31" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M20 31C18 34 22 36 20 38" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M12 9H28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span className="text-xl font-bold tracking-tight text-[#3E1F47]" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            Bre<span className="font-semibold">Vista</span> <span className="text-gray-400 font-normal">Studio</span>
          </span>
        </div>
        <div className="text-xs font-semibold uppercase tracking-widest bg-gray-100 px-3 py-1 rounded-md text-[#777777]">
          Flavor-Driven Dial-In
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 mt-8 space-y-8">
        <div className="text-center space-y-2 mb-6">
          <h2 className="text-3xl font-extrabold text-[#3E1F47]">Dial-In Studio</h2>
          <p className="text-[#777777] text-sm">Taste is the ultimate metric. Log your shot parameters and feedback below.</p>
        </div>

        {/* Section 1: Coffee Profile */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-lg font-bold text-[#3E1F47] border-b border-gray-100 pb-2">1. Coffee Profile</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Roaster Name</label>
              <input 
                type="text" 
                value={roasterName} 
                onChange={(e) => setRoasterName(e.target.value)}
                placeholder="e.g. Onyx" 
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Coffee Name</label>
              <input 
                type="text" 
                value={coffeeName} 
                onChange={(e) => setCoffeeName(e.target.value)}
                placeholder="e.g. Monarch" 
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Roast Level</label>
              <select 
                value={roastLevel} 
                onChange={(e) => setRoastLevel(e.target.value)}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              >
                <option value="medium">Medium</option>
                <option value="light">Light</option>
                <option value="dark">Dark / Supermarket</option>
              </select>
            </div>
          </div>
        </section>

        {/* Section 2: Mechanics & Hardware */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-lg font-bold text-[#3E1F47] border-b border-gray-100 pb-2">2. Shot Mechanics</h3>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Dose In (g)</label>
              <input 
                type="number" 
                step="0.1" 
                value={doseIn} 
                onChange={(e) => setDoseIn(parseFloat(e.target.value))}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Yield Out (g)</label>
              <input 
                type="number" 
                step="0.1" 
                value={yieldOut} 
                onChange={(e) => setYieldOut(parseFloat(e.target.value))}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Grind Setting (Ref)</label>
              <input 
                type="text" 
                value={grindSetting} 
                onChange={(e) => setGrindSetting(e.target.value)}
                placeholder="e.g. 15" 
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Time (sec)</label>
              <input 
                type="number" 
                value={shotTime} 
                onChange={(e) => setShotTime(parseInt(e.target.value))}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Brew Temp</label>
              <select 
                value={brewTemp} 
                onChange={(e) => setBrewTemp(e.target.value)}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              >
                <option value="low">Low (91°C-)</option>
                <option value="medium">Medium (Default)</option>
                <option value="high">High (93°C+)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Burr Type</label>
              <select 
                value={burrType} 
                onChange={(e) => setBurrType(e.target.value)}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              >
                <option value="conical">Conical (More Body)</option>
                <option value="flat">Flat (Higher Clarity)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
            <div>
              <label className="block text-xs font-bold text-[#777777] uppercase mb-1">Puck Prep Method</label>
              <select 
                value={puckPrep} 
                onChange={(e) => setPuckPrep(e.target.value)}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3E1F47]"
              >
                <option value="tamp">Grind & Tamp</option>
                <option value="wdt_tamp">WDT + Tamp</option>
                <option value="shaker_tamp">Blind Shaker + Tamp</option>
                <option value="shaker_wdt_tamp">Blind Shaker + WDT + Tamp</option>
              </select>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-xl mt-5 md:mt-0">
              <span className="text-sm font-semibold text-gray-700">Using Puck Screen?</span>
              <input 
                type="checkbox" 
                checked={puckScreen} 
                onChange={(e) => setPuckScreen(e.target.checked)}
                className="w-5 h-5 text-[#3E1F47] rounded focus:ring-[#3E1F47] cursor-pointer"
              />
            </div>
          </div>
        </section>

        {/* Section 3: Taste Diagnostics */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-6">
          <div className="flex justify-between items-end border-b border-gray-100 pb-2">
            <h3 className="text-lg font-bold text-[#3E1F47]">3. Taste Feedback</h3>
            <span className="text-xs text-[#777777] font-semibold uppercase">Select all that apply</span>
          </div>

          {/* Under-Extracted */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider">Acidity / Under-Extracted</h4>
            <div className="flex flex-wrap gap-2">
              {TasteDictionary.extraction.under.map(note => (
                <button
                  key={note}
                  onClick={() => toggleNote(note)}
                  className={`px-4 py-2 rounded-full border text-sm font-semibold transition-all ${
                    selectedNotes.has(note)
                      ? 'bg-[#3E1F47] text-white border-[#3E1F47] shadow-sm scale-95'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 shadow-xs'
                  }`}
                >
                  {note.charAt(0).toUpperCase() + note.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Over-Extracted */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider">Bitterness / Over-Extracted</h4>
            <div className="flex flex-wrap gap-2">
              {TasteDictionary.extraction.over.map(note => (
                <button
                  key={note}
                  onClick={() => toggleNote(note)}
                  className={`px-4 py-2 rounded-full border text-sm font-semibold transition-all ${
                    selectedNotes.has(note)
                      ? 'bg-[#3E1F47] text-white border-[#3E1F47] shadow-sm scale-95'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 shadow-xs'
                  }`}
                >
                  {note.charAt(0).toUpperCase() + note.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Sweet Spot / Balanced */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-green-600 uppercase tracking-wider">Sweet Spot (Roast Specific)</h4>
            <div className="flex flex-wrap gap-2">
              {getNotesForRoast(roastLevel).map(note => (
                <button
                  key={note}
                  onClick={() => toggleNote(note)}
                  className={`px-4 py-2 rounded-full border text-sm font-semibold transition-all ${
                    selectedNotes.has(note)
                      ? 'bg-[#3E1F47] text-white border-[#3E1F47] shadow-sm scale-95'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 shadow-xs'
                  }`}
                >
                  {note.charAt(0).toUpperCase() + note.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Texture & Body */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-purple-600 uppercase tracking-wider">Texture & Body</h4>
            <div className="flex flex-wrap gap-2">
              {[...TasteDictionary.body.weak, ...TasteDictionary.body.optimal, ...TasteDictionary.body.heavy].map(note => (
                <button
                  key={note}
                  onClick={() => toggleNote(note)}
                  className={`px-4 py-2 rounded-full border text-sm font-semibold transition-all ${
                    selectedNotes.has(note)
                      ? 'bg-[#3E1F47] text-white border-[#3E1F47] shadow-sm scale-95'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 shadow-xs'
                  }`}
                >
                  {note.charAt(0).toUpperCase() + note.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Action Button */}
        <button 
          onClick={analyzeShot}
          className="w-full bg-[#3E1F47] text-white font-bold text-lg py-4 rounded-2xl shadow-md hover:bg-opacity-95 transition-all active:scale-95"
        >
          Diagnose Shot
        </button>

        {/* Results Panel */}
        {diagnosis && (
          <section className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl border-2 border-[#3E1F47] space-y-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <h3 className="text-2xl font-extrabold text-[#3E1F47]">Diagnostic Report</h3>
              <div>
                {diagnosis.isChanneling ? (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">
                    CRITICAL: CHANNELING
                  </span>
                ) : diagnosis.extractionIndex > 0 ? (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">
                    BALANCED EXTRACTION
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700 border border-yellow-200">
                    UNBALANCED EXTRACTION
                  </span>
                )}
              </div>
            </div>

            {/* Metrics Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-200 text-sm">
              <div>
                <div className="text-[10px] uppercase font-bold text-[#777777]">Ext Index</div>
                <div className="text-lg font-bold text-[#3E1F47]">{diagnosis.extractionIndex}</div>
              </div>
              <div className="border-l pl-3 border-gray-200">
                <div className="text-[10px] uppercase font-bold text-[#777777]">Body Score</div>
                <div className="text-lg font-bold text-[#3E1F47]">{diagnosis.bodyScore > 0 ? `+${diagnosis.bodyScore}` : diagnosis.bodyScore}</div>
              </div>
              <div className="border-l pl-3 border-gray-200">
                <div className="text-[10px] uppercase font-bold text-[#777777]">Ratio</div>
                <div className="text-lg font-bold text-[#3E1F47]">{diagnosis.ratio}</div>
              </div>
              <div className="border-l pl-3 border-gray-200">
                <div className="text-[10px] uppercase font-bold text-[#777777]">Grind Ref</div>
                <div className="text-lg font-bold text-[#3E1F47]">{diagnosis.grindSetting}</div>
              </div>
            </div>

            {/* Recommendations List */}
            <div className="space-y-3">
              <h4 className="font-bold text-[#333333] text-sm uppercase tracking-wider">Recommended Adjustments</h4>
              {diagnosis.recommendations.map((rec, idx) => (
                <div 
                  key={idx} 
                  className={`p-4 rounded-2xl border ${rec.category === 'Success' ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 shadow-xs'}`}
                >
                  <div className="text-[10px] font-bold text-[#777777] uppercase tracking-wider mb-0.5">{idx + 1}. {rec.category}</div>
                  <h5 className="text-base font-bold text-[#333333] mb-1">{rec.action}</h5>
                  <p className="text-sm text-[#777777] leading-relaxed">{rec.details}</p>
                </div>
              ))}
            </div>

            <button 
              onClick={resetForm}
              className="w-full bg-gray-100 text-[#333333] font-semibold py-3.5 rounded-2xl hover:bg-gray-200 transition-colors"
            >
              Log New Shot
            </button>
          </section>
        )}
      </main>

      <footer className="w-full text-center py-6 text-xs text-[#777777] border-t border-gray-200 bg-white mt-auto">
        Brevista Flavor-Driven Engine &copy; 2026. All rights reserved.
      </footer>
    </div>
  );
}