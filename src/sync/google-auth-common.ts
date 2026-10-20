export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const GOOGLE_TOKEN_KEY = 'explorerGoogleToken';
export const DRIVE_PENDING_KEY = 'explorerDrivePendingKey';
export class ReconnectError extends Error {
  constructor() { super('Reconnect Google Drive in Settings.'); }
}
export interface GoogleAuthAdapter {
  connect(): Promise<void>;
  token(): Promise<string>;
  invalidate(token: string): Promise<void>;
  disconnect(): Promise<void>;
}
