-- Idővonal (3. munkacsomag): kurzoros lapozás időpont + azonosító szerint, és típusszűrés projektenként.
DROP INDEX events_project_time_idx;
CREATE INDEX events_project_time_idx ON events (project_id, occurred_at DESC, id DESC);
CREATE INDEX events_project_type_idx ON events (project_id, type, occurred_at DESC, id DESC);
