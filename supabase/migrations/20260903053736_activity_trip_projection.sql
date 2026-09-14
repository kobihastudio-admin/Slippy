-- Link the current itinerary model to Activity Graph without replacing it.
-- Every legacy item stays editable at its existing URL/table; the stable link
-- lets Feed, resources, people, and costs refer to the same planned moment.

ALTER TABLE public.trip_itinerary_items
  ADD COLUMN IF NOT EXISTS activity_id uuid REFERENCES public.activities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS trip_itinerary_items_activity_idx
  ON public.trip_itinerary_items(activity_id) WHERE activity_id IS NOT NULL;

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS trip_itinerary_item_id uuid
    REFERENCES public.trip_itinerary_items(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activities_trip_itinerary_item_uniq
  ON public.activities(trip_itinerary_item_id) WHERE trip_itinerary_item_id IS NOT NULL;

-- The source reference makes this insert idempotent even if a previous run
-- stopped between inserting the activity and writing activity_id back.
INSERT INTO public.activities (
  owner_id,
  trip_id,
  trip_itinerary_item_id,
  title,
  summary,
  category,
  visibility,
  status,
  location_name,
  starts_at,
  ends_at,
  source_type
)
SELECT
  journey.user_id,
  day.journey_id,
  item.id,
  item.title,
  '',
  item.type,
  'private',
  CASE WHEN item.status = 'cancelled' THEN 'cancelled' ELSE 'published' END,
  item.location,
  item.starts_at,
  item.ends_at,
  'manual'
FROM public.trip_itinerary_items item
JOIN public.trip_itinerary_days day ON day.id = item.day_id
JOIN public.life_journeys journey ON journey.id = day.journey_id
WHERE item.activity_id IS NULL
ON CONFLICT (trip_itinerary_item_id) WHERE trip_itinerary_item_id IS NOT NULL
DO NOTHING;

UPDATE public.trip_itinerary_items item
SET activity_id = activity.id
FROM public.activities activity
WHERE item.activity_id IS NULL
  AND activity.trip_itinerary_item_id = item.id;

CREATE OR REPLACE VIEW public.activity_trip_reconciliation
WITH (security_invoker = true)
AS
SELECT
  day.journey_id,
  count(item.id)::integer AS itinerary_item_count,
  count(item.activity_id)::integer AS linked_activity_count,
  (count(item.id) - count(item.activity_id))::integer AS unlinked_item_count
FROM public.trip_itinerary_days day
LEFT JOIN public.trip_itinerary_items item ON item.day_id = day.id
GROUP BY day.journey_id;

GRANT SELECT ON public.activity_trip_reconciliation TO authenticated;
