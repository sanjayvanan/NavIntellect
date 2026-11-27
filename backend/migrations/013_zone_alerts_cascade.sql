-- Deleting a zone also deletes its alerts. Before, they were kept with zone_id set to NULL:
-- shown as "entered a zone" with no name, and (as zone-less alerts are visible to everyone) a
-- deleted personal zone's alerts became visible to all users.
-- Alerts already orphaned that way are removed.
DELETE FROM alerts WHERE zone_id IS NULL;

ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_zone_id_fkey;
ALTER TABLE alerts ADD CONSTRAINT alerts_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES zones (id) ON DELETE CASCADE;
