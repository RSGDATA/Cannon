// Rotten-Tomatoes-style "freshness" score.
//
// A review counts as GOOD ("fresh") if its rating is >= FRESH_MIN.
// The score is the PERCENTAGE OF REVIEWS THAT ARE GOOD — it counts reviews,
// it does NOT average the stars. (avg-based scoring lived here before.)
//
// Change FRESH_MIN to move the good/bad line. The concert equivalent lives in
// the SQL views (supabase/migrations/...freshness_score.sql, `rating >= 4`).
export const FRESH_MIN = 4

export function freshPct(ratings: number[]): number | null {
  if (ratings.length === 0) return null
  const good = ratings.filter((r) => r >= FRESH_MIN).length
  return Math.round((good / ratings.length) * 100)
}
