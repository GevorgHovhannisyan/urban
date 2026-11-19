// The visitor's cookie choice ('all' | 'essential'), shared by the combined
// first-visit dialog (RegionPopup) and the standalone PrivacyPopup shown to
// returning visitors who picked a country before choosing.
const STORAGE_KEY = 'up_privacy_choice';

export function hasPrivacyChoice() {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function savePrivacyChoice(choice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, savedAt: new Date().toISOString() }));
  } catch {
    // Storage blocked (private mode etc.): the choice just isn't remembered.
  }
}
