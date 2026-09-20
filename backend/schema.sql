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

-- Global Movie Views Table
CREATE TABLE IF NOT EXISTS web_phim.movie_views
(
    movie_id String,
    views UInt64 DEFAULT 0,
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY movie_id;

-- User Movie Likes Table
CREATE TABLE IF NOT EXISTS web_phim.user_movie_likes
(
    user_id String,
    movie_id String,
    created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (user_id, movie_id);

-- Real Movie Comments Table
CREATE TABLE IF NOT EXISTS web_phim.movie_comments
(
    id UUID DEFAULT generateUUIDv4(),
    movie_id String,
    user_id String,
    username String,
    avatar String,
    content String,
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (movie_id, created_at);

-- Movies Metadata Table (12 columns: title, origin_name, ep, video_url, poster, imdb, year, country, director, status, episode_current, genres)
CREATE TABLE IF NOT EXISTS web_phim.movies
(
    id String,
    title String,
    original_title String DEFAULT '',
    status String DEFAULT 'ongoing',
    episode_current String DEFAULT '',
    director String DEFAULT '',
    country String DEFAULT '',
    year String DEFAULT '',
    imdb String DEFAULT '',
    poster String DEFAULT '',
    banner String DEFAULT '',
    episodes_count String DEFAULT '',
    episodes String DEFAULT '[]',
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;

-- Daily View Logs Table for Real Statistics
CREATE TABLE IF NOT EXISTS web_phim.view_logs
(
    id UUID DEFAULT generateUUIDv4(),
    movie_id String,
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (movie_id, created_at);

-- User Accounts Table
CREATE TABLE IF NOT EXISTS web_phim.users
(
    id String,
    username String,
    password_hash String,
    role String DEFAULT 'user',
    age UInt8 DEFAULT 18,
    display_name String DEFAULT '',
    created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree()
ORDER BY username;

