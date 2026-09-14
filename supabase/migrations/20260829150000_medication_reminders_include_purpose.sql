/**
 * Reminders that only say a drug's name aren't enough to tell two similar-
 * looking tablets apart, or to remind someone WHY they're taking it — a
 * real request: "แจ้งเตือนด้วยว่าตัวยาคืออะไร" (tell me what the medicine
 * actually is when it reminds me). get_pending_medication_reminders already
 * had everything it needed except these three columns from `medications`
 * itself; the join was already there.
 */
DROP FUNCTION IF EXISTS public.get_pending_medication_reminders(timestamp with time zone, timestamp with time zone);

CREATE FUNCTION public.get_pending_medication_reminders(p_from timestamp with time zone DEFAULT now(), p_to timestamp with time zone DEFAULT (now() + '00:05:00'::interval))
 RETURNS TABLE(log_id uuid, user_id uuid, medication_id uuid, med_name text, med_purpose text, med_strength text, med_color text, dose_qty numeric, meal_relation text, meal_note text, scheduled_at timestamp with time zone, reminder_via text)
 LANGUAGE sql
AS $function$
  SELECT
    ml.id           AS log_id,
    ml.user_id,
    ml.medication_id,
    m.name          AS med_name,
    m.purpose       AS med_purpose,
    m.strength      AS med_strength,
    m.color         AS med_color,
    ms.dose_qty,
    ms.meal_relation,
    ms.meal_note,
    ml.scheduled_at,
    ms.reminder_via
  FROM medication_logs ml
  JOIN medication_schedules ms ON ms.id = ml.schedule_id
  JOIN medications m           ON m.id  = ml.medication_id
  WHERE
    ml.status        = 'pending'
    AND ms.reminder_enabled = true
    AND ml.scheduled_at - (ms.reminder_minutes * interval '1 minute')
        BETWEEN p_from AND p_to;
$function$
