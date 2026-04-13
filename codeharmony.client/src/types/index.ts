// ─── Shared TypeScript types ──────────────────────────────────────────────────

export interface UserInfo {
  id:      string;
  name:    string;
  role:    string;
  color:   string;
  initial: string;
}

export interface CursorPosition {
  line: number;
  col:  number;
}

export interface PresenceInfo {
  id:          string;
  user?:       UserInfo;
  cursor?:     CursorPosition;
  typing:      boolean;
  activeFile?: string;
}

export interface ConflictDev {
  id:      string;
  name:    string;
  color:   string;
  initial: string;
  code:    string;
}

export interface ConflictInfo {
  id:         string;
  filename:   string;
  devA:       ConflictDev;
  devB:       ConflictDev;
  lines:      number[];
  detectedAt: number;
}

export interface LogEntry {
  msg:  string;
  type: string;
  time: string;
}

export interface WelcomePayload {
  connectionId: string;
  files:        Record<string, string>;
  activeFile:   string;
  presence:     PresenceInfo[];
  conflicts:    ConflictInfo[];
  log:          LogEntry[];
}

export interface AiSuggestion {
  title:       string;
  description: string;
  code?:       string;
}

export type RTab   = 'conflicts' | 'ai' | 'log';
export type LPanel = 'explorer'  | 'users' | 'ai';
