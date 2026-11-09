const TOKEN_KEY = "spotlite_token";
const ORG_KEY = "spotlite_organizer";

export interface Organizer {
  id: string;
  email: string;
  name: string;
}

export function saveSession(token: string, organizer: Organizer): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ORG_KEY, JSON.stringify(organizer));
}

export function loadSession(): { token: string; organizer: Organizer } | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(ORG_KEY);
  if (!token || !raw) return null;
  try {
    return { token, organizer: JSON.parse(raw) };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ORG_KEY);
}
