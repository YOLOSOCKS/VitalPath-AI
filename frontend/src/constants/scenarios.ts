export const SCENARIOS = {
  CARDIAC_ARREST: {
    title: "CODE 4 // CARDIAC ARREST",
    isRedAlert: true,
    vitals: { hr: 0, bp: { sys: 0, dia: 0 }, spO2: 70 },
    dispatch: "Cardiac arrest, CPR in progress. Priority transport.",
    aiPrompt: "Confirmed Cardiac Arrest. Recommend immediate LUCAS deployment and ACLS protocol.",
    location: { lat: 38.9072, lng: -77.0369 } // DC center (DMV area)
  },
  TRAUMA_MVA: {
    title: "CODE 3 // MAJOR TRAUMA",
    isRedAlert: true,
    vitals: { hr: 135, bp: { sys: 85, dia: 50 }, spO2: 88 },
    dispatch: "UNIT 992: MVA AT MAJOR MAC/404. MULTIPLE VICTIMS. HEMORRHAGIC SHOCK.",
    aiPrompt: "Blunt force trauma detected. Initiate rapid fluid bolus and request level 1 trauma center bypass.",
    location: { lat: 38.8977, lng: -77.0065 } // Union Station area (DMV)
  }
};