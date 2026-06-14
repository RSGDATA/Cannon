-- Aggregate concert scores. Views expose only counts/averages (not individual
-- responses), so per-user concert_piece_ratings stay private while the public
-- can see how a concert / piece was rated overall.
-- Views are owned by postgres -> bypass RLS on the base tables; grant read to clients.

create view concert_score as
select
  concert_id,
  count(*)::int                       as ratings,
  round(avg(rating)::numeric, 2)      as avg_rating
from concert_reviews
group by concert_id;

create view concert_piece_score as
select
  concert_id,
  work_id,
  count(live_rating)::int                          as live_count,
  round(avg(live_rating)::numeric, 2)              as live_avg,
  count(*) filter (where heard_before is true)::int as heard_count
from concert_piece_ratings
group by concert_id, work_id;

grant select on concert_score, concert_piece_score to anon, authenticated;
