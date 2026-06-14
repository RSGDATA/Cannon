-- Remove the unused averages from the concert views. The UI only uses the
-- freshness % (count of good reviews / total); avg_rating / live_avg were dead.

drop view if exists concert_score;
drop view if exists concert_piece_score;

create view concert_score as
select
  concert_id,
  count(*)::int                                                                    as ratings,
  round((count(*) filter (where rating >= 4)::numeric / nullif(count(*), 0)) * 100) as fresh_pct
from concert_reviews
group by concert_id;

create view concert_piece_score as
select
  concert_id,
  work_id,
  count(live_rating)::int                                                                          as live_count,
  round((count(*) filter (where live_rating >= 4)::numeric / nullif(count(live_rating), 0)) * 100) as live_fresh_pct,
  count(*) filter (where heard_before is true)::int                                                as heard_count
from concert_piece_ratings
group by concert_id, work_id;

grant select on concert_score, concert_piece_score to anon, authenticated;
