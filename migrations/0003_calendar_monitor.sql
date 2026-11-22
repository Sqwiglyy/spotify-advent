CREATE TABLE calendar_monitor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_count INTEGER NOT NULL
);
