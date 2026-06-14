-- Demo seed data so the app has something to show.
-- (Prototype convenience; catalog writes are normally moderator/admin only.)

insert into composers (slug, name, sort_name, era, nationality, birth_year, death_year) values
  ('beethoven-ludwig-van','Ludwig van Beethoven','Beethoven, Ludwig van','classical','German',1770,1827),
  ('mozart-wolfgang-amadeus','Wolfgang Amadeus Mozart','Mozart, Wolfgang Amadeus','classical','Austrian',1756,1791),
  ('bach-johann-sebastian','Johann Sebastian Bach','Bach, Johann Sebastian','baroque','German',1685,1750);

insert into works (slug, composer_id, title, sort_title, form, key, catalog_system, catalog_number, year_composed, nicknames)
select 'beethoven-symphony-5', id, 'Symphony No. 5', 'Symphony No. 05 in C minor', 'symphony'::work_form, 'C minor', 'Op.', '67', 1808, '{"Fate"}'::text[]
  from composers where slug = 'beethoven-ludwig-van'
union all
select 'mozart-symphony-40', id, 'Symphony No. 40', 'Symphony No. 40 in G minor', 'symphony'::work_form, 'G minor', 'K.', '550', 1788, '{}'::text[]
  from composers where slug = 'mozart-wolfgang-amadeus'
union all
select 'bach-brandenburg-3', id, 'Brandenburg Concerto No. 3', 'Brandenburg Concerto No. 3 in G major', 'concerto'::work_form, 'G major', 'BWV', '1048', 1721, '{}'::text[]
  from composers where slug = 'bach-johann-sebastian';

insert into artists (slug, name, sort_name, roles, nationality, birth_year, death_year) values
  ('kleiber-carlos','Carlos Kleiber','Kleiber, Carlos','{conductor}','Austrian',1930,2004),
  ('karajan-herbert-von','Herbert von Karajan','Karajan, Herbert von','{conductor}','Austrian',1908,1989);

insert into ensembles (slug, name, type, nationality, founded_year) values
  ('vienna-philharmonic','Vienna Philharmonic','orchestra','Austrian',1842),
  ('berlin-philharmonic','Berlin Philharmonic','orchestra','German',1882);

insert into recordings (slug, work_id, year_recorded, recording_type, label, venue)
select 'beethoven-symphony-5-kleiber-vpo-1974', id, 1974, 'studio'::recording_type, 'Deutsche Grammophon', 'Musikverein, Vienna'
  from works where slug = 'beethoven-symphony-5'
union all
select 'beethoven-symphony-5-karajan-bpo-1963', id, 1963, 'studio'::recording_type, 'Deutsche Grammophon', 'Jesus-Christus-Kirche, Berlin'
  from works where slug = 'beethoven-symphony-5'
union all
select 'mozart-symphony-40-karajan-bpo-1970', id, 1970, 'studio'::recording_type, 'Deutsche Grammophon', 'Berlin'
  from works where slug = 'mozart-symphony-40';

-- credits (conductor + orchestra per recording)
insert into credits (recording_id, artist_id, role, is_primary)
select r.id, a.id, 'conductor', true
  from recordings r join artists a on a.slug = 'kleiber-carlos'
 where r.slug = 'beethoven-symphony-5-kleiber-vpo-1974'
union all
select r.id, a.id, 'conductor', true
  from recordings r join artists a on a.slug = 'karajan-herbert-von'
 where r.slug in ('beethoven-symphony-5-karajan-bpo-1963','mozart-symphony-40-karajan-bpo-1970');

insert into credits (recording_id, ensemble_id, role, is_primary)
select r.id, e.id, 'orchestra', false
  from recordings r join ensembles e on e.slug = 'vienna-philharmonic'
 where r.slug = 'beethoven-symphony-5-kleiber-vpo-1974'
union all
select r.id, e.id, 'orchestra', false
  from recordings r join ensembles e on e.slug = 'berlin-philharmonic'
 where r.slug in ('beethoven-symphony-5-karajan-bpo-1963','mozart-symphony-40-karajan-bpo-1970');
