-- Fixture "host-private-tables": one synthetic row in each of core's contributor tables,
-- so the tests that prove the engine is refused on them have something to refuse.
-- Every value is made up; example.invalid is a reserved domain that cannot receive mail.

INSERT INTO users (user_id, username, email) VALUES
    ('00000000-0000-4000-8000-000000000001', 'fixture-contributor', 'fixture-contributor@example.invalid');

INSERT INTO user_sessions (sid, sess, expire) VALUES
    ('fixture-session', '{"fixture": true}', '2099-01-01 00:00:00');

INSERT INTO user_password_reset_tokens (token, user_id, expires_on) VALUES
    ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '2099-01-01 00:00:00');

INSERT INTO logs (user_id, building_id) VALUES
    ('00000000-0000-4000-8000-000000000001', 900001);
