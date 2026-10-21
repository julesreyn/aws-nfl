// Domain types for the Sideline app. Mirrors the JSON produced by pipeline/build.py.

export type Grade = "green" | "orange" | "red";
export type Side = "offense" | "defense";

export interface SessionSummary {
  id: string;
  label: string;
  date: string;
  opponent?: string;
}

export interface PlayerInfo {
  id: number;
  name: string;
  jersey: number;
  team: string;
  position: string;
  group?: string;
  ours: boolean;
}

export interface Metric {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  ok?: boolean | null;
}

export interface RepPlayer {
  role: string;
  pos?: string;
  grade: Grade;
  score?: number;
  feedback?: string;
  metrics?: Metric[];
}

export interface RepEvent {
  name: string;
  label?: string;
  frame: number;
}

export interface Rep {
  id: number | string;
  playId: number | string;
  index: number;
  drillId: string;
  side: Side;
  label: string;
  description?: string;
  quarter: number;
  gameClock?: string;
  down?: number;
  yardsToGo?: number;
  formation?: string;
  coverage?: string;
  passResult?: string;
  playResult?: number;
  losX: number;
  nFrames: number;
  snapFrame?: number;
  endFrame?: number;
  events?: RepEvent[];
  grade: Grade;
  score?: number;
  coachSummary?: string;
  players: Record<string, RepPlayer>;
}

export interface BriefPlayer {
  text?: string;
  points?: string[];
  [k: string]: unknown;
}

export interface Drill {
  id: string;
  index: number;
  name: string;
  side: Side;
  repIds: (number | string)[];
  brief?: {
    players?: Record<string, BriefPlayer>;
    [k: string]: unknown;
  };
}

export interface Session {
  id: string;
  label: string;
  date: string;
  team?: string;
  opponent?: string;
  players: Record<string, PlayerInfo>;
  reps: Rep[];
  drills: Drill[];
}

// tracking: [x, y, speed, orientation] rows per frame; null = missing
export type TrackRow = [number, number, number, number] | null;
export interface PlayTracking {
  nFrames: number;
  players: Record<string, TrackRow[]>;
  ball: ([number, number] | null)[];
}
export type Tracking = Record<string, PlayTracking>;

// 3D view feature state
export type CameraPreset = "top" | "madden" | "qb" | "line" | "receiver" | "free";
export interface RouteInfo {
  id: string;
  name: string;
  depth: number;
  color: string;
  jersey: number | null;
  playerName?: string | null;
  pos?: string;
}

export type Dim = "2d" | "3d";
export type ViewName = "seance" | "rapports";

export interface ViewToggles {
  ghost: boolean;
  bubbles: boolean;
  routes: boolean;
  misalign: boolean;
}

export interface PhoneMessage {
  to: string;
  kind: "rep" | "brief";
  text: string;
  time: Date;
}
