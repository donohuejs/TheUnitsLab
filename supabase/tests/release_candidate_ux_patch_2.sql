begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

set local role authenticated;

select is(
  (select count(*) from public.competitions_catalog where id in ('uel', 'laliga')),
  2::bigint,
  'patch 2 adds exactly two soccer competition rows'
);
select is(
  (select sport_id from public.competitions_catalog where id = 'uel'),
  'soccer',
  'Europa League belongs to soccer'
);
select is(
  (select sport_id from public.competitions_catalog where id = 'laliga'),
  'soccer',
  'La Liga belongs to soccer'
);
select is(
  (select name from public.competitions_catalog where id = 'uel'),
  'UEFA Europa League',
  'Europa League catalog name is stable'
);
select is(
  (select name from public.competitions_catalog where id = 'laliga'),
  'La Liga',
  'La Liga catalog name is stable'
);
select ok(
  (select bool_and(enabled) from public.competitions_catalog where id in ('uel', 'laliga')),
  'both patch 2 competitions are enabled'
);
select is(
  (select count(*) from public.competitions_catalog where id in ('uel', 'laliga')),
  (select count(distinct id) from public.competitions_catalog where id in ('uel', 'laliga')),
  'patch 2 competition identifiers remain unique'
);

select * from finish();
rollback;
