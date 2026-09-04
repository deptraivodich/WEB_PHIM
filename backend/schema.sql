-- Initialize Database
CREATE DATABASE IF NOT EXISTS web_phim;

-- User Telemetry Log Table using MergeTree Engine
CREATE TABLE IF NOT EXISTS web_phim.user_telemetry_events
(
    event_id UUID DEFAULT generateUUIDv4(),
    user_id String,
    session_id String,
    movie_id String,
    action_type Enum8(
        'click_poster' = 1,
        'view_detail' = 2,
        'play' = 3,
        'pause' = 4,
        'seek' = 5,
        'heartbeat' = 6,
        'search' = 7,
        'complete' = 8
    ),
    watch_time UInt32 DEFAULT 0,
    video_quality String DEFAULT '',
    device_type String DEFAULT 'web',
    ip_address String DEFAULT '',
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (movie_id, action_type, user_id, created_at)
SETTINGS index_granularity = 8192;
