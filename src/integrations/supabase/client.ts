const STORAGE_KEY = 'sharky-pizza-run-high-score';

function readHighScore() {
  if (typeof window === 'undefined') return 0;
  const value = Number(window.localStorage.getItem(STORAGE_KEY) ?? '0');
  return Number.isFinite(value) ? value : 0;
}

function writeHighScore(value: number) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, String(Math.max(0, Number(value) || 0)));
}

function tableApi() {
  const api: any = {
    select() {
      return api;
    },
    eq() {
      return api;
    },
    async maybeSingle() {
      return { data: { high_score: readHighScore() }, error: null };
    },
    async insert() {
      if (typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === null) {
        writeHighScore(0);
      }
      return { data: null, error: null };
    },
    async upsert(value: any) {
      if (value && typeof value.high_score !== 'undefined') {
        writeHighScore(value.high_score);
      }
      return { data: value ?? null, error: null };
    },
  };
  return api;
}

export const supabase: any = {
  auth: {
    async getUser() {
      return { data: { user: { id: 'local-player' } }, error: null };
    },
  },
  from() {
    return tableApi();
  },
};
