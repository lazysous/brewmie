// ─── Navigation ───────────────────────────────────────────────────────────────

export type AppTab = 'setup' | 'brew' | 'insights'

// ─── Enumerations ─────────────────────────────────────────────────────────────

export type TampType = 'manual' | 'spring' | 'automatic'

export type Units = 'metric' | 'imperial'

export type RoastLevel = 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark'

export type MachineBrand =
  | 'Breville'
  | 'De\'Longhi'
  | 'Rancilio'
  | 'La Marzocco'
  | 'Rocket'
  | 'ECM'
  | 'Profitec'
  | 'Lelit'
  | 'Gaggia'
  | 'Jura'
  | 'Nespresso'
  | 'Other'

export type GrinderType = 'flat-burr' | 'conical-burr' | 'blade'

// ─── Configuration types ───────────────────────────────────────────────────────

export interface BeanConfig {
  brand: string
  type: string           // e.g. "Single Origin", "Blend", "Espresso"
  roastDate: string | null  // ISO date string
  roastLevel: RoastLevel
  beanAge: number | null    // days since roast
}

export interface MachineConfig {
  brand: MachineBrand | string
  model: string
  basketSize: number        // grams, e.g. 18, 20, 22
  basketType: string        // e.g. "VST", "IMS", "stock"
  shotTemp: number          // degrees C
}

export interface GrinderConfig {
  type: GrinderType
  brand: string
  model: string
  minSetting: number        // numeric min of the grinder's range
  maxSetting: number        // numeric max of the grinder's range
}

export interface TampConfig {
  type: TampType
  level: number             // 0–100 normalised manual tamp effort
  // Spring tamper fields
  springPressure: number | null  // kg
  springMin: number | null
  springMax: number | null
  // Automatic tamper fields
  autoPressure: number | null    // kg
  autoMin: number | null
  autoMax: number | null
}

// ─── Taste feedback ───────────────────────────────────────────────────────────

export type TasteFlavor = 'sour' | 'balanced' | 'bitter'
export type TasteStrength = 'weak' | 'perfect' | 'strong'
export type Crema = 'thin' | 'normal' | 'thick'

// ─── Shot / session ───────────────────────────────────────────────────────────

export interface ShotEntry {
  id: string
  timestamp: string          // ISO datetime string

  // Inputs used
  inputGrind: number         // grinder setting
  inputDose: number          // grams of coffee in
  inputTamp: number          // tamp level 0–100
  targetVolume: number       // ml out
  targetTime: number         // seconds

  // Actuals recorded
  actualVolume: number | null
  actualTime: number | null

  // Computed score 0–100
  score: number | null

  // Recommended adjustments (delta values, positive = coarser/more)
  grindAdjust: number | null
  doseAdjust: number | null
  volumeAdjust: number | null
  timeAdjust: number | null
  tampAdjust: number | null

  // Taste feedback (captured after drinking — all optional, deferrable)
  crema: Crema | null
  tasteFlavor: TasteFlavor | null
  tasteStrength: TasteStrength | null

  // Bean snapshot at time of shot
  beanAge: number | null
  roastLevel: RoastLevel | null

  // Weather at time of shot (learning variables)
  temp: number | null
  humidity: number | null
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export interface MaintenanceRecord {
  lastBackflush: string | null   // ISO date
  lastDescale: string | null     // ISO date
  lastGrinderClean: string | null
  shotsSinceBackflush: number
  shotsSinceDescale: number
}

// ─── Root app state ───────────────────────────────────────────────────────────

export interface BrewmieState {
  units: Units
  machine: MachineConfig | null
  grinder: GrinderConfig | null
  tamp: TampConfig | null
  beans: BeanConfig | null
  currentGrind: number | null
  shots: ShotEntry[]
  maintenance: MaintenanceRecord
  autoApplyAdjustments: boolean
  userId: string | null
  displayName: string | null
  tier: Tier
}

export type Tier = 'free' | 'premium'

// ─── Actions (discriminated union) ────────────────────────────────────────────

export type AppAction =
  | { type: 'SET_UNITS'; payload: Units }
  | { type: 'SET_MACHINE'; payload: MachineConfig }
  | { type: 'SET_GRINDER'; payload: GrinderConfig }
  | { type: 'SET_TAMP'; payload: TampConfig }
  | { type: 'SET_BEANS'; payload: BeanConfig }
  | { type: 'SET_CURRENT_GRIND'; payload: number }
  | { type: 'ADD_SHOT'; payload: ShotEntry }
  | { type: 'UPDATE_SHOT'; payload: { id: string; updates: Partial<ShotEntry> } }
  | { type: 'DELETE_SHOT'; payload: string }
  | { type: 'UPDATE_MAINTENANCE'; payload: Partial<MaintenanceRecord> }
  | { type: 'SET_AUTO_APPLY'; payload: boolean }
  | { type: 'SET_USER'; payload: string | null }
  | { type: 'SET_DISPLAY_NAME'; payload: string | null }
  | { type: 'SET_TIER'; payload: Tier }
  | { type: 'HYDRATE'; payload: BrewmieState }
  | { type: 'RESET' }
