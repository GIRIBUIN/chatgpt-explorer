import base from "../public/manifest.json";
import { DRIVE_SCOPE } from '../src/sync/google-auth-common';

export function manifestFor(target: "chromium" | "firefox", syncOrigin = "", googleDrive = false, clientId = '', publicKey = '', dropbox = false) {
  const configured = structuredClone(base);
  if (syncOrigin) configured.host_permissions.push(`${syncOrigin}/*`);
  if (googleDrive) {
    configured.permissions.push('identity');
    configured.host_permissions.push('https://www.googleapis.com/drive/v2/*', 'https://www.googleapis.com/upload/drive/v2/*');
    if (target === 'firefox') configured.host_permissions.push('https://oauth2.googleapis.com/token');
  }
  if (dropbox) {
    if (!configured.permissions.includes('identity')) configured.permissions.push('identity');
    configured.host_permissions.push('https://api.dropboxapi.com/oauth2/token',
      'https://api.dropboxapi.com/2/files/get_metadata', 'https://api.dropboxapi.com/2/auth/token/revoke',
      'https://content.dropboxapi.com/2/files/download', 'https://content.dropboxapi.com/2/files/upload');
  }
  if (target === "chromium") return { ...configured,
    ...(googleDrive && clientId ? { oauth2: { client_id: clientId, scopes: [DRIVE_SCOPE] } } : {}),
    ...(publicKey ? { key: publicKey } : {}),
  };
  const { minimum_chrome_version: _minimum, ...shared } = configured;
  void _minimum;
  return {
    ...shared,
    permissions: configured.permissions.filter((p) => p !== "system.display"),
    background: { scripts: ["background.js"], type: "module" },
    browser_specific_settings: {
      gecko: {
        id: "chat-explorer@local.invalid",
        strict_min_version: "140.0",
        data_collection_permissions: {
          required: ["none"],
          ...(syncOrigin || googleDrive || dropbox
            ? { optional: ["websiteContent", "authenticationInfo"] }
            : {}),
        },
      },
    },
  };
}
