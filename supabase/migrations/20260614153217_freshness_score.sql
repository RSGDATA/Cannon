-- Rotten-Tomatoes-style "freshness": % of reviews that are GOOD (rating >= 4),
-- counting reviews, not averaging stars. Threshold lives here (>= 4) and in the
-- client (FRESH_MIN in web/src/score.ts).
-- Redefine the concert aggregate views to expose fresh_pct alongside the average.

drop view if exists concert_score;
drop view if exists concert_piece_score;

create view concert_score as
select
  concert_id,
  count(*)::int                                                                    as ratings,
  round(avg(rating)::numeric, 2)                                                   as avg_rating,
  round((count(*) filter (where rating >= 4)::numeric / nullif(count(*), 0)) * 100) as fresh_pct
from concert_reviews
group by concert_id;

create view concert_piece_score as
select
  concert_id,
  work_id,
  count(live_rating)::int                                                                          as live_count,
  round(avg(live_rating)::numeric, 2)                                                              as live_avg,
  round((count(*) filter (where live_rating >= 4)::numeric / nullif(count(live_rating), 0)) * 100) as live_fresh_pct,
  count(*) filter (where heard_before is true)::int                                                as heard_count
from concert_piece_ratings
group by concert_id, work_id;

grant select on concert_score, concert_piece_score to anon, authenticated;
