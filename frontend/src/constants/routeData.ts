// A list of coordinates representing the "Duan-Mao" optimized path (DMV area)
export const AMBULANCE_ROUTE = [
  { lat: 38.8977, lng: -77.0065, isPivot: true },  // Union Station (MVA start)
  { lat: 38.9015, lng: -77.0200, isPivot: false },
  { lat: 38.9080, lng: -77.0350, isPivot: true },  // Pivot Node
  { lat: 38.9120, lng: -77.0500, isPivot: false },
  { lat: 38.9185, lng: -77.0195, isPivot: true }   // Howard University Hospital (Goal)
];