CREATE TABLE calendars (
  code TEXT PRIMARY KEY NOT NULL CHECK(length(code) = 6),
  year INTEGER NOT NULL,
  tracks TEXT NOT NULL CHECK(json_valid(tracks) AND json_array_length(tracks) = 24)
);
