-- Non-destructive schema bootstrap for Idea Stream's dedicated database only.
BEGIN;
CREATE TABLE IF NOT EXISTS idea_subjects (
 id serial PRIMARY KEY, title text NOT NULL, intro text NOT NULL DEFAULT '', draft text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ideas (
 id serial PRIMARY KEY, subject_id integer NOT NULL REFERENCES idea_subjects(id) ON DELETE CASCADE,
 content text NOT NULL, client_capture_id text UNIQUE, source text NOT NULL DEFAULT 'text',
 attachments jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idea_chat_messages (
 id serial PRIMARY KEY, idea_id integer NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
 role text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idea_subject_compilations (
 id serial PRIMARY KEY, subject_id integer NOT NULL REFERENCES idea_subjects(id) ON DELETE CASCADE,
 tone text NOT NULL DEFAULT 'clear', content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idea_compilation_images (
 id serial PRIMARY KEY, compilation_id integer NOT NULL REFERENCES idea_subject_compilations(id) ON DELETE CASCADE,
 object_path text NOT NULL, alt_text text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idea_compilation_images_compilation_object_idx ON idea_compilation_images(compilation_id, object_path);
COMMIT;
