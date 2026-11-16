// Sign-in and sync settings. Both are public values (not secrets). Leave either empty to hide sign-in.
// api: the sync worker's URL (worker/, deployed by .github/workflows/sync-worker.yml).
// googleClientId: the OAuth web client ID from Google Cloud, with https://nosv1.github.io allowed.
window.TP_SYNC = {
  api: 'https://trade-pulse-sync.nosv1.workers.dev',
  googleClientId: '1074274731984-e6kn7qddpu7hvjunapft3clkde8e2iht.apps.googleusercontent.com',
};
