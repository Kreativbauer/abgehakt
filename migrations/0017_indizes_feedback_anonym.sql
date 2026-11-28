-- Ideen/Fehler wirklich anonym: Die Begrenzung (5 pro Tag) steht getrennt von der Nachricht und wird nach 24 Stunden
-- gelöscht (täglicher Lauf). feedback.sender_hash bekommt für neue Nachrichten nur noch ''.
CREATE TABLE IF NOT EXISTS feedback_limits (
  sender_hash  TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_limits ON feedback_limits(sender_hash, created_at);

-- Abfragen, die sonst die ganze Datenbank lesen (alle Klassen).
CREATE INDEX IF NOT EXISTS idx_join_codes_member ON join_codes(member_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_member_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_by ON tasks(updated_by);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_by ON tasks(deleted_by);
CREATE INDEX IF NOT EXISTS idx_join_codes_created_by ON join_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_member_id);
CREATE INDEX IF NOT EXISTS idx_push_outbox_subscription ON push_outbox(subscription_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_member ON push_subscriptions(member_id);
CREATE INDEX IF NOT EXISTS idx_login_codes_created ON login_codes(created_at);
CREATE INDEX IF NOT EXISTS idx_account_sessions_account ON account_sessions(account_id);
